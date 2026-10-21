// Read-only diagnostic. No user rows, query text, credentials or query parameters
// leave the database. Statistics are cumulative counters, not measured wire bytes.
import { pathToFileURL } from 'node:url'

/** @typedef {{ queryId: string, calls: string, rows: string, executionMs: number, tableFamily: string }} StatementStats */

const statsQuery = `SELECT queryid::text AS "queryId", calls::text, rows::text,
  total_exec_time AS "executionMs",
  CASE WHEN query ~* '(candle|quote_snapshot)' THEN 'market_data'
       WHEN query ~* '(trade|journal_entry|insight)' THEN 'personal_tables'
       ELSE 'other' END AS "tableFamily"
  FROM pg_stat_statements
  WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
    AND userid=(SELECT oid FROM pg_roles WHERE rolname=current_user)
    AND calls > 0`

export async function auditDatabaseEgress(client) {
  let began = false
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    began = true
    await client.query("SET LOCAL statement_timeout = '8s'")
    await client.query("SET LOCAL lock_timeout = '1s'")
    const { rows: [settings] } = await client.query(`SELECT
      current_setting('transaction_read_only') AS "readOnly",
      current_setting('transaction_isolation') AS isolation,
      pg_postmaster_start_time() AS "computeStartedAt"`)
    const { rows: tables } = await client.query(`SELECT relname AS "table",
      n_live_tup::text AS "estimatedRows", pg_total_relation_size(relid)::text AS "storageBytes"
      FROM pg_stat_user_tables WHERE schemaname='public'
      ORDER BY pg_total_relation_size(relid) DESC, relname LIMIT 20`)
    // Do not enable an extension or reset any statistics to obtain this report.
    const { rows: [availability] } = await client.query(`SELECT
      EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_stat_statements')
        AND to_regclass('pg_stat_statements') IS NOT NULL AS available`)
    /** @type {{ available: boolean, topByRows: StatementStats[], topByCalls: StatementStats[] }} */
    let statistics = { available: false, topByRows: [], topByCalls: [] }
    if (availability.available) {
      const { rows: topByRows } = await client.query(`${statsQuery} ORDER BY pg_stat_statements.rows DESC, pg_stat_statements.calls DESC, queryid LIMIT 20`)
      const { rows: topByCalls } = await client.query(`${statsQuery} ORDER BY pg_stat_statements.calls DESC, pg_stat_statements.rows DESC, queryid LIMIT 20`)
      statistics = { available: true, topByRows, topByCalls }
    }
    return { capturedAt: new Date().toISOString(), settings, tables, statistics,
      caveats: [
        'Rows/calls and storage size are not network-transfer bytes.',
        'Counters can reset after compute restart; absence of statistics is not zero traffic.',
        'Statement counters are live; separate rankings need not describe the exact same instant.',
        'Only the current database role is included; other roles/jobs may contribute transfer.',
        'tableFamily is a query-text heuristic, not a proven route attribution.',
        'No query text or personal row contents are included; no extension or reset is performed.',
      ] }
  } finally {
    if (began) await client.query('ROLLBACK')
  }
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('node --env-file=.env.local scripts/audit-database-egress.mjs\nUses existing DATABASE_URL. Bounded read-only metadata only; never enables extensions or resets statistics.')
    return
  }
  if (!process.env.DATABASE_URL) throw Object.assign(new Error(), { code: 'CONFIG_MISSING' })
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000, query_timeout: 10000 })
  try {
    await client.connect()
    console.log(JSON.stringify(await auditDatabaseEgress(client), null, 2))
  } finally { await client.end().catch(() => {}) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    const code = /^[A-Z0-9_]{2,40}$/.test(error?.code ?? '') ? error.code : 'AUDIT_FAILED'
    console.error(JSON.stringify({ error: code, reportComplete: false, detailsSuppressed: true }))
    process.exitCode = 1
  })
}
