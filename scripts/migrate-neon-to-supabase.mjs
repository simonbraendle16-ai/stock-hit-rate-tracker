// Traegt die Bestandsdaten aus Neon in Supabase nach.
//
// WARUM ES DIESES SKRIPT GIBT
// Am 08.08.2026 hat das Neon-Projekt `neon-yellow-park` 100 % seines monatlichen
// 5-GB-Transferkontingents verbraucht. Die Sperre trifft nicht nur Verbindungen
// von aussen, sondern verhindert, dass die Compute ueberhaupt startet — auch im
// Neon-eigenen SQL-Editor. Die Daten waren damit nicht auslesbar, und die App
// ist ohne sie auf Supabase neu gestartet.
//
// Neons Abrechnungszeitraum lief `Aug 1 – Sep 1, 2026`. **Ab dem 01.09.2026**
// ist das Kontingent zurueckgesetzt, die Compute faehrt wieder hoch und dieses
// Skript kann laufen.
//
// NUTZUNG
//   node scripts/migrate-neon-to-supabase.mjs --dry     (nur zaehlen, nichts schreiben)
//   node scripts/migrate-neon-to-supabase.mjs
//
// Beide Verbindungen kommen aus `.env.local`: `NEON_DATABASE_URL` (Quelle) und
// `DATABASE_URL` (Ziel). Die Neon-Zeile steht dort genau dafuer noch drin.
//
// EIGENSCHAFTEN
// - **Idempotent.** Jede Zeile wird mit `ON CONFLICT DO NOTHING` geschrieben;
//   ein zweiter Lauf fuegt nichts doppelt ein. Ein abgebrochener Lauf darf
//   einfach wiederholt werden.
// - **Reihenfolge wird hergeleitet, nicht geraten.** Die Tabellen werden nach
//   ihren Fremdschluesseln topologisch sortiert, damit `trade` nie vor `stock`
//   ankommt. Eine handgepflegte Liste waere beim naechsten Schema-Zuwachs still
//   falsch geworden.
// - **Kerzen werden gedeckelt.** `candle_cache` kommt mit, aber je Reihe nur die
//   juengsten `RETENTION_LIMIT` Kerzen — sonst waere der Speicher sofort wieder
//   ueber dem 500-MB-Limit des Gratistarifs, das genau dieser Umzug entschaerfen
//   sollte.
// - **Laufprotokolle bleiben zurueck.** `candle_collect_run`, `alert_check_run`
//   und `symbol_sync_run` sind reine Historie und kosten nur Platz.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const trocken = process.argv.includes('--dry')

/** Wie viele Kerzen je Reihe hoechstens uebernommen werden. */
const RETENTION_LIMIT = {
  '15min': 5000,
  '30min': 3500,
  '1h': 5000,
  '4h': 3000,
  '1day': 3000,
  '1week': 1500,
  '1month': 600,
}

/** Reine Laufprotokolle — Historie ohne Wert fuer die App. */
const UEBERSPRINGEN = new Set(['candle_collect_run', 'alert_check_run', 'symbol_sync_run'])

/** Wie viele Zeilen je INSERT gebuendelt werden (Postgres: 65.535 Parameter). */
const CHUNK = 500

