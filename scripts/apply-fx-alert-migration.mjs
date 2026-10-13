import { readFileSync } from 'node:fs'
import pg from 'pg'
if (!process.argv.includes('--apply')) {
  console.log('Dry-run: additive Migration 0052; keine Verbindung und keine Bestandskorrektur. Expliziten FX_ALERT_MIGRATION_DATABASE_URL und --apply verwenden.')
  process.exit(0)
}
const url = process.env.FX_ALERT_MIGRATION_DATABASE_URL
if (!url || new URL(url).hostname.includes('-pooler')) throw new Error('Expliziter direkter Migrationszugang erforderlich.')
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 8000 })
try {
  await client.connect(); await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
  await client.query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='30s'")
  const fingerprintSql = `SELECT
    (SELECT md5(COALESCE(string_agg(json_build_array(id,currency,"fxRates","fxRatesAt")::text,'|' ORDER BY id),'')) FROM portfolio) AS portfolios,
    (SELECT md5(COALESCE(string_agg(json_build_array(id,"entryPrice","stopLoss","takeProfit","positionSize","investedAmount","quoteCurrency","accountCurrency","quoteToAccountRate","fxRateAt","actualExitPrice",result)::text,'|' ORDER BY id),'')) FROM trade) AS trades`
  const before = (await client.query(fingerprintSql)).rows[0]
  await client.query(readFileSync(new URL('../drizzle/0052_fx_and_alert_health.sql', import.meta.url), 'utf8'))
  const result = await client.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'
    AND table_name IN ('fx_reference_cache','plan_fx_snapshot','alert_check_state','alert_mail_delivery')`)
  if (result.rows[0].n !== 4) throw new Error('Schema unvollständig.')
  const columns = await client.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND
    ((table_name='portfolio' AND column_name='fxMode') OR (table_name='trade' AND column_name='fxSnapshotId') OR
    (table_name='alert_check_run' AND column_name IN ('complete','quotesMissing')))`)
  if (columns.rows[0].n !== 4) throw new Error('Spalten unvollständig.')
  const after = (await client.query(fingerprintSql)).rows[0]
  if (before.portfolios !== after.portfolios || before.trades !== after.trades) throw new Error('Bestandsvergleich fehlgeschlagen.')
  await client.query('COMMIT'); console.log('Migration 0052 ausgeführt; vier Tabellen und vier Spalten geprüft. Bestandsfingerabdrücke für Depot-FX und historische Trade-Geldwerte unverändert.')
} catch {
  await client.query('ROLLBACK').catch(() => {}); console.error('Migration fehlgeschlagen und zurückgerollt.'); process.exitCode = 1
} finally { await client.end() }
