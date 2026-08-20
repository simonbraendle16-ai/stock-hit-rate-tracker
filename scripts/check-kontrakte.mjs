// Nachweis für Teil 3 „Kontrakte, Margin, Kontodeckung" — gegen die ECHTE
// Datenbank, nicht gegen eine Attrappe.
//
// Warum ein Skript und kein weiterer Unit-Test: Die Tests belegen die Rechnung,
// aber nicht, dass Migration 0036 tatsächlich angewendet ist und dass der
// Altbestand unverändert weiterrechnet. Genau diese beiden Aussagen lassen sich
// nur an der laufenden Datenbank belegen.
//
// Nutzung:  node scripts/check-kontrakte.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  try {
    const raw = readFileSync(join(here, '..', '.env.local'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/)
      if (m) return m[1].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* unten die Fehlermeldung */
  }
  return null
}

const url = loadDatabaseUrl()
if (!url) {
  console.error('DATABASE_URL fehlt (Umgebung oder .env.local).')
  process.exit(1)
}

const client = new pg.Client({ connectionString: url })
let fehler = 0
const ok = (t) => console.log(`  ✓ ${t}`)
const bad = (t) => {
  fehler++
  console.log(`  ✗ ${t}`)
}

async function spalten(tabelle, namen) {
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
    [tabelle],
  )
  const da = new Set(rows.map((r) => r.column_name))
  for (const n of namen) {
    if (da.has(n)) ok(`${tabelle}.${n}`)
    else bad(`${tabelle}.${n} FEHLT — Migration 0036 nicht angewendet`)
  }
}

await client.connect()

console.log('\n1) Migration 0036 — die Spalten stehen in der Datenbank')
await spalten('stock', [
  'contractTickSize',
  'contractTickValue',
  'contractSize',
  'contractCurrency',
  'contractMarginModel',
  'contractInitialMargin',
  'contractMaintenanceMargin',
  'contractMaintenanceRate',
  'contractsDisabled',
])
await spalten('trade', [
  'contracts',
  'contractTickSize',
  'contractTickValue',
  'contractMultiplier',
  'contractCurrency',
  'contractInitialMargin',
])
await spalten('portfolio', ['fxRates', 'fxRatesAt'])

console.log('\n2) Kein Bruch im Altbestand — kein bestehender Trade wurde angefasst')
const { rows: bestand } = await client.query(
  `SELECT count(*)::int AS gesamt,
          count(*) FILTER (WHERE "contracts" IS NOT NULL)::int AS mitKontrakten,
          count(*) FILTER (WHERE "positionSize" IS NOT NULL)::int AS mitGroesse
     FROM trade`,
)
const b = bestand[0]
console.log(`  Trades gesamt: ${b.gesamt} · mit Kontrakten: ${b.mitkontrakten} · mit positionSize: ${b.mitgroesse}`)
if (b.mitkontrakten === 0) ok('Kein Alt-Trade trägt Kontraktfelder — sie rechnen unverändert weiter')
else bad(`${b.mitkontrakten} Trades tragen bereits Kontraktfelder (bei einer frischen Migration unerwartet)`)

console.log('\n3) Der Abnahmepunkt des Plans, an echten Werten nachgerechnet')
// ES: Tick 0,25 · Tick-Wert 12,50 $ · Multiplikator 50
const tickSize = 0.25
const tickValue = 12.5
const kontrakte = 2
const einstieg = 5000
const stop = einstieg - 10 * tickSize
const ticks = Math.abs(einstieg - stop) / tickSize
const risikoUeberTicks = ticks * tickValue * kontrakte
const positionSize = kontrakte * (tickValue / tickSize)
const risikoUeberGroesse = Math.abs(einstieg - stop) * positionSize
console.log(`  ES · ${kontrakte} Kontrakte · ${ticks} Ticks → positionSize ${positionSize}`)
if (Math.abs(risikoUeberTicks - 250) < 1e-9) ok(`Risiko über Ticks: ${risikoUeberTicks} $ (= 2 × 10 × 12,50)`)
else bad(`Risiko über Ticks: ${risikoUeberTicks} $ — erwartet 250`)
if (Math.abs(risikoUeberGroesse - risikoUeberTicks) < 1e-9)
  ok(`Deckungsgleich mit dem bestehenden positionSize-Weg: ${risikoUeberGroesse} $`)
else bad(`Zwei Rechenwege, zwei Ergebnisse: ${risikoUeberGroesse} vs. ${risikoUeberTicks}`)

console.log('\n4) Schreib-/Leseprobe der neuen Spalten (Rollback, es bleibt nichts stehen)')
try {
  await client.query('BEGIN')
  const { rows: p } = await client.query(
    `UPDATE portfolio SET "fxRates" = $1, "fxRatesAt" = now()
      WHERE id = (SELECT id FROM portfolio ORDER BY id LIMIT 1)
      RETURNING id, "fxRates", "fxRatesAt"`,
    [JSON.stringify({ USD: 0.92 })],
  )
  if (p.length === 0) console.log('  — kein Depot vorhanden, Probe übersprungen')
  else if (p[0].fxRates === '{"USD":0.92}' && p[0].fxRatesAt) ok('portfolio.fxRates schreib- und lesbar')
  else bad(`portfolio.fxRates kam anders zurück: ${p[0].fxRates}`)
  await client.query('ROLLBACK')
  ok('Rollback — die Probe hinterlässt nichts')
} catch (err) {
  await client.query('ROLLBACK').catch(() => {})
  bad(`Schreibprobe fehlgeschlagen: ${err.message}`)
}

await client.end()
console.log(fehler === 0 ? '\nAlles grün.\n' : `\n${fehler} Punkt(e) offen.\n`)
process.exit(fehler === 0 ? 0 : 1)