function ausEnv(name) {
  if (process.env[name]) return process.env[name]
  try {
    const raw = readFileSync(join(here, '..', '.env.local'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(new RegExp(`^\\s*${name}\\s*=\\s*(.*)\\s*$`))
      if (m) return m[1].replace(/^["']|["']$/g, '')
    }
  } catch {
    // Fehlermeldung kommt beim Aufrufer
  }
  return null
}

/**
 * Tabellen so sortieren, dass jede nach ihren Abhaengigkeiten kommt.
 * Zyklen (die es hier nicht gibt) wuerden am Ende einfach angehaengt.
 */
function topologisch(tabellen, kanten) {
  const offen = new Set(tabellen)
  const sortiert = []
  while (offen.size > 0) {
    const frei = [...offen].filter((t) =>
      [...(kanten.get(t) ?? [])].every((ziel) => !offen.has(ziel) || ziel === t),
    )
    if (frei.length === 0) {
      sortiert.push(...offen)
      break
    }
    frei.sort()
    for (const t of frei) {
      sortiert.push(t)
      offen.delete(t)
    }
  }
  return sortiert
}

const quelleUrl = ausEnv('NEON_DATABASE_URL')
const zielUrl = ausEnv('DATABASE_URL')

if (!quelleUrl) {
  console.error('FEHLER: NEON_DATABASE_URL fehlt (weder Umgebung noch .env.local).')
  process.exit(1)
}
if (!zielUrl) {
  console.error('FEHLER: DATABASE_URL fehlt (weder Umgebung noch .env.local).')
  process.exit(1)
}

const quelle = new pg.Client({ connectionString: quelleUrl, connectionTimeoutMillis: 20000 })
const ziel = new pg.Client({ connectionString: zielUrl, connectionTimeoutMillis: 20000 })

try {
  try {
    await quelle.connect()
  } catch (err) {
    console.error(`FEHLER: Neon antwortet nicht — ${err.message}`)
    if (/data transfer|quota/i.test(err.message)) {
      console.error(
        'Das Transferkontingent ist noch gesperrt. Es setzt zum Beginn des naechsten\n' +
          'Abrechnungszeitraums zurueck (01.09.2026). Vorher ist nichts zu holen.',
      )
    }
    process.exit(1)
  }
  await ziel.connect()

  console.log(`Quelle: ${new URL(quelleUrl).host}`)
  console.log(`Ziel:   ${new URL(zielUrl).host}`)
  if (trocken) console.log('— Trockenlauf, es wird nichts geschrieben —')

  // Tabellen und ihre Fremdschluessel-Abhaengigkeiten aus dem ZIEL lesen: Das
  // Zielschema ist der Stand, der zaehlt.
  const { rows: tabellenZeilen } = await ziel.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `)
  const { rows: fkZeilen } = await ziel.query(`
    SELECT c.conrelid::regclass::text AS quelle, c.confrelid::regclass::text AS ziel
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.contype = 'f' AND n.nspname = 'public'
  `)

  const entklammert = (s) => s.replace(/^"|"$/g, '').replace(/^public\./, '').replace(/^"|"$/g, '')
  const kanten = new Map()
  for (const r of fkZeilen) {
    const q = entklammert(r.quelle)
    const z = entklammert(r.ziel)
    if (!kanten.has(q)) kanten.set(q, new Set())
    kanten.get(q).add(z)
  }

  const alle = tabellenZeilen.map((r) => r.table_name).filter((t) => !UEBERSPRINGEN.has(t))
  const reihenfolge = topologisch(alle, kanten)

  let gesamt = 0
  for (const tabelle of reihenfolge) {
    // Spalten, die BEIDE Seiten kennen — ein Schemaunterschied darf den Lauf
    // nicht sprengen, sondern nur die betroffene Spalte auslassen.
    const spaltenQuelle = await quelle.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1`,
      [tabelle],
    )
    const spaltenZiel = await ziel.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1`,
      [tabelle],
    )
    const zielSpalten = new Set(spaltenZiel.rows.map((r) => r.column_name))
    const spalten = spaltenQuelle.rows
      .map((r) => r.column_name)
      .filter((c) => zielSpalten.has(c))

    if (spalten.length === 0) {
      console.log(`· ${tabelle}: keine gemeinsamen Spalten — uebersprungen`)
      continue
    }

    const liste = spalten.map((c) => `"${c}"`).join(', ')

    // Kerzen gedeckelt holen: je (symbol, interval) nur die juengsten N.
    let sql = `SELECT ${liste} FROM "${tabelle}"`
    if (tabelle === 'candle_cache') {
      const faelle = Object.entries(RETENTION_LIMIT)
        .map(([iv, n]) => `WHEN '${iv}' THEN ${n}`)
        .join(' ')
      sql = `
        SELECT ${liste} FROM (
          SELECT ${liste},
                 row_number() OVER (PARTITION BY "symbol", "interval" ORDER BY "time" DESC) AS rn,
                 (CASE "interval" ${faelle} ELSE 1000 END) AS grenze
          FROM "${tabelle}"
        ) s WHERE rn <= grenze`
    }

    const { rows } = await quelle.query(sql)
    if (rows.length === 0) {
      console.log(`· ${tabelle}: leer`)
      continue
    }

    if (trocken) {
      console.log(`· ${tabelle}: ${rows.length} Zeilen (wuerden uebertragen)`)
      gesamt += rows.length
      continue
    }

    let geschrieben = 0
    for (let i = 0; i < rows.length; i += CHUNK) {
      const teil = rows.slice(i, i + CHUNK)
      const werte = []
      const platzhalter = teil
        .map((zeile, j) => {
          const p = spalten.map((_, k) => `$${j * spalten.length + k + 1}`)
          for (const c of spalten) werte.push(zeile[c])
          return `(${p.join(', ')})`
        })
        .join(', ')

      const res = await ziel.query(
        `INSERT INTO "${tabelle}" (${liste}) VALUES ${platzhalter} ON CONFLICT DO NOTHING`,
        werte,
      )
      geschrieben += res.rowCount ?? 0
    }

    console.log(`✓ ${tabelle}: ${geschrieben} von ${rows.length} Zeilen uebernommen`)
    gesamt += geschrieben
  }

  if (!trocken) {
    // Sequenzen nachziehen. Ohne das vergibt `serial` wieder ab 1 und der
    // naechste Trade kollidiert mit einem uebernommenen Primaerschluessel —
    // ein Fehler, der erst beim ersten Schreiben auffiele.
    const { rows: seq } = await ziel.query(`
      SELECT s.relname AS sequenz, t.relname AS tabelle, a.attname AS spalte
      FROM pg_class s
      JOIN pg_depend d ON d.objid = s.oid
      JOIN pg_class t ON t.oid = d.refobjid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
      JOIN pg_namespace n ON n.oid = s.relnamespace
      WHERE s.relkind = 'S' AND n.nspname = 'public'
    `)
    for (const s of seq) {
      await ziel.query(
        `SELECT setval($1, COALESCE((SELECT MAX("${s.spalte}") FROM "${s.tabelle}"), 0) + 1, false)`,
        [s.sequenz],
      )
    }
    console.log(`✓ ${seq.length} Sequenzen nachgezogen.`)
  }

  console.log(`\nFertig. ${gesamt} Zeilen ${trocken ? 'gefunden' : 'uebernommen'}.`)
} catch (err) {
  console.error('FEHLER:', err.message)
  process.exitCode = 1
} finally {
  await quelle.end().catch(() => {})
  await ziel.end().catch(() => {})
}
