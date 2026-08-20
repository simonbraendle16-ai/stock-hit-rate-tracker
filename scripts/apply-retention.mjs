// Setzt die gestaffelten Aufbewahrungsgrenzen RUECKWIRKEND durch.
//
// Warum es das gibt: `pruneStoredCandles` schneidet im Sammellauf immer nur die
// Reihe zurueck, die dieser Lauf gerade angefasst hat — und nur auf den Ebenen,
// die der Stufe des Instruments zustehen. Der Altbestand aus der Zeit der
// EINHEITLICHEN Grenze bleibt davon unberuehrt: Reihen, die eine Stufe gar
// nicht mehr sammelt (etwa 15min bei einem ungenutzten Instrument), fasst der
// Sammellauf nie wieder an und raeumt sie deshalb auch nie ab.
//
// Gemessen am 20.08.2026: 336 MB Datenbank von 500 MB im Gratistarif, davon
// 322 MB Kerzenspeicher (1.733.198 Kerzen in 1.001 Reihen). Allein die 49
// Instrumente ohne Trade und ohne Prognose hielten 576.074 Kerzen — rund
// 107 MB fuer Charts, die niemand aufschlaegt.
//
// Die Stufe ergibt sich aus der Nutzung, genau wie in `candle-collect.ts`:
//
//   A  offener Trade (aktiv oder geplant)              alle Ebenen, volle Tiefe
//   B  alter Trade, Prognose ODER Trainer-Sitzung      ab 15min aufwaerts
//   C  ungenutzt                                       nur 1h/Tag/Woche/Monat
//
// Ein Symbol kann in mehreren Instrumenten stecken; es gewinnt die HOECHSTE
// Stufe. Sonst verloere ein gehandeltes Papier seine Historie, weil dasselbe
// Symbol woanders ungenutzt herumsteht.
//
// Die Trainer-Sitzung haengt ueber `stockId` am Instrument, NIE ueber
// `training_session.symbol`: Dort steht der Rohticker, wie ihn der Nutzer
// eingegeben hat (Sitzung 1 heisst `CL1!`, der Kerzenspeicher kennt `CL=F`).
//
// KEIN UNBEGRENZTER LESEPFAD. Die Mengengrenze steht im SQL, nie in einer
// Nachbearbeitung im Speicher: Der Schnittpunkt wird per
// `ORDER BY time DESC OFFSET n-1 LIMIT 1` bestimmt, danach faellt alles
// aeltere in EINEM Delete. Genau der umgekehrte Weg — erst alles lesen, dann
// kuerzen — hat 5 GB Transfer verbraucht und die Datenbank abgeschaltet.
//
// ERST DEPLOYEN, DANN AUFRAEUMEN. Der Sammellauf trifft ueber Vercel dieselbe
// Datenbank. Steht dort noch der alte Code, holt er die eben geloeschten Ebenen
// binnen Minuten zurueck (gemessen beim Granularitaets-Aufraeumen: 117 von 119
// Reihen nach neun Minuten wieder da).
//
// Nutzung:
//   node scripts/apply-retention.mjs --dry     (nur zeigen, nichts loeschen)
//   node scripts/apply-retention.mjs           (durchsetzen)
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

// SPIEGEL von `RETENTION` in `lib/market-data/types.ts`. Ein Skript in reinem
// Node kann die TS-Quelle nicht importieren; wer dort eine Zahl aendert, aendert
// sie hier mit. `null` heisst: Diese Ebene gehoert dieser Stufe nicht —
// vorhandene Kerzen darauf werden vollstaendig entfernt.
const RETENTION = {
  A: {
    '1min': 1500,
    '5min': 2000,
    '15min': 2500,
    '30min': 1200,
    '1h': 5000,
    '4h': 1500,
    '1day': 2000,
    '1week': 1500,
    '1month': 600,
  },
  B: {
    '1min': null,
    '5min': null,
    '15min': 2500,
    '30min': 1200,
    '1h': 5000,
    '4h': 1500,
    '1day': 2000,
    '1week': 1500,
    '1month': 600,
  },
  C: {
    '1min': null,
    '5min': null,
    '15min': null,
    '30min': null,
    '1h': 1500,
    '4h': 1500,
    '1day': 2000,
    '1week': 1500,
    '1month': 600,
  },
}

// Gemessen am 20.08.2026: 322 MB fuer 1.733.198 Kerzen inklusive
// Primaerschluessel-Index. Die Zahl dient der Anzeige, nicht der Entscheidung.
const BYTES_JE_KERZE = 195

const trocken = process.argv.includes('--dry')

const c = new Client({ connectionString: process.env.DATABASE_URL })
await c.connect()

