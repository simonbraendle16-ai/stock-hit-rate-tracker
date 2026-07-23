// Bestandsaufnahme vor dem Umbau des Geld-Fundaments (Etappe 1).
// AUSSCHLIESSLICH LESEND — dieses Skript schreibt nichts in die Datenbank.
//
// Zweck:
//   1. Zählt Trades ohne Ausstiegskurs (Befund 2) und listet sie auf.
//   2. Schreibt einen vollständigen JSON-Dump aller Trades + Settings als
//      Beweis-Anker: nach dem Umbau müssen dieselben Kennzahlen herauskommen.
//
// Nutzung (PowerShell, aus dem Projektordner):
//   node scripts/baseline-report.mjs
// Die DATABASE_URL wird aus .env.local gelesen (wie bei next dev).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/** .env.local parsen — nur um DATABASE_URL zu bekommen, ohne sie auszugeben. */
function loadEnv() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  try {
    const raw = readFileSync(join(root, '.env.local'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/)
      if (m) return m[1].replace(/^["']|["']$/g, '')
    }
  } catch {
    // .env.local fehlt — fällt unten auf die Fehlermeldung durch
  }
  return null
}

const url = loadEnv()
if (!url) {
  console.error('FEHLER: DATABASE_URL nicht gefunden (weder als Umgebungsvariable noch in .env.local).')
  process.exit(1)
}

const client = new pg.Client({
  connectionString: url,
  ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
})

const outDir = process.argv[2] || join(root, '.baseline')

try {
  await client.connect()

  const { rows: trades } = await client.query('SELECT * FROM trade ORDER BY id')
  const { rows: settings } = await client.query('SELECT * FROM user_settings')
  const { rows: users } = await client.query('SELECT id, email, "createdAt" FROM "user" ORDER BY "createdAt"')

  const ausgefuehrt = trades.filter((t) => ['gewinn', 'verlust', 'breakeven'].includes(t.result))
  const echtgeld = ausgefuehrt.filter((t) => t.tradedWithMoney)
  const ohneExit = trades.filter(
    (t) => ['gewinn', 'verlust'].includes(t.result) && t.actualExitPrice == null,
  )

  console.log('\n=== BESTANDSAUFNAHME (nur gelesen, nichts verändert) ===\n')
  console.log(`Nutzer gesamt:                ${users.length}`)
  console.log(`Trades gesamt:                ${trades.length}`)
  console.log(`  davon ausgeführt:           ${ausgefuehrt.length}`)
  console.log(`  davon mit Echtgeld:         ${echtgeld.length}  → Gebühren-Backfill betrifft diese`)
  console.log(`  Status geplant:             ${trades.filter((t) => t.status === 'geplant').length}`)
  console.log(`  Status aktiv:               ${trades.filter((t) => t.status === 'aktiv').length}`)
  console.log(`  Status kein_handel:         ${trades.filter((t) => t.status === 'kein_handel').length}`)
  console.log(`\nBEFUND 2 — Gewinn/Verlust OHNE Ausstiegskurs: ${ohneExit.length}`)

  if (ohneExit.length) {
    console.log('\n  Diese Trades rechnen heute mit einem erfundenen Betrag:')
    for (const t of ohneExit) {
      const ersatz = t.result === 'gewinn' ? t.takeProfit : t.stopLoss
      const status = ersatz == null ? '⚠ KEIN Ersatzkurs im Plan — braucht deine Entscheidung' : `→ Backfill mit ${ersatz}`
      console.log(
        `   #${String(t.id).padEnd(4)} ${String(t.ticker).padEnd(10)} ${String(t.result).padEnd(8)} ` +
          `Entry ${t.entryPrice} · Größe ${t.positionSize ?? '—'}  ${status}`,
      )
    }
  } else {
    console.log('  → Keiner. Der Fallback size*10 ist bei deinen Daten nie zum Einsatz gekommen.')
  }

  // Rohdaten sichern — der Vergleichsanker für Schritt 8.
  mkdirSync(outDir, { recursive: true })
  writeFileSync(
    join(outDir, 'trades.json'),
    JSON.stringify({ erstelltAm: new Date().toISOString(), trades, settings }, null, 2),
    'utf8',
  )
  console.log(`\nRohdaten gesichert: ${join(outDir, 'trades.json')}`)
  console.log('   (Basis für den Vorher-Nachher-Abgleich am Ende der Etappe)\n')
} catch (err) {
  console.error('\nFEHLER bei der Bestandsaufnahme:', err.message)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
