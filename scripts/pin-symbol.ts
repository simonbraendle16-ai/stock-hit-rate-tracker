// Ein Anbieter-Symbol von Hand festlegen — die Kommandozeilen-Fassung von
// `pinStockSymbol` (`app/actions/symbols.ts`), ohne Anmeldung.
//
// Nutzung (aus dem Projektordner):
//   node node_modules/.pnpm/tsx@*/node_modules/tsx/dist/cli.mjs \
//     scripts/pin-symbol.ts <stockId> <SYMBOL>
//
// Gedacht für Mehrdeutigkeiten aus einem Massenimport, bei denen die Zuordnung
// eindeutig ist (z. B. `MRK` → Merck & Co. gegen `MRK.DE` → Merck KGaA).
// Wie in der App gilt: Ein Symbol ohne echten Kurs wird nicht übernommen, und
// `resolutionPinned` hält die Automatik danach davon ab, es zu überschreiben.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

loadEnv()

if (!process.env.DATABASE_URL) {
  console.error('FEHLER: DATABASE_URL ist weder gesetzt noch in .env.local zu finden.')
  process.exit(1)
}

const [rawId, rawSymbol] = process.argv.slice(2)
const stockId = Number(rawId)
const symbol = (rawSymbol ?? '').trim().toUpperCase()

if (!Number.isFinite(stockId) || !symbol) {
  console.error('Nutzung: pin-symbol.ts <stockId> <SYMBOL>')
  process.exit(1)
}
if (symbol.length > 24) {
  console.error('FEHLER: Ungültiges Symbol.')
  process.exit(1)
}

async function main() {
  const { db } = await import('../lib/db/index.js')
  const { stock } = await import('../lib/db/schema.js')
  const { eq } = await import('drizzle-orm')
  const { getYahooQuotes } = await import('../lib/market-data/yahoo.js')
  const { runSymbolSync } = await import('../lib/market-data/sync.js')

  const [row] = await db.select({ id: stock.id, ticker: stock.ticker }).from(stock).where(eq(stock.id, stockId))
  if (!row) {
    console.error(`FEHLER: Instrument ${stockId} nicht gefunden.`)
    process.exit(1)
  }

  const quotes = await getYahooQuotes([symbol])
  const q = quotes.get(symbol)
  if (!q || !(q.price > 0)) {
    console.error(`FEHLER: „${symbol}“ liefert bei Yahoo keinen Kurs.`)
    process.exit(1)
  }

  await db
    .update(stock)
    .set({
      providerSymbol: q.symbol,
      provider: 'yahoo',
      resolutionStatus: 'ok',
      resolutionConfidence: 100,
      resolvedName: q.name,
      resolvedExchange: q.exchange,
      resolvedCurrency: q.currency,
      resolutionNote: 'Von Hand festgelegt.',
      resolutionApproximate: false,
      resolutionPinned: true,
      resolvedAt: new Date(),
    })
    .where(eq(stock.id, stockId))

  await runSymbolSync({ trigger: 'manual', onlyStockIds: [stockId], maxResolves: 0 })

  console.log(`✓ ${row.ticker} → ${q.symbol} (${q.name}, ${q.exchange}, ${q.currency}) ${q.price}`)
  process.exit(0)
}

main().catch((err) => {
  console.error('FEHLER:', err)
  process.exit(1)
})
