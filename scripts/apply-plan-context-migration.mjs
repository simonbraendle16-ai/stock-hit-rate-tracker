// Narrow additive migration. Explicit direct target; no application URL fallback.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

export async function migratePlanContext(client) {
  await client.query('BEGIN')
  try {
    await client.query("SET LOCAL lock_timeout = '3s'; SET LOCAL statement_timeout = '30s'")
    const tables = ['portfolio', 'trade', 'trade_event', 'trade_target', 'journal_entry', 'insight', 'broker_order', 'broker_exit']
    await client.query(`LOCK TABLE ${tables.join(', ')} IN SHARE MODE`)
    const fingerprint = async () => {
      const result = {}
      for (const table of tables) {
        result[table] = (await client.query(`SELECT count(*)::int AS count,
          md5(coalesce(string_agg(${table === 'trade' ? "(to_jsonb(t) - 'planContext')" : 'to_jsonb(t)'}::text,
          '' ORDER BY id), '')) AS hash FROM ${table} t`)).rows[0]
      }
      return result
    }
    const before = await fingerprint()
    await client.query(readFileSync(new URL('../drizzle/0046_plan_context.sql', import.meta.url), 'utf8'))
    const { rows } = await client.query(`SELECT data_type, is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='trade' AND column_name='planContext'`)
    if (rows.length !== 1 || rows[0].data_type !== 'jsonb' || rows[0].is_nullable !== 'YES') {
      throw new Error('Unexpected plan context schema')
    }
    const after = await fingerprint()
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Historical data changed')
    await client.query('COMMIT')
    return { historyUnchanged: true, fingerprint: before, column: rows[0] }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  }
}

// Importable for isolated database checks; only the direct CLI entrypoint connects.
if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  if (!process.argv.includes('--apply')) {
    console.log('Dry-run: only additive migration 0046. No connection or backfill. Explicit PLAN_MIGRATION_DATABASE_URL and --apply required.')
  } else {
    let client
    try {
      const target = new URL(process.env.PLAN_MIGRATION_DATABASE_URL ?? '')
      if (!['postgres:', 'postgresql:'].includes(target.protocol) || target.hostname.includes('-pooler')) {
        throw new Error('Direct migration target required')
      }
      target.searchParams.set('sslmode', 'verify-full')
      client = new pg.Client({ connectionString: target.toString(), connectionTimeoutMillis: 15000 })
      await client.connect()
      await migratePlanContext(client)
      console.log('Migration 0046 committed; nullable JSONB column verified. No backfill.')
    } catch {
      console.error('Migration 0046 failed; no credentials printed. Any open migration transaction was rolled back.')
      process.exitCode = 1
    } finally { if (client) await client.end().catch(() => {}) }
  }
}
