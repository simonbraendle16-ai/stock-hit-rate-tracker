// Prueft, ob die gespeicherte Symbolaufloesung noch stimmt.
//
// Loest JEDES Instrument erneut auf und meldet nur Abweichungen gegen das, was
// in der Datenbank steht. Zwei Fragen beantwortet der Lauf:
//
//   Δ  Ein Instrument wuerde heute anders aufgeloest  -> Regelaenderung oder
//      Umbenennung beim Anbieter. Vor dem Uebernehmen pruefen, ob die neue
//      Zuordnung wirklich besser ist.
//   ✗  Ein Instrument findet gar keinen Treffer mehr    -> das Symbol ist beim
//      Anbieter verschwunden; die Watchlist zeigt dafuer bald keinen Kurs.
//
// Gedacht als Netz nach Aenderungen an `lib/market-data/resolve.ts` oder den
// festen Uebersetzungen in `symbol-aliases.ts`. Genau diese Bauart Fehler ist
// am 28.07.2026 durchgerutscht (`SOL` landete zwischenzeitlich auf einer
// spanischen Aktie), ohne dass ein Test angeschlagen haette.
//
// Achtung: Der Lauf fragt fuer jedes Instrument beim Anbieter nach — bei ~100
// Instrumenten dauert das einige Minuten und ist nichts fuer nebenbei.
//
// Nutzung:
//   node node_modules/.pnpm/tsx@*/node_modules/tsx/dist/cli.mjs scripts/check-resolutions.ts
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
for (const line of readFileSync(join(here, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

async function main() {
  const { db } = await import('../lib/db/index.js')
  const { stock } = await import('../lib/db/schema.js')
  const { resolveSymbol } = await import('../lib/market-data/resolve.js')

  const rows = await db.select().from(stock)
  let diff = 0
  let bad = 0
  for (const s of rows) {
    const r = await resolveSymbol({
      ticker: s.ticker,
      name: s.name,
      market: s.market as never,
    })
    if (r.status !== 'ok') {
      bad++
      console.log(`✗ ${s.ticker.padEnd(10)} war ${String(s.providerSymbol).padEnd(11)} jetzt KEIN TREFFER — ${r.note}`)
      continue
    }
    if (r.symbol !== s.providerSymbol) {
      diff++
      console.log(`Δ ${s.ticker.padEnd(10)} ${String(s.providerSymbol).padEnd(11)} → ${String(r.symbol).padEnd(11)} ${r.name}`)
    }
  }
  console.log(`\nGeprüft ${rows.length} · Abweichungen ${diff} · ohne Treffer ${bad}`)
  process.exit(0)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
