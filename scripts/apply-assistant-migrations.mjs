import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = readFileSync(join(root, '.env.local'), 'utf8')
const line = env.split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL_UNPOOLED='))
if (!line) throw new Error('DATABASE_URL_UNPOOLED fehlt.')
const connectionString = line.slice('DATABASE_URL_UNPOOLED='.length).replace(/^["']|["']$/g, '')
const target = new URL(connectionString)
if (target.hostname.includes('-pooler') || !target.hostname.endsWith('.neon.tech')) {
  throw new Error('Eine direkte Neon-Verbindung ist erforderlich.')
}
console.log(`Ziel: ${target.hostname}${target.pathname}`)
const dryRun = process.argv.includes('--dry-run')
const client = new pg.Client({ connectionString })
await client.connect()
try {
  await client.query('BEGIN')
  const before = await client.query('SELECT count(*)::int AS count FROM trade')
  for (const name of ['0039_assistant_api_tokens.sql', '0040_assistant_trade_requests.sql']) {
    await client.query(readFileSync(join(root, 'drizzle', name), 'utf8'))
    console.log(`Geprüft: ${name}`)
  }
  const after = await client.query('SELECT count(*)::int AS count FROM trade')
  if (after.rows[0].count !== before.rows[0].count) throw new Error('Trade-Anzahl hat sich verändert.')
  const checks = await client.query("SELECT to_regclass('public.assistant_api_token') IS NOT NULL AS token_table, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trade' AND column_name = 'externalRequestKey') AS request_key")
  if (!checks.rows[0].token_table || !checks.rows[0].request_key) throw new Error('Schema-Prüfung fehlgeschlagen.')
  if (dryRun) {
    await client.query('ROLLBACK')
    console.log(`Trockentest zurückgerollt; ${before.rows[0].count} Trades unverändert.`)
  } else {
    await client.query('COMMIT')
    console.log(`Migration übernommen; ${before.rows[0].count} Trades unverändert.`)
  }
} catch (cause) {
  await client.query('ROLLBACK')
  throw cause
} finally {
  await client.end()
}
