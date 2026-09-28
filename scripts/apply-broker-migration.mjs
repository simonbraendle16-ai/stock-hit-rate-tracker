#!/usr/bin/env node
import { loadEnvFile } from 'node:process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
try { loadEnvFile(join(root, '.env.local')) } catch {
  if (!process.env.DATABASE_URL_UNPOOLED) {
    console.error('Datenbankverbindung fehlt.')
    process.exit(2)
  }
}
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
if (!url) { console.error('Datenbankverbindung fehlt.'); process.exit(2) }
const apply = process.argv.includes('--apply')
if (process.argv.length !== 2 + Number(apply)) {
  console.error('Aufruf: node scripts/apply-broker-migration.mjs [--apply]')
  process.exit(2)
}
const sql = readFileSync(join(root, 'drizzle', '0041_broker_orders.sql'), 'utf8')
const pool = new pg.Pool({ connectionString: url, max: 1 })
const client = await pool.connect()
try {
  await client.query('BEGIN')
  const before = await client.query("SELECT to_regclass('public.broker_order') IS NOT NULL AS exists")
  await client.query(sql)
  const after = await client.query("SELECT to_regclass('public.broker_order') IS NOT NULL AS exists")
  if (!after.rows[0].exists) throw new Error('Broker-Tabelle wurde nicht angelegt.')
  if (apply) {
    await client.query('COMMIT')
    console.log(`Migration angewendet. Tabelle zuvor vorhanden: ${before.rows[0].exists}.`)
  } else {
    await client.query('ROLLBACK')
    console.log(`Migration in Transaktion geprüft und zurückgerollt. Tabelle zuvor vorhanden: ${before.rows[0].exists}.`)
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => {})
  console.error(`Migration fehlgeschlagen: ${error instanceof Error ? error.message : 'unbekannt'}`)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
