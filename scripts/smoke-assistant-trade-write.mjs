import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const line = readFileSync(join(root, '.env.local'), 'utf8').split(/\r?\n/)
  .find((item) => item.startsWith('DATABASE_URL_UNPOOLED='))
if (!line) throw new Error('Direkte Datenbankverbindung fehlt.')
const connectionString = line.slice('DATABASE_URL_UNPOOLED='.length).replace(/^["']|["']$/g, '')
const client = new pg.Client({ connectionString })
const baseUrl = process.env.ASSISTANT_API_BASE_URL ?? 'http://localhost:3100'
await client.connect()
const userId = `assistant-api-test-${randomUUID()}`
let tradeId = null
let stockId = null
let portfolioId = null
let tokenId = null
try {
  const before = Number((await client.query('SELECT count(*) AS count FROM trade')).rows[0].count)
  await client.query('INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)',
    [userId, 'API Test', `${userId}@example.invalid`])
  portfolioId = (await client.query('INSERT INTO portfolio ("userId", name, kind) VALUES ($1, $2, $3) RETURNING id',
    [userId, 'API Test Depot', 'demo'])).rows[0].id
  stockId = (await client.query('INSERT INTO stock ("userId", name, ticker, market) VALUES ($1, $2, $3, $4) RETURNING id',
    [userId, 'API Test Instrument', 'TEST', 'sonstiges'])).rows[0].id
  const token = `sat_${randomBytes(32).toString('base64url')}`
  tokenId = (await client.query('INSERT INTO assistant_api_token ("userId", name, "tokenHash", scopes) VALUES ($1, $2, $3, $4::jsonb) RETURNING id',
    [userId, 'API Write Test', createHash('sha256').update(token).digest('hex'), JSON.stringify(['trades:read', 'trades:write'])])).rows[0].id
  const key = randomUUID()
  const payload = { portfolioId, ticker: 'TEST', market: 'sonstiges', tradeKind: 'schnell',
    direction: 'long', entryPrice: 100, stopLoss: 98, takeProfit: 104,
    source: { kind: 'user_statement', capturedAt: new Date().toISOString(), confirmedByUser: true } }
  const post = async (body) => {
    const response = await fetch(`${baseUrl}/api/assistant/v1/trades`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': key,
        'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const text = await response.text()
    let data
    try { data = JSON.parse(text) } catch { throw new Error(`POST HTTP ${response.status}: ${text.slice(0, 200)}`) }
    return { status: response.status, data }
  }
  const created = await post(payload)
  if (created.status !== 201 || !Number.isSafeInteger(created.data.id)) throw new Error(`POST fehlgeschlagen: HTTP ${created.status} ${JSON.stringify(created.data)}`)
  tradeId = created.data.id
  const repeated = await post(payload)
  if (repeated.status !== 200 || repeated.data.id !== tradeId) throw new Error('Wiederholung hat keinen identischen Trade geliefert.')
  const changed = await post({ ...payload, takeProfit: 105 })
  if (changed.status !== 409) throw new Error('Gleicher Schlüssel mit anderem Body wurde nicht abgelehnt.')
  const patch = async (body, version) => {
    const response = await fetch(`${baseUrl}/api/assistant/v1/trades/${tradeId}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'X-Expected-Version': String(version),
        'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const text = await response.text()
    let data
    try { data = JSON.parse(text) } catch { throw new Error(`PATCH HTTP ${response.status}: ${text.slice(0, 200)}`) }
    return { status: response.status, data }
  }
  const corrected = await patch({ notes: 'API-Korrektur' }, 1)
  if (corrected.status !== 200 || corrected.data.version !== 2) throw new Error(`PATCH fehlgeschlagen: ${corrected.status}`)
  const stale = await patch({ notes: 'Veraltete Korrektur' }, 1)
  if (stale.status !== 409) throw new Error('Veraltete Trade-Version wurde nicht abgelehnt.')
  const unsafe = await patch({ stopLoss: 90 }, 2)
  if (unsafe.status !== 400) throw new Error('Planpreis über Metadaten-PATCH wurde nicht abgelehnt.')
  const count = Number((await client.query('SELECT count(*) AS count FROM trade')).rows[0].count)
  if (count !== before + 1) throw new Error('Unerwartete Trade-Anzahl nach POST.')
  console.log('Trade-POST: 201/200/409; Metadaten-PATCH: 200, veraltete Version: 409, Planpreis abgewiesen; genau ein Test-Trade.')
} finally {
  // Alle Löschziele stammen ausschließlich aus den oben erzeugten Test-IDs.
  if (tradeId) await client.query('DELETE FROM trade_target WHERE "tradeId" = $1 AND "userId" = $2', [tradeId, userId])
  if (tradeId) await client.query('DELETE FROM trade_event WHERE "tradeId" = $1 AND "userId" = $2', [tradeId, userId])
  if (tradeId) await client.query('DELETE FROM price_alert WHERE "tradeId" = $1 AND "userId" = $2', [tradeId, userId])
  await client.query('DELETE FROM trade WHERE "userId" = $1', [userId])
  if (tokenId) await client.query('DELETE FROM assistant_api_token WHERE id = $1 AND "userId" = $2', [tokenId, userId])
  if (stockId) await client.query('DELETE FROM stock WHERE id = $1 AND "userId" = $2', [stockId, userId])
  if (portfolioId) await client.query('DELETE FROM portfolio WHERE id = $1 AND "userId" = $2', [portfolioId, userId])
  await client.query('DELETE FROM "user" WHERE id = $1', [userId])
  const final = Number((await client.query('SELECT count(*) AS count FROM trade')).rows[0].count)
  console.log(`Testdaten entfernt; ${final} Trades vorhanden.`)
  await client.end()
}
