// Explicit target only. Never falls back to the application's production URL.
import { readFileSync } from 'node:fs'
import pg from 'pg'

const sql = readFileSync(new URL('../drizzle/0044_money_currency.sql', import.meta.url), 'utf8')
const settlements = process.argv.includes('--settlements')
const settlementSql = settlements ? readFileSync(new URL('../drizzle/0045_settlement_receipts.sql', import.meta.url), 'utf8') : null
if (!process.argv.includes('--apply')) {
  console.log('Dry-run: additive Migration 0044 (mit --settlements zusätzlich 0045); keine Verbindung, kein Backfill. MONEY_MIGRATION_DATABASE_URL und --apply erforderlich.')
  process.exit(0)
}
const connectionString = process.env.MONEY_MIGRATION_DATABASE_URL
if (!connectionString) throw new Error('Expliziter Migrationstest-/Zielzugang fehlt.')
if (new URL(connectionString).hostname.includes('-pooler')) throw new Error('Migration benötigt einen direkten Datenbankzugang.')
const client = new pg.Client({ connectionString })
try {
  await client.connect()
  await client.query('BEGIN')
  await client.query("SET LOCAL lock_timeout = '3s'; SET LOCAL statement_timeout = '30s'")
  await client.query(sql)
  if (settlementSql) await client.query(settlementSql)
  const result = await client.query(`SELECT count(*)::int AS n FROM information_schema.columns
    WHERE (table_schema = 'public' AND table_name = 'portfolio' AND column_name = 'currency') OR
    (table_schema = 'public' AND table_name = 'trade' AND column_name IN ('quoteCurrency','accountCurrency','quoteToAccountRate','fxRateAt'))`)
  if (result.rows[0].n !== 5) throw new Error('Migration unvollständig.')
  if (settlements) {
    const receiptTable = await client.query("SELECT to_regclass('public.trade_settlement_receipt') AS name")
    const receiptColumn = await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='broker_exit' AND column_name='settlementReceipt'")
    if (!receiptTable.rows[0].name || receiptColumn.rowCount !== 1) throw new Error('Abrechnungsmigration unvollständig.')
  }
  await client.query('COMMIT')
  console.log(`Migration ${settlements ? '0044/0045' : '0044'} ausgeführt und Schema zurückgelesen. Keine Bestandsumrechnung.`)
} catch {
  await client.query('ROLLBACK').catch(() => {})
  console.error('Migration fehlgeschlagen; Transaktion zurückgerollt. Keine Zugangsdaten ausgegeben.')
  process.exitCode = 1
} finally { await client.end() }
