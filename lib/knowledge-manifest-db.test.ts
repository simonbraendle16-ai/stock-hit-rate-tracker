import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { getTableColumns, eq, and, inArray } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { createHash } from 'node:crypto'
import * as schema from './db/schema'
import { fingerprint } from './knowledge-content.mjs'

const state = vi.hoisted(() => ({ db: null as any }))
vi.mock('@/lib/db', () => ({ get db() { return state.db } }))
import { knowledgeManifest } from './knowledge-manifest'

const tables = [schema.trade, schema.journalEntry, schema.insight, schema.tradeEvent, schema.tradeTarget, schema.tradeEventRevision] as const
const queries: { sql: string; params: unknown[] }[] = []
let pg: PGlite

// Populate every real column, including fields not used by the fingerprint.
// Adding a payload field without updating the SQL projection must fail this test.
function row(table: typeof tables[number], id: number, owner = 'owner'): any {
  return Object.fromEntries(Object.entries(getTableColumns(table)).map(([key, column]) => [key,
    key === 'userId' ? owner : key === 'tradeId' || key === 'eventId' ? 1 :
      column.columnType === 'PgUUID' ? `00000000-0000-4000-8000-${String(id).padStart(12, '0')}` :
      column.dataType === 'date' ? new Date('2026-10-21T10:00:00Z') :
      column.dataType === 'number' ? id : column.dataType === 'boolean' ? false :
      column.dataType === 'json' ? { synthetic: key } :
      key === 'demoIssue' ? 'x'.repeat(65536) : `synthetic-${key}-${id}`,
  ]))
}

beforeAll(async () => {
  pg = new PGlite() // No env loader, socket or production connection.
  for (const table of tables) {
    const config = getTableConfig(table)
    await pg.exec(`CREATE TABLE "${config.name}" (${config.columns.map(c => `"${c.name}" ${c.getSQLType()}`).join(',')})`)
  }
  state.db = drizzle(pg, { logger: { logQuery(sql, params) { queries.push({ sql, params }) } } })
  await state.db.insert(schema.trade).values([...Array.from({ length: 120 }, (_, i) => row(schema.trade, i + 1)), row(schema.trade, 999, 'foreign')])
  for (const table of tables.slice(1)) await state.db.insert(table).values([row(table, 1), row(table, 999, 'foreign')])
}, 30000)
afterAll(async () => { await pg?.close() })

// Independent legacy full-row path: this is the previous public hash contract.
async function baseline(owner = 'owner') {
  const db = state.db
  const trades = await db.select().from(schema.trade).where(eq(schema.trade.userId, owner))
  const journals = await db.select().from(schema.journalEntry).where(eq(schema.journalEntry.userId, owner))
  const insights = await db.select().from(schema.insight).where(eq(schema.insight.userId, owner))
  const ids = trades.map((r: any) => r.id)
  const children: any[][] = []
  for (const table of [schema.tradeEvent, schema.tradeTarget, schema.tradeEventRevision]) {
    children.push(ids.length ? await db.select().from(table).where(and(eq(table.userId, owner), inArray(table.tradeId, ids))) : [])
  }
  const items = [
    ...trades.map((r: any) => ({ type: 'trade', id: String(r.id), version: r.version, fingerprint: fingerprint('trade', { ...r,
      events: children[0].filter((c: any) => c.tradeId === r.id), targets: children[1].filter((c: any) => c.tradeId === r.id), eventRevisions: children[2].filter((c: any) => c.tradeId === r.id) }) })),
    ...journals.map((r: any) => ({ type: 'journal', id: r.id, version: r.version, fingerprint: fingerprint('journal', r) })),
    ...insights.map((r: any) => ({ type: 'insight', id: r.id, version: r.version, fingerprint: fingerprint('insight', r) })),
  ].sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`))
  return { items, etag: `"${createHash('sha256').update(JSON.stringify(items)).digest('hex')}"`, complete: true, schemaVersion: 1 }
}

describe('knowledge manifest SQL projection', () => {
  it('preserves the complete legacy manifest, owner boundary and snapshot options while reducing returned bytes', async () => {
    queries.length = 0
    const expected = await baseline()
    const oldQueries = queries.filter(q => /^select /i.test(q.sql))
    queries.length = 0
    expect(await knowledgeManifest('owner')).toEqual(expected)
    const newQueries = queries.filter(q => /^select /i.test(q.sql))
    expect(newQueries).toHaveLength(6)
    expect(expected.items.filter(i => i.type === 'trade')).toHaveLength(120)
    expect(expected.items.some(i => i.id === '999')).toBe(false)
    expect(queries.some(q => /repeatable read.*read only/i.test(q.sql))).toBe(true)
    async function bytes(qs: typeof queries) {
      let bytes = 0
      for (const q of qs) bytes += Buffer.byteLength(JSON.stringify((await pg.query(q.sql, q.params)).rows))
      return bytes
    }
    const before = await bytes(oldQueries), after = await bytes(newQueries)
    expect(after).toBeLessThan(before / 10)
    console.info(JSON.stringify({ fixture: 'synthetic; oversized discarded demoIssue', beforeBytes: before, afterBytes: after }))
  })

  it('detects old edits and every child correction without advancing the parent version', async () => {
    for (const [table, patch] of [
      [schema.trade, { notes: 'corrected old note' }],
      [schema.journalEntry, { reflection: 'corrected reflection' }],
      [schema.insight, { counterEvidenceRefs: [{ kind: 'trade', id: '1' }] }],
      [schema.tradeEvent, { payload: 'corrected payload' }],
      [schema.tradeTarget, { executedQty: 10 }],
      [schema.tradeEventRevision, { after: { corrected: true } }],
    ] as const) {
      const before = await knowledgeManifest('owner')
      await state.db.update(table).set(patch).where(eq(table.userId, 'owner'))
      const after = await knowledgeManifest('owner')
      expect(after.etag).not.toBe(before.etag)
      expect(after).toEqual(await baseline())
    }
  })

  it('preserves nulls, deletions, empty owners and reappearance without caching', async () => {
    await state.db.update(schema.trade).set({ notes: null, planContext: null }).where(eq(schema.trade.id, 1))
    expect(await knowledgeManifest('owner')).toEqual(await baseline())
    const before = await knowledgeManifest('owner')
    await state.db.delete(schema.tradeEventRevision).where(eq(schema.tradeEventRevision.userId, 'owner'))
    expect((await knowledgeManifest('owner')).etag).not.toBe(before.etag)
    expect(await knowledgeManifest('owner')).toEqual(await baseline())
    await state.db.delete(schema.trade).where(eq(schema.trade.userId, 'owner'))
    expect(await knowledgeManifest('owner')).toEqual(await baseline())
    expect(await knowledgeManifest('empty')).toEqual(await baseline('empty'))
    await state.db.insert(schema.trade).values(row(schema.trade, 1))
    expect(await knowledgeManifest('owner')).toEqual(await baseline())
  })
})
