import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const line = readFileSync(join(root, '.env.local'), 'utf8').split(/\r?\n/)
  .find((item) => item.startsWith('DATABASE_URL_UNPOOLED='))
if (!line) throw new Error('Direkte Datenbankverbindung fehlt.')
const client = new pg.Client({ connectionString: line.slice('DATABASE_URL_UNPOOLED='.length).replace(/^["']|["']$/g, '') })
await client.connect()
const baseUrl = process.env.ASSISTANT_API_BASE_URL ?? 'http://localhost:3100'
const userId = `assistant-journal-test-${randomUUID()}`
let tokenId = null
try {
  await client.query('INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)',
    [userId, 'Journal API Test', `${userId}@example.invalid`])
  const token = `sat_${randomBytes(32).toString('base64url')}`
  tokenId = (await client.query('INSERT INTO assistant_api_token ("userId", name, "tokenHash", scopes) VALUES ($1, $2, $3, $4::jsonb) RETURNING id',
    [userId, 'Journal Write Test', createHash('sha256').update(token).digest('hex'), JSON.stringify(['journal:read', 'journal:write'])])).rows[0].id
  const call = async (path, method, body, version) => {
    const response = await fetch(`${baseUrl}${path}`, { method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        ...(version ? { 'X-Expected-Version': String(version) } : {}) },
      body: body ? JSON.stringify(body) : undefined })
    const text = await response.text()
    let data
    try { data = JSON.parse(text) } catch { throw new Error(`${method} ${path} HTTP ${response.status}: ${text.slice(0, 200)}`) }
    return { status: response.status, data }
  }
  const journal = await call('/api/assistant/v1/journal', 'POST', { situation: 'API-Test', reflection: 'Testreflexion' })
  if (journal.status !== 201 || journal.data.kind !== 'assistant_interpretation') throw new Error(`Journal POST: ${journal.status}`)
  const corrected = await call(`/api/assistant/v1/journal/${journal.data.id}`, 'PATCH', { reflection: 'Korrigiert' }, 1)
  if (corrected.status !== 200 || corrected.data.version !== 2) throw new Error(`Journal PATCH: ${corrected.status}`)
  const stale = await call(`/api/assistant/v1/journal/${journal.data.id}`, 'PATCH', { reflection: 'Veraltet' }, 1)
  if (stale.status !== 409) throw new Error(`Veraltete Version: ${stale.status}`)
  const insight = await call('/api/assistant/v1/insights', 'POST', { statement: 'Testhypothese', status: 'supported',
    evidenceRefs: [{ kind: 'journal', id: journal.data.id }] })
  if (insight.status !== 201 || insight.data.version !== 1) throw new Error(`Erkenntnis POST: ${insight.status}`)
  const updated = await call(`/api/assistant/v1/insights/${insight.data.id}`, 'PATCH', { statement: 'Korrigierte Testhypothese' }, 1)
  if (updated.status !== 200 || updated.data.version !== 2) throw new Error(`Erkenntnis PATCH: ${updated.status}`)
  console.log('Journal/Erkenntnisse: POST 201, PATCH 200, Versionskonflikt 409, Belegverweis geprüft.')
} finally {
  await client.query('DELETE FROM insight WHERE "userId" = $1', [userId])
  await client.query('DELETE FROM journal_entry WHERE "userId" = $1', [userId])
  if (tokenId) await client.query('DELETE FROM assistant_api_token WHERE id = $1 AND "userId" = $2', [tokenId, userId])
  await client.query('DELETE FROM "user" WHERE id = $1', [userId])
  console.log('Journal-Testdaten entfernt.')
  await client.end()
}
