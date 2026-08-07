// Entfernt Kerzenreihen, die unter einem ROHTICKER statt unter einem
// aufgeloesten Anbieter-Symbol im Speicher liegen.
//
// Warum es das gibt: `getCachedCandles` faellt bewusst auf den Rohticker
// zurueck, wenn ein Instrument (noch) nicht aufgeloest ist — und der
// Kerzenspeicher (Migration 0027) behaelt, was einmal geholt wurde. Beides
// zusammen konserviert einen Irrtum: Unter dem Schluessel `BTC` lag eine Reihe
// mit Kursen um 30 Dollar, weil Yahoo unter diesem Kuerzel ein ANDERES Papier
// fuehrt, waehrend Bitcoin bei 65.000 steht. Der stuendliche Sammellauf hat sie
// danach immer weiter gepflegt.
//
// Seit `lib/market-data/cached.ts` eine Wache traegt, entstehen solche Reihen
// nicht mehr. Der Altbestand muss aber weg — er wird sonst weiter ausgeliefert.
//
// Verwaist heisst hier: Das Symbol kommt in KEINEM `stock.providerSymbol` vor
// UND es ist nachweislich ein Rohticker. Nachweislich bedeutet eines von zwei
// Dingen — beide sind Belege, keine Vermutungen:
//
//   (a) Syntaktisch kann es kein Anbieter-Symbol sein (traegt `!`, `_`, `/`
//       oder ein Leerzeichen). Beispiel: `CL1!`, `OIL(CL)`.
//   (b) Es gibt ein Instrument, dessen TICKER genau so heisst, dessen
//       aufgeloestes Symbol aber ein ANDERES ist. Beispiel: `BTC` — Instrument
//       `BTC` loest auf `BTC-USD` auf, die Reihe `BTC` kann also nur ueber den
//       Rueckfall entstanden sein.
//
// Diese Vorsicht ist Absicht: Ein frisch angelegtes, noch nicht aufgeloestes
// Instrument soll seine gueltigen Kerzen nicht verlieren, nur weil der
// Hintergrundlauf noch nicht durch ist.
//
// Nutzung:
//   node scripts/clean-candle-cache.mjs --dry     (nur zeigen)
//   node scripts/clean-candle-cache.mjs           (loeschen)
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
if (!process.env.DATABASE_URL) {
  for (const line of readFileSync(join(root, '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const require = createRequire(join(root, 'package.json'))
const { Client } = require('pg')

// Dasselbe Muster wie `istGueltigesAnbieterSymbol` in
// `lib/market-data/symbol-syntax.ts`. Hier bewusst dupliziert: Ein
// Reparaturskript soll ohne TypeScript-Ladekette laufen — dafuer steht die
// Herkunft im Kommentar, und der Test dort deckt die Faelle ab.
const ANBIETER_MUSTER = /^[A-Z0-9.:^=-]+$/

const trocken = process.argv.includes('--dry')

const c = new Client({ connectionString: process.env.DATABASE_URL })
await c.connect()

const bekannt = new Set(
  (
    await c.query(
      `select distinct upper("providerSymbol") s from stock where "providerSymbol" is not null`,
    )
  ).rows.map((r) => r.s),
)

// Ticker, die auf ein ANDERES Symbol aufloesen — Beleg (b) oben.
const rohticker = new Set(
  (
    await c.query(
      `select distinct upper(ticker) t from stock
        where "providerSymbol" is not null and upper("providerSymbol") <> upper(ticker)`,
    )
  ).rows.map((r) => r.t),
)

const reihen = (
  await c.query(
    `select cs.symbol, cs.interval, cs."candleCount",
            min(cc.close) as min_close, max(cc.close) as max_close
       from candle_series cs
       left join candle_cache cc on cc.symbol = cs.symbol and cc.interval = cs.interval
      group by cs.symbol, cs.interval, cs."candleCount"
      order by cs.symbol, cs.interval`,
  )
).rows

const verwaist = reihen.filter((r) => {
  const s = String(r.symbol).toUpperCase()
  if (bekannt.has(s)) return false
  return !ANBIETER_MUSTER.test(s) || rohticker.has(s)
})

// Was uebrig bleibt, gehoert keinem Instrument mehr (geloescht, umbenannt) —
// Ballast, aber kein Irrtum. Wird nur gemeldet, nie geloescht: Diese Kerzen
// koennen jederzeit wieder gebraucht werden, und der Speicher ist billig.
const ballast = reihen.filter((r) => {
  const s = String(r.symbol).toUpperCase()
  return !bekannt.has(s) && ANBIETER_MUSTER.test(s) && !rohticker.has(s)
})
if (ballast.length > 0) {
  const namen = [...new Set(ballast.map((r) => r.symbol))]
  console.log(
    `Hinweis: ${namen.length} Symbol(e) ohne Instrument, aber unverdaechtig — ` +
      `bleiben liegen: ${namen.join(', ')}\n`,
  )
}

if (verwaist.length === 0) {
  console.log('Keine verwaisten Kerzenreihen gefunden.')
  await c.end()
  process.exit(0)
}

console.log(`${verwaist.length} verwaiste Reihe(n):`)
let kerzen = 0
for (const r of verwaist) {
  kerzen += r.candleCount ?? 0
  console.log(
    `  ${String(r.symbol).padEnd(16)} ${String(r.interval).padEnd(7)} ` +
      `${String(r.candleCount).padStart(6)} Kerzen  ` +
      `close ${r.min_close} … ${r.max_close}`,
  )
}

if (trocken) {
  console.log(`\n--dry: nichts geloescht (${kerzen} Kerzen betroffen).`)
  await c.end()
  process.exit(0)
}

const symbole = [...new Set(verwaist.map((r) => r.symbol))]
await c.query('begin')
const a = await c.query(`delete from candle_cache where symbol = any($1::text[])`, [symbole])
const b = await c.query(`delete from candle_series where symbol = any($1::text[])`, [symbole])
await c.query('commit')
console.log(`\nGeloescht: ${a.rowCount} Kerzen, ${b.rowCount} Reihen (${symbole.join(', ')}).`)

await c.end()
