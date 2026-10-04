#!/usr/bin/env node
// Narrow, repeatable migration runner. Default: validate and roll back.
import { loadEnvFile } from 'node:process'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const flags = process.argv.slice(2)
if (flags.some((flag) => flag !== '--apply') || flags.length > 1) {
  console.error('Aufruf: node scripts/apply-demo-migration.mjs [--apply]')
  process.exit(2)
}
loadEnvFile(process.env.DEMO_MIGRATION_ENV_FILE ?? '.env.local')
const connectionString = process.env.DATABASE_URL_UNPOOLED
if (!connectionString || new URL(connectionString).hostname.includes('-pooler')) {
  console.error('Direkte DATABASE_URL_UNPOOLED erforderlich.')
  process.exit(2)
}
const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 15000 })
const client = await pool.connect()
try {
  await client.query('BEGIN')
  await client.query("SET LOCAL lock_timeout = '10s'")
  await client.query("SET LOCAL statement_timeout = '30s'")
  const sql = readFileSync(new URL('../drizzle/0043_demo_execution.sql', import.meta.url), 'utf8')
  await client.query(sql)
  await client.query(sql) // Prove repeatability in the same transaction.
  const { rows } = await client.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'trade'
      AND column_name IN ('demoCheckedAt', 'demoBoundaryAt', 'demoIssue')
  `)
  const expected = { demoCheckedAt: 'timestamp without time zone',
    demoBoundaryAt: 'timestamp without time zone', demoIssue: 'text' }
  if (rows.length !== 3 || rows.some((row) => expected[row.column_name] !== row.data_type)) {
    throw new Error('Demo-Spalten fehlen oder haben einen unerwarteten Typ.')
  }
  const state = await client.query(`SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'demo_run_state'`)
  const stateExpected = { id: 'text', nextRunAt: 'timestamp with time zone', leaseUntil: 'timestamp with time zone' }
  if (state.rows.length !== 3 || state.rows.some((row) => stateExpected[row.column_name] !== row.data_type)) {
    throw new Error('Demo-Laufzustand entspricht nicht dem erwarteten Schema.')
  }
  await client.query(flags.includes('--apply') ? 'COMMIT' : 'ROLLBACK')
  console.log(flags.includes('--apply')
    ? 'Demo-Migration 0043 angewendet und Schema geprüft.'
    : 'Demo-Migration 0043 zweimal geprüft und zurückgerollt.')
} catch (error) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('Demo-Migration fehlgeschlagen:', error.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