// Die Stufe je Anbieter-Symbol: eine Mengenabfrage statt einer Frage je
// Instrument. `max` gewinnt, damit ein Symbol mit offenem Trade seine Tiefe
// behaelt, auch wenn es anderswo nur eine Prognose traegt.
const stufenZeilen = (
  await c.query(
    `select s."providerSymbol" as symbol,
            max(case
                  when t.status in ('aktiv', 'geplant') then 3
                  when t.id is not null then 2
                  when a.id is not null then 2
                  when ts.id is not null then 2
                  else 1
                end) as rang
       from stock s
       left join trade t on t."stockId" = s.id
       left join assessment a on a."stockId" = s.id
       left join training_session ts on ts."stockId" = s.id
      where s."providerSymbol" is not null
      group by s."providerSymbol"`,
  )
).rows

const stufeJeSymbol = new Map()
for (const r of stufenZeilen) {
  const rang = Number(r.rang)
  stufeJeSymbol.set(r.symbol, rang === 3 ? 'A' : rang === 2 ? 'B' : 'C')
}

// Alle Reihen mit ihrer Kerzenzahl. Gezaehlt wird in der Datenbank; hier kommt
// eine Zeile je Reihe an, nie eine Kerze.
const reihen = (
  await c.query(
    `select symbol, interval, count(*)::int as anzahl
       from candle_cache
      group by symbol, interval
      order by symbol, interval`,
  )
).rows

if (reihen.length === 0) {
  console.log('Kerzenspeicher ist leer — nichts zu tun.')
  await c.end()
  process.exit(0)
}

const verwaist = []
const ebeneWeg = []
const kuerzen = []
let inOrdnung = 0
let unbekannteEbene = 0

for (const r of reihen) {
  const bekannt = stufeJeSymbol.has(r.symbol)
  const stufe = bekannt ? stufeJeSymbol.get(r.symbol) : 'C'
  const grenze = RETENTION[stufe]?.[r.interval]

  // Eine Ebene, die in KEINER Stufe vorkommt, ist dem Skript unbekannt — die
  // faellt nicht unter den Tisch, sondern wird gemeldet und bleibt liegen.
  if (grenze === undefined) {
    unbekannteEbene++
    continue
  }

  const fall = { ...r, stufe, grenze, verwaist: !bekannt }
  if (grenze === null) {
    ebeneWeg.push(fall)
    if (!bekannt) verwaist.push(fall)
  } else if (r.anzahl > grenze) {
    kuerzen.push({ ...fall, ueberschuss: r.anzahl - grenze })
  } else {
    inOrdnung++
  }
}

const summe = (rows, feld) => rows.reduce((s, r) => s + Number(r[feld]), 0)
const mb = (kerzen) => ((kerzen * BYTES_JE_KERZE) / (1024 * 1024)).toFixed(1)
const zahl = (n) => n.toLocaleString('de-DE')

const kerzenGesamt = summe(reihen, 'anzahl')
const wegGanz = summe(ebeneWeg, 'anzahl')
const wegKurz = summe(kuerzen, 'ueberschuss')

const jeStufe = { A: 0, B: 0, C: 0 }
for (const s of stufeJeSymbol.values()) jeStufe[s]++

console.log(
  `${reihen.length} Reihe(n), ${zahl(kerzenGesamt)} Kerzen (~${mb(kerzenGesamt)} MB).\n` +
    `Instrumente nach Stufe: A ${jeStufe.A} (offener Trade) · ` +
    `B ${jeStufe.B} (Prognose/alter Trade) · C ${jeStufe.C} (ungenutzt).\n`,
)

if (unbekannteEbene > 0) {
  console.log(
    `${unbekannteEbene} Reihe(n) auf einer Ebene, die keine Stufe kennt — ` +
      `bleiben unangetastet.\n`,
  )
}

if (ebeneWeg.length > 0) {
  console.log(
    `${ebeneWeg.length} Reihe(n) auf Ebenen, die ihrer Stufe nicht zustehen — ` +
      `vollstaendig: ${zahl(wegGanz)} Kerzen (~${mb(wegGanz)} MB)`,
  )
  for (const r of ebeneWeg.slice(0, 15)) {
    console.log(
      `  ${String(r.symbol).padEnd(16)} ${String(r.interval).padEnd(7)} ` +
        `Stufe ${r.stufe}${r.verwaist ? ' (kein Instrument)' : ''}  ` +
        `${String(r.anzahl).padStart(7)} Kerzen`,
    )
  }
  if (ebeneWeg.length > 15) console.log(`  ... und ${ebeneWeg.length - 15} weitere`)
  console.log('')
}

if (verwaist.length > 0) {
  const symbole = [...new Set(verwaist.map((r) => r.symbol))]
  console.log(
    `Davon ${symbole.length} Symbol(e) ohne jedes Instrument in der Watchlist — ` +
      `als Stufe C behandelt: ${symbole.slice(0, 10).join(', ')}` +
      `${symbole.length > 10 ? ' ...' : ''}\n`,
  )
}

if (kuerzen.length > 0) {
  console.log(
    `${kuerzen.length} Reihe(n) ueber ihrer Grenze — zurueckgeschnitten: ` +
      `${zahl(wegKurz)} Kerzen (~${mb(wegKurz)} MB)`,
  )
  for (const r of kuerzen.slice(0, 15)) {
    console.log(
      `  ${String(r.symbol).padEnd(16)} ${String(r.interval).padEnd(7)} ` +
        `Stufe ${r.stufe}  ${String(r.anzahl).padStart(7)} -> ${String(r.grenze).padStart(5)} ` +
        `(-${r.ueberschuss})`,
    )
  }
  if (kuerzen.length > 15) console.log(`  ... und ${kuerzen.length - 15} weitere`)
  console.log('')
}

