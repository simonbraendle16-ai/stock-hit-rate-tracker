// Wendet die additive Trading-Cockpit-Migration gegen die DB an, auf die
// DATABASE_URL zeigt — exakt dieselbe, die die App nutzt. Kein SQL-Editor,
// keine Branch-Verwechslung. Idempotent (IF NOT EXISTS), mehrfach ausführbar.
//
// Nutzung (PowerShell):
//   $env:DATABASE_URL="<dein-prod-connection-string>"; node scripts/apply-migration.mjs

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('FEHLER: DATABASE_URL ist nicht gesetzt.')
  process.exit(1)
}

const here = dirname(fileURLToPath(import.meta.url))
const drizzleDir = join(here, '..', 'drizzle')

// Alle .sql-Migrationen in sortierter Reihenfolge (0001…, 0002…) einlesen.
const migrationFiles = readdirSync(drizzleDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

// Host (ohne Passwort) zur Kontrolle ausgeben.
try {
  const u = new URL(url)
  console.log(`→ Verbinde mit Host: ${u.host}  DB: ${u.pathname.replace('/', '')}`)
} catch {
  console.log('→ Verbinde …')
}

const pool = new pg.Pool({ connectionString: url })

try {
  for (const file of migrationFiles) {
    const sql = readFileSync(join(drizzleDir, file), 'utf8')
    await pool.query(sql)
    console.log(`✓ Migration ausgeführt: ${file}`)
  }

  const { rows } = await pool.query("SELECT to_regclass('public.trade') AS t")
  console.log(
    rows[0].t === 'trade'
      ? '✓ Tabelle "trade" existiert jetzt.'
      : '✗ Tabelle "trade" wurde NICHT gefunden — bitte melden.',
  )
} catch (err) {
  console.error('FEHLER bei der Migration:', err.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
