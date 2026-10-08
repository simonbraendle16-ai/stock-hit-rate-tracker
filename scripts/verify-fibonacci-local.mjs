import assert from 'node:assert/strict'
import pg from 'pg'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
// Fixed loopback target. Never load .env.local or accept a cloud URL.
const client = new pg.Client({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:5548/postgres',
})
const base = 'http://localhost:3018',
  owner = 'fibonacci-local-qa',
  id = randomUUID(),
  tokenId = randomUUID(),
  token = 'sat_' + randomBytes(32).toString('base64url')
let temp
try {
  await client.connect()
  assert.equal(
    (await client.query('SELECT email FROM "user" WHERE id=$1', [owner]))
      .rows[0]?.email,
    'fibonacci-qa@example.invalid',
    'Synthetic owner missing',
  )
  await client.query(
    'INSERT INTO assistant_api_token(id,"userId",name,"tokenHash",scopes) VALUES ($1,$2,\'Local synthetic Fibonacci QA\',$3,$4::jsonb)',
    [
      tokenId,
      owner,
      createHash('sha256').update(token).digest('hex'),
      JSON.stringify(['trades:read', 'trades:write']),
    ],
  )
  const request = async (
    path = '',
    method = 'GET',
    body,
    headers = {},
    status = 200,
  ) => {
    const response = await fetch(base + '/api/assistant/v1/fibonacci' + path, {
      method,
      headers: {
        authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    })
    const data = await response.json()
    assert.equal(
      response.status,
      status,
      `${method} ${path}: unexpected status`,
    )
    return data
  }
  const input = {
    stockId: 1,
    wave: 'B',
    degree: 'Minor',
    timeframe: '1d',
    observedOn: '2026-10-08',
    status: 'abgeschlossen',
    percent: null,
    anchorStart: 100,
    anchorEnd: 200,
    extreme: 138.2,
    note: 'Isolated HTTP QA',
  }
  const created = await request(
    '',
    'POST',
    input,
    { 'Idempotency-Key': id },
    201,
  )
  assert.ok(Math.abs(created.percent - 61.8) < 1e-9)
  assert.equal(created.version, 1)
  assert.equal((await request('/' + id)).version, 1)
  assert.equal(
    (await request('', 'POST', input, { 'Idempotency-Key': id }, 201)).id,
    id,
  )
  const updated = await request(
    '/' + id,
    'PATCH',
    { ...input, extreme: 150 },
    { 'X-Expected-Version': '1' },
  )
  assert.equal(updated.percent, 50)
  assert.equal(updated.version, 2)
  await request('/' + id, 'PATCH', input, { 'X-Expected-Version': '1' }, 409)
  const paged = await request('?stockId=1&wave=B&limit=1')
  assert.equal(paged.items.length, 1)
  assert.ok(paged.stats.n > 1)
  assert.ok(paged.total > paged.items.length)
  await request('?wave=bogus', 'GET', undefined, {}, 400)
  temp = mkdtempSync(join(tmpdir(), 'fibonacci-cli-qa-'))
  const envFile = join(temp, 'local.env')
  writeFileSync(
    envFile,
    'ASSISTANT_API_BASE_URL=' + base + '\nASSISTANT_API_TOKEN=' + token + '\n',
  )
  const cli = spawnSync(
    process.execPath,
    [
      'C:/Users/sabin/Documents/Trading-Assistent/scripts/tracker-api.mjs',
      'GET',
      '/fibonacci/' + id,
    ],
    {
      env: {
        ...process.env,
        ASSISTANT_ENV_FILE: envFile,
        ASSISTANT_API_BASE_URL: base,
        ASSISTANT_API_TOKEN: token,
      },
      encoding: 'utf8',
      windowsHide: true,
    },
  )
  assert.equal(cli.status, 0, 'CLI failed')
  assert.equal(JSON.parse(cli.stdout).percent, 50)
  const browserRow = (
    await client.query(
      'SELECT percent,status,version FROM fibonacci_observation WHERE "userId"=$1 AND note LIKE \'Synthetische Browser-Abnahme:%\'',
      [owner],
    )
  ).rows
  if (browserRow.length) {
    assert.deepEqual(browserRow, [
      { percent: 50, status: 'ungueltig', version: 3 },
    ])
  }
  console.log(
    JSON.stringify({
      localOnly: true,
      httpCreateReadRetryPatchConflict: true,
      fullSummaryAcrossPages: true,
      cliRead: true,
      browserRoundtrip: browserRow,
      productionAccess: false,
    }),
  )
} finally {
  if (client._connected) {
    await client
      .query('DELETE FROM fibonacci_observation WHERE id=$1 AND "userId"=$2', [
        id,
        owner,
      ])
      .catch(() => {})
    await client
      .query('DELETE FROM assistant_api_token WHERE id=$1 AND "userId"=$2', [
        tokenId,
        owner,
      ])
      .catch(() => {})
  }
  await client.end().catch(() => {})
  if (temp) {
    unlinkSync(join(temp, 'local.env'))
    rmdirSync(temp)
  }
}
