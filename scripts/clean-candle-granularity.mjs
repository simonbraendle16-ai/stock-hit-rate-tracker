// Entfernt Wochen- und Monatsreihen, die in Wahrheit QUARTALSKERZEN enthalten.
//
// Warum es das gibt: Yahoo stuft bei `range=max` still auf
// `dataGranularity: "3mo"` herunter — Status 200, kein Fehlerfeld. Die App hat
// das uebernommen und denselben groben Satz sowohl unter `1week` als auch unter
// `1month` abgelegt. Gemessen an AAPL: 169 Kerzen ab 1984 mit 90-92 Tagen
// Abstand, auf beiden Ebenen identisch. Deshalb "passierte nichts" beim
// Umschalten zwischen W und M — es war zweimal dasselbe Bild.
//
// Seit `passtGranularitaet` in `lib/market-data/yahoo.ts` eine Wache traegt,
// entstehen solche Reihen nicht mehr. Der Altbestand muss aber weg: Der
// Kerzenspeicher (Migration 0027) vergisst nichts und liefert die Quartale
// sonst weiter aus, auch wenn der Anbieter laengst richtig antwortet.
//
// NUR NACHWEISBAR FALSCHES WIRD GELOESCHT. Der Beleg ist der MEDIAN-Abstand
// zwischen aufeinanderfolgenden Kerzen einer Reihe:
//
//   1week  -> erwartet 7 Tage.  Angenommen wird 5 bis 10 Tage.
//   1month -> erwartet 28-31 Tage. Angenommen wird 25 bis 35 Tage.
//
// Der Median (nicht der Durchschnitt) ist Absicht: Eine Reihe mit einer Luecke
// ueber ein Jahr — Handelspause, Symbolwechsel — wuerde den Durchschnitt
// verzerren und eine gesunde Reihe verdaechtig machen. Reihen mit zu wenigen
// Kerzen fuer ein Urteil (< 5 Abstaende) werden nur gemeldet, nie geloescht.
//
// Der Schaden im Zweifelsfall waere Ladezeit, keine Daten: Was hier faellt,
// holt der naechste Abruf neu — und dann mit richtiger Granularitaet.
//
// ERST DEPLOYEN, DANN AUFRAEUMEN — sonst ist die Arbeit in Minuten wieder weg.
//
// Gemessen am 08.08.2026: Der Lauf loeschte 119 Reihen. Neun Minuten spaeter
// waren 117 davon zurueck. Grund ist kein Fehler in diesem Skript, sondern die
// Lage: Der Sammellauf (`/api/cron/collect-candles`, getaktet aus GitHub
// Actions alle fuenf Minuten) laeuft gegen das VERCEL-Deployment und damit
// gegen dieselbe Datenbank. Solange dort noch der alte Code steht, holt er die
// herabgestuften Reihen sofort wieder herein.
//
// Reihenfolge deshalb:
//   1. Fix pushen und pruefen, dass Vercel wirklich gebaut hat.
//   2. Dieses Skript laufen lassen.
//   3. Mit --dry nachsehen, dass es leer bleibt.
//
// Wer lokal aufraeumt, waehrend die Produktion noch alt ist, repariert genau
// die Symbole, die er selbst danach abruft — und sonst keines.
//
// Nutzung:
//   node scripts/clean-candle-granularity.mjs --dry     (nur zeigen)
//   node scripts/clean-candle-granularity.mjs           (loeschen)
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

const TAG = 24 * 60 * 60

// Die Baender sind bewusst weit: Sie sollen Quartale (90 Tage) von Wochen und
// Monaten trennen, nicht Feiertage bestrafen.
const ERWARTET = {
  '1week': { min: 5 * TAG, max: 10 * TAG, text: '7 Tage' },
  '1month': { min: 25 * TAG, max: 35 * TAG, text: '28-31 Tage' },
}

// So viele Abstaende braucht es, bevor der Median als Beleg zaehlt.
const MIN_ABSTAENDE = 5

const trocken = process.argv.includes('--dry')

const c = new Client({ connectionString: process.env.DATABASE_URL })
await c.connect()

const reihen = (
  await c.query(
    `select symbol, interval,
            count(*)::int as abstaende,
            percentile_cont(0.5) within group (order by d) as median
       from (
         select symbol, interval,
                time - lag(time) over (partition by symbol, interval order by time) as d
           from candle_cache
          where interval in ('1week', '1month')
       ) t
      where d is not null and d > 0
      group by symbol, interval
      order by symbol, interval`,
  )
).rows

if (reihen.length === 0) {
  console.log('Keine Wochen- oder Monatsreihen im Kerzenspeicher.')
  await c.end()
  process.exit(0)
}

const tage = (s) => (Number(s) / TAG).toFixed(1)

const falsch = []
const unklar = []
let gesund = 0

for (const r of reihen) {
  const erwartet = ERWARTET[r.interval]
  if (!erwartet) continue
  if (r.abstaende < MIN_ABSTAENDE) {
    unklar.push(r)
    continue
  }
  const median = Number(r.median)
  if (median < erwartet.min || median > erwartet.max) falsch.push({ ...r, erwartet })
  else gesund++
}

console.log(
  `${reihen.length} Reihe(n) geprueft: ${gesund} in Ordnung, ` +
    `${falsch.length} nachweislich falsch, ${unklar.length} zu kurz fuer ein Urteil.\n`,
)

if (unklar.length > 0) {
  console.log('Zu kurz fuer ein Urteil — bleiben liegen:')
  for (const r of unklar) {
    console.log(
      `  ${String(r.symbol).padEnd(16)} ${String(r.interval).padEnd(7)} ` +
        `nur ${r.abstaende} Abstand/Abstaende`,
    )
  }
  console.log('')
}

if (falsch.length === 0) {
  console.log('Nichts zu loeschen.')
  await c.end()
  process.exit(0)
}

console.log(`${falsch.length} Reihe(n) mit falscher Granularitaet:`)
for (const r of falsch) {
  console.log(
    `  ${String(r.symbol).padEnd(16)} ${String(r.interval).padEnd(7)} ` +
      `Median ${tage(r.median).padStart(6)} Tage  (erwartet ${r.erwartet.text})`,
  )
}

if (trocken) {
  console.log(`\n--dry: nichts geloescht.`)
  await c.end()
  process.exit(0)
}

// Paarweise loeschen, nicht je Symbol: Die Tagesebene desselben Symbols ist in
// Ordnung und darf nicht mitgerissen werden.
const symbole = falsch.map((r) => r.symbol)
const intervalle = falsch.map((r) => r.interval)

await c.query('begin')
const a = await c.query(
  `delete from candle_cache cc
     using unnest($1::text[], $2::text[]) as p(symbol, interval)
    where cc.symbol = p.symbol and cc.interval = p.interval`,
  [symbole, intervalle],
)
const b = await c.query(
  `delete from candle_series cs
     using unnest($1::text[], $2::text[]) as p(symbol, interval)
    where cs.symbol = p.symbol and cs.interval = p.interval`,
  [symbole, intervalle],
)
await c.query('commit')

console.log(
  `\nGeloescht: ${a.rowCount} Kerzen, ${b.rowCount} Reihe(n). ` +
    `Der naechste Abruf holt sie mit richtiger Granularitaet neu.`,
)

await c.end()
