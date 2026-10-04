import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'
import pg from 'pg'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const line = readFileSync(join(root, '.env.local'), 'utf8').split(/\r?\n/)
  .find((item) => item.startsWith('DATABASE_URL_UNPOOLED='))
if (!line) throw new Error('Direkte Datenbankverbindung fehlt.')
const connectionString = line.slice('DATABASE_URL_UNPOOLED='.length).replace(/^["']|["']$/g, '')
const client = new pg.Client({ connectionString })
const baseUrl = process.env.ASSISTANT_API_BASE_URL ?? 'http://localhost:3100'
await client.connect()
let tokenId = null
try {
  const owner = await client.query('SELECT "userId" FROM trade GROUP BY "userId" ORDER BY count(*) DESC LIMIT 1')
  if (!owner.rows.length) throw new Error('Kein Testnutzer mit Trades vorhanden.')
  const token = `sat_${randomBytes(32).toString('base64url')}`
  const hash = createHash('sha256').update(token).digest('hex')
  const created = await client.query('INSERT INTO assistant_api_token ("userId", name, "tokenHash", scopes) VALUES ($1, $2, $3, $4::jsonb) RETURNING id',
    [owner.rows[0].userId, 'API Smoke Test', hash, JSON.stringify(['trades:read', 'journal:read'])])
  tokenId = created.rows[0].id
  const request = async (path, expected = 200) => {
    const response = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } })
    if (response.status !== expected) throw new Error(`${path}: HTTP ${response.status}, erwartet ${expected}`)
    return response.json()
  }
  const [portfolios, trades, journal, insights] = await Promise.all([
    request('/api/assistant/v1/portfolios'), request('/api/assistant/v1/trades?limit=2'),
    request('/api/assistant/v1/journal?limit=2'), request('/api/assistant/v1/insights?limit=2'),
  ])
  if (!Array.isArray(portfolios.items) || !Array.isArray(trades.items) ||
      !Array.isArray(journal.items) || !Array.isArray(insights.items)) throw new Error('Unerwartete API-Antwort.')
  if (trades.items.length) await request(`/api/assistant/v1/trades/${trades.items[0].id}`)
  console.log(`Lese-API: ${portfolios.items.length} Depots, ${trades.items.length} Trades, ${journal.items.length} Journalzeilen, ${insights.items.length} Erkenntnisse auf erster Seite.`)
  await client.query('UPDATE assistant_api_token SET "revokedAt" = now() WHERE id = $1', [tokenId])
  await request('/api/assistant/v1/trades?limit=1', 401)
  console.log('Widerruf: HTTP 401 bestätigt.')
} finally {
  if (tokenId) await client.query('DELETE FROM assistant_api_token WHERE id = $1', [tokenId])
  await client.end()
}
