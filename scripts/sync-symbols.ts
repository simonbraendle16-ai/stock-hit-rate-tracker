// Symbolauflösung und Kurs-Synchronisierung von der Kommandozeile.
//
// Nutzung (PowerShell, aus dem Projektordner):
//   node node_modules/.pnpm/tsx@*/node_modules/tsx/dist/cli.mjs scripts/sync-symbols.ts
//   node node_modules/.pnpm/tsx@*/node_modules/tsx/dist/cli.mjs scripts/sync-symbols.ts --force --max 100
//   node node_modules/.pnpm/tsx@*/node_modules/tsx/dist/cli.mjs scripts/sync-symbols.ts --dry
//
// Flags:
//   --force      auch bereits bestätigte Auflösungen neu prüfen
//   --max <n>    Obergrenze der Auflösungen in diesem Lauf (Standard 25)
//   --dry        nur anzeigen, was passieren würde — schreibt nichts
//   --ids a,b,c  nur diese Instrument-IDs
//
// Im laufenden Betrieb macht das der Cron-Job (`/api/cron/sync-symbols`); dieses
// Skript ist für den Erstlauf und für die Fehlersuche.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** DATABASE_URL aus der Umgebung oder ersatzweise aus .env.local (wie next dev). */
function loadEnv() {
  const here = dirname(fileURLToPath(import.meta.url))
  let raw = ''
  try {
    raw = readFileSync(join(here, '..', '.env.local'), 'utf8')
  } catch {
    return
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
}

loadEnv()

if (!process.env.DATABASE_URL) {
  console.error('FEHLER: DATABASE_URL ist weder gesetzt noch in .env.local zu finden.')
  process.exit(1)
}

const argv = process.argv.slice(2)
const has = (flag: string) => argv.includes(flag)
const value = (flag: string) => {
  const i = argv.indexOf(flag)
  return i === -1 ? undefined : argv[i + 1]
}

async function main() {
  // Erst nach dem Laden der Umgebung importieren — `lib/db` baut den Pool beim
  // Import auf und braucht DATABASE_URL dann bereits.
  const { db } = await import('../lib/db/index.js')
  const { stock } = await import('../lib/db/schema.js')
  const { runSymbolSync } = await import('../lib/market-data/sync.js')
  const { resolveSymbol } = await import('../lib/market-data/resolve.js')

  const ids = value('--ids')
    ?.split(',')
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x))

  if (has('--dry')) {
    const rows = await db.select().from(stock)
    const targets = ids?.length ? rows.filter((r) => ids.includes(r.id)) : rows
    console.log(`Probelauf über ${targets.length} Instrumente — es wird nichts geschrieben.\n`)
    for (const s of targets) {
      const r = await resolveSymbol({
        ticker: s.ticker,
        name: s.name,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        market: s.market as any,
      })
      const mark = r.status === 'ok' ? '✓' : r.status === 'ambiguous' ? '?' : '✗'
      console.log(
        `${mark} ${s.ticker.padEnd(10)} ${String(r.symbol ?? '—').padEnd(12)} ` +
          `(${String(r.confidence).padStart(3)}) ${r.name ?? r.note}`,
      )
      if (has('--why')) {
        for (const c of r.candidates) {
          console.log(
            `      ${String(c.score).padStart(3)} ${c.symbol.padEnd(12)} ` +
              `${String(c.currency).padEnd(4)} ${c.via.padEnd(28)} ${c.name}`,
          )
        }
      }
    }
    process.exit(0)
  }

  const report = await runSymbolSync({
    trigger: 'manual',
    onlyStockIds: ids,
    forceResolve: has('--force'),
    maxResolves: value('--max') ? Number(value('--max')) : undefined,
  })

  console.log('\n=== Synchronisierung abgeschlossen ===')
  console.log(`Instrumente gesamt:      ${report.symbolsTotal}`)
  console.log(`Neu/anders aufgelöst:    ${report.resolvedNew}`)
  console.log(`Noch ohne Zuordnung:     ${report.stillUnresolved}`)
  console.log(`Kurse aktualisiert:      ${report.quotesUpdated}`)
  console.log(`Kurse ohne Ergebnis:     ${report.quotesFailed}`)
  console.log(`Dauer:                   ${(report.durationMs / 1000).toFixed(1)} s`)
  if (report.error) console.log(`Fehler:                  ${report.error}`)

  const problems = report.details.filter(
    (d) => d.action === 'ambiguous' || d.action === 'unresolved',
  )
  if (problems.length > 0) {
    console.log(`\n--- Braucht Aufmerksamkeit (${problems.length}) ---`)
    for (const p of problems) {
      console.log(`  ${p.action === 'ambiguous' ? '?' : '✗'} ${p.ticker.padEnd(10)} ${p.note}`)
    }
  }

  const resolved = report.details.filter((d) => d.action === 'resolved')
  if (resolved.length > 0) {
    console.log(`\n--- Zugeordnet (${resolved.length}) ---`)
    for (const r of resolved) {
      console.log(`  ✓ ${r.ticker.padEnd(10)} → ${String(r.symbol).padEnd(12)} ${r.note}`)
    }
  }

  process.exit(0)
}

main().catch((err) => {
  console.error('FEHLER:', err)
  process.exit(1)
})