console.log(`${inOrdnung} Reihe(n) liegen bereits innerhalb ihrer Grenze.`)

const gesamtWeg = wegGanz + wegKurz
if (gesamtWeg === 0) {
  console.log('\nNichts zu loeschen — die Grenzen sind bereits durchgesetzt.')
  await c.end()
  process.exit(0)
}

console.log(
  `\nZusammen: ${zahl(gesamtWeg)} Kerzen (~${mb(gesamtWeg)} MB), danach bleiben ` +
    `${zahl(kerzenGesamt - gesamtWeg)} (~${mb(kerzenGesamt - gesamtWeg)} MB).`,
)

if (trocken) {
  console.log('--dry: nichts geloescht.')
  await c.end()
  process.exit(0)
}

let geloescht = 0
let reihenWeg = 0

// Ganze Ebenen zuerst: Kerzen und die zugehoerige Reihenzeile. Bliebe der
// Eintrag in `candle_series` stehen, stuende dort eine plausible falsche Zahl —
// und der Sammellauf haette einen Stand, den es nicht mehr gibt.
if (ebeneWeg.length > 0) {
  const symbole = ebeneWeg.map((r) => r.symbol)
  const intervalle = ebeneWeg.map((r) => r.interval)
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
  geloescht += a.rowCount ?? 0
  reihenWeg += b.rowCount ?? 0
}

// Kuerzen: je Reihe ein Delete mit Schnittpunkt aus der Unterabfrage — wortgleich
// zu `pruneStoredCandles`. Danach beschreibt die Reihenzeile etwas anderes als
// vorher und wird nachgezogen; `fetchedAt` und `lastError` bleiben unangetastet,
// denn Aufraeumen ist kein Anbieterabruf und darf die Frischepruefung nicht
// beeinflussen.
for (const r of kuerzen) {
  await c.query('begin')
  const del = await c.query(
    `delete from candle_cache
      where symbol = $1 and interval = $2
        and time < (
          select time from candle_cache
           where symbol = $1 and interval = $2
           order by time desc
           offset $3 limit 1
        )`,
    [r.symbol, r.interval, r.grenze - 1],
  )
  await c.query(
    `update candle_series cs
        set "firstTime" = s.first_time,
            "lastTime" = s.last_time,
            "candleCount" = s.anzahl
       from (
         select min(time) as first_time, max(time) as last_time, count(*)::int as anzahl
           from candle_cache
          where symbol = $1 and interval = $2
       ) s
      where cs.symbol = $1 and cs.interval = $2`,
    [r.symbol, r.interval],
  )
  await c.query('commit')
  geloescht += del.rowCount ?? 0
}

console.log(`\nGeloescht: ${zahl(geloescht)} Kerzen, ${reihenWeg} Reihe(n) ganz entfernt.`)

// VACUUM, kein VACUUM FULL. Ein `DELETE` gibt die Seiten nicht frei — sie
// bleiben als tote Zeilen liegen, und `pg_total_relation_size` faellt keinen
// Millimeter. Das einfache VACUUM gibt sie zur WIEDERVERWENDUNG frei: Die
// Tabelle waechst nicht weiter, obwohl der Sammellauf weiterschreibt. Das ist
// die Groesse, auf die es ankommt.
//
// `VACUUM FULL` wuerde den Platz wirklich ans Dateisystem zurueckgeben,
// braucht dafuer aber kurzzeitig eine ZWEITE vollstaendige Kopie der Tabelle
// und sperrt sie waehrenddessen. Bei 322 MB Tabelle in einem 500-MB-Tarif ist
// das der sichere Weg, den Tarif genau beim Aufraeumen zu sprengen.
//
// VACUUM laeuft nicht in einer Transaktion — deshalb steht es hier, nach allen
// `commit`s.
console.log('\nVACUUM laeuft (kein FULL — gibt die Seiten zur Wiederverwendung frei) ...')
await c.query('vacuum candle_cache')

const nach = (
  await c.query(
    `select pg_size_pretty(pg_total_relation_size('candle_cache')) as belegt,
            pg_size_pretty(pg_database_size(current_database())) as db,
            (select count(*)::bigint from candle_cache) as kerzen`,
  )
).rows[0]
console.log(
  `Nutzdaten: ${zahl(Number(nach.kerzen))} Kerzen (~${mb(Number(nach.kerzen))} MB) — ` +
    `das ist die Groesse, die zaehlt.`,
)
console.log(
  `Belegt auf der Platte: ${nach.belegt} (faellt erst mit VACUUM FULL) · ` +
    `Datenbank gesamt ${nach.db}.`,
)
console.log('Mit --dry nachsehen, dass es leer bleibt.')

await c.end()
