#!/usr/bin/env node
import { loadEnvFile } from 'node:process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
if (process.env.ASSISTANT_ENV_FILE) loadEnvFile(process.env.ASSISTANT_ENV_FILE)
else { try { loadEnvFile(join(root, '.env.local')) } catch { /* URL may already be in environment. */ } }
const url = process.env.DATABASE_URL_UNPOOLED
if (!url || new URL(url).hostname.includes('-pooler')) {
  console.error('Direkte DATABASE_URL_UNPOOLED fehlt.')
  process.exit(2)
}
const apply = process.argv.includes('--apply')
if (process.argv.length !== 2 + Number(apply)) {
  console.error('Aufruf: node scripts/apply-broker-exit-migration.mjs [--apply]')
  process.exit(2)
}
const sql = readFileSync(join(root, 'drizzle', '0042_broker_exit.sql'), 'utf8')
const pool = new pg.Pool({ connectionString: url, max: 1 })
const client = await pool.connect()
try {
  await client.query('BEGIN')
  await client.query(sql)
  const check = await client.query("SELECT to_regclass('public.broker_exit') IS NOT NULL AS exists")
  if (!check.rows[0].exists) throw new Error('Ausstiegstabelle fehlt nach Migration.')
  await client.query(apply ? 'COMMIT' : 'ROLLBACK')
  console.log(apply ? 'Ausstiegsmigration angewendet.' : 'Ausstiegsmigration geprüft und zurückgerollt.')
} catch (error) {
  await client.query('ROLLBACK').catch(() => {})
  console.error(`Migration fehlgeschlagen: ${error instanceof Error ? error.message : 'unbekannt'}`)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
