import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
const state = vi.hoisted(() => ({ database: null as any }))
vi.mock('@/lib/db', () => ({
  get db() {
    return state.database
  },
}))
import * as schema from './db/schema'
import { saveFib, listFib, getFib } from './fibonacci-service'
import { hashToken } from './assistant-api'
import { GET, POST } from '@/app/api/assistant/v1/fibonacci/route'
import {
  GET as detailGET,
  PATCH,
} from '@/app/api/assistant/v1/fibonacci/[id]/route'
let pg: PGlite
const input = {
  stockId: 1,
  wave: 'B',
  degree: 'Minor',
  timeframe: '1d',
  observedOn: '2026-01-01',
  status: 'abgeschlossen',
  percent: 50,
  anchorStart: 100,
  anchorEnd: 200,
  extreme: 150,
  note: 'Synthetic source',
}
const tokens = {
  owner: 'sat_' + 'a'.repeat(43),
  other: 'sat_' + 'b'.repeat(43),
  read: 'sat_' + 'c'.repeat(43),
}
beforeAll(async () => {
  pg = new PGlite()
  state.database = drizzle(pg, { schema })
  await pg.exec(`CREATE TABLE "user" (id text PRIMARY KEY);INSERT INTO "user" VALUES ('owner'),('other');
 CREATE TABLE stock(id serial PRIMARY KEY,"userId" text NOT NULL,name text NOT NULL,ticker text NOT NULL,market text NOT NULL);
 INSERT INTO stock VALUES (1,'owner','Synthetic stock','TEST','aktien'),(2,'other','Foreign','FOREIGN','krypto');
 CREATE TABLE assistant_api_token(id uuid DEFAULT gen_random_uuid(),"userId" text,name text DEFAULT 'Synthetic token',"createdAt" timestamp DEFAULT now(),"tokenHash" text,scopes jsonb,"revokedAt" timestamp,"lastUsedAt" timestamp);`)
  await pg.exec(
    readFileSync(
      new URL('../drizzle/0048_fibonacci_observations.sql', import.meta.url),
      'utf8',
    ),
  )
  for (const [key, value] of Object.entries(tokens))
    await pg.query(
      'INSERT INTO assistant_api_token ("userId","tokenHash",scopes) VALUES ($1,$2,$3)',
      [
        key === 'other' ? 'other' : 'owner',
        hashToken(value),
        JSON.stringify(
          key === 'read' ? ['trades:read'] : ['trades:read', 'trades:write'],
        ),
      ],
    )
}, 30000)
afterAll(async () => {
  await pg?.close()
})
beforeEach(async () => {
  await pg.exec('TRUNCATE fibonacci_observation')
})
const request = (
  path: string,
  token: string | null = tokens.owner,
  method = 'GET',
  body?: object,
  extra: Record<string, string> = {},
) =>
  new NextRequest('http://localhost/api/assistant/v1/fibonacci' + path, {
    method,
    headers: {
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      'Content-Type': 'application/json',
      ...extra,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
describe('Fibonacci isolated PostgreSQL and HTTP contract', () => {
  it('applies additive migration twice without changing instrument rows', async () => {
    await pg.exec(
      readFileSync(
        new URL('../drizzle/0048_fibonacci_observations.sql', import.meta.url),
        'utf8',
      ),
    )
    expect(
      (await pg.query('SELECT count(*)::int AS n FROM stock')).rows,
    ).toEqual([{ n: 2 }])
  })
  it('saves, rereads, retries safely and rejects another body on same ID', async () => {
    const id = crypto.randomUUID()
    const first = await saveFib('owner', id, input)
    expect(first.version).toBe(1)
    expect((await getFib('owner', id)).percent).toBe(50)
    await saveFib('owner', id, input)
    expect(await listFib('owner')).toHaveLength(1)
    await expect(
      saveFib('owner', id, { ...input, note: 'Different' }),
    ).rejects.toMatchObject({ status: 409 })
  })
  it('enforces ownership in lists, detail, create and update', async () => {
    const id = crypto.randomUUID()
    await saveFib('owner', id, input)
    expect(await listFib('other')).toEqual([])
    await expect(getFib('other', id)).rejects.toMatchObject({ status: 404 })
    await expect(
      saveFib('owner', crypto.randomUUID(), { ...input, stockId: 2 }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      saveFib('other', id, { ...input, stockId: 2 }, 1),
    ).rejects.toMatchObject({ status: 404 })
  })
  it('allows one optimistic update and rejects stale versions', async () => {
    const id = crypto.randomUUID()
    await saveFib('owner', id, input)
    const changed = await saveFib(
      'owner',
      id,
      { ...input, status: 'laufend' },
      1,
    )
    expect(changed.version).toBe(2)
    await expect(saveFib('owner', id, input, 1)).rejects.toMatchObject({
      status: 409,
    })
    expect((await getFib('owner', id)).status).toBe('laufend')
  })
  it('checks percent and anchor consistency at database boundary', async () => {
    for (const percent of [-1, 501, NaN])
      await expect(
        pg.query(
          "INSERT INTO fibonacci_observation(id,\"userId\",\"stockId\",wave,degree,timeframe,\"observedOn\",status,percent,note) VALUES ($1,'owner',1,'B','Minor','1d','2026-01-01','abgeschlossen',$2,'Synthetic')",
          [crypto.randomUUID(), percent],
        ),
      ).rejects.toThrow()
    await expect(
      pg.query(
        "INSERT INTO fibonacci_observation(id,\"userId\",\"stockId\",wave,degree,timeframe,\"observedOn\",status,percent,note,\"anchorStart\",\"anchorEnd\",extreme) VALUES ($1,'owner',1,'B','Minor','1d','2026-01-01','abgeschlossen',70,'Synthetic',100,200,150)",
        [crypto.randomUUID()],
      ),
    ).rejects.toThrow()
  })
  it('enforces auth, scopes, body validation and missing keys over HTTP', async () => {
    expect((await GET(request('', null))).status).toBe(401)
    expect(
      (
        await POST(
          request('', tokens.read, 'POST', input, {
            'Idempotency-Key': crypto.randomUUID(),
          }),
        )
      ).status,
    ).toBe(403)
    expect((await POST(request('', tokens.owner, 'POST', input))).status).toBe(
      400,
    )
    expect(
      (
        await POST(
          request(
            '',
            tokens.owner,
            'POST',
            { ...input, percent: 70 },
            { 'Idempotency-Key': crypto.randomUUID() },
          ),
        )
      ).status,
    ).toBe(422)
  })
  it('creates through API and paginates without limiting summary denominator', async () => {
    for (const n of [38.2, 61.8, 100])
      await POST(
        request(
          '',
          tokens.owner,
          'POST',
          {
            ...input,
            percent: n,
            anchorStart: null,
            anchorEnd: null,
            extreme: null,
          },
          { 'Idempotency-Key': crypto.randomUUID() },
        ),
      )
    const result = await GET(request('?limit=1'))
    const body = await result.json()
    expect(result.status).toBe(200)
    expect(body.items).toHaveLength(1)
    expect(body.total).toBe(3)
    expect(body.stats.n).toBe(3)
    expect(body.nextOffset).toBe(1)
    expect((await GET(request('?market=krypto'))).status).toBe(200)
    expect((await (await GET(request('?market=krypto'))).json()).total).toBe(0)
    expect((await GET(request('?limit=-1'))).status).toBe(400)
    expect((await GET(request('?wave=unknown'))).status).toBe(400)
    expect((await GET(request('?from=2026-02-02&to=2026-01-01'))).status).toBe(
      400,
    )
    expect((await GET(request('?from=2026-02-30'))).status).toBe(400)
  })
  it('GET/PATCH roundtrip protects foreign records and versions', async () => {
    const id = crypto.randomUUID(),
      ctx = { params: Promise.resolve({ id }) }
    await saveFib('owner', id, input)
    expect((await detailGET(request('/' + id, tokens.other), ctx)).status).toBe(
      404,
    )
    expect(
      (
        await PATCH(
          request('/' + id, tokens.owner, 'PATCH', input, {
            'X-Expected-Version': '1',
          }),
          ctx,
        )
      ).status,
    ).toBe(200)
    expect(
      (
        await PATCH(
          request('/' + id, tokens.owner, 'PATCH', input, {
            'X-Expected-Version': '1',
          }),
          ctx,
        )
      ).status,
    ).toBe(409)
    expect(
      (
        await PATCH(
          request('/' + id, tokens.read, 'PATCH', input, {
            'X-Expected-Version': '2',
          }),
          ctx,
        )
      ).status,
    ).toBe(403)
  })
})
