// Die eine Stelle, an der aus dem eingetippten Ticker das Anbieter-Symbol wird.
//
// Warum zentral: Kurse, Kerzen, Sparklines, Bot-Zwilling und MAE/MFE holen alle
// Marktdaten, und alle bekamen bisher den Rohticker. Würde jeder Weg die
// Übersetzung selbst machen, wären es fünf Stellen, die auseinanderlaufen
// können — und genau eine davon würde beim nächsten neuen Symbol vergessen.
//
// Der Rückfall auf den Rohticker ist Absicht: Ist ein Instrument noch nicht
// aufgelöst (frisch angelegt, Hintergrundlauf noch nicht durch), soll die App
// sich verhalten wie vorher, statt gar nichts zu liefern.

import { db } from '@/lib/db'
import { stock } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { unstable_cache } from 'next/cache'
import type { ProviderName } from './index'

export interface ResolvedSymbol {
  /** Was tatsächlich beim Anbieter angefragt wird. */
  symbol: string
  provider: ProviderName
  /** Wurde wirklich eine bestätigte Auflösung gefunden? */
  resolved: boolean
}

/**
 * Anbieter-Symbol zu einem Ticker eines bestimmten Nutzers.
 *
 * Kurz gecacht: Auf einer Seite mit vielen Positionen wird derselbe Ticker
 * mehrfach nachgeschlagen, und die Auflösung ändert sich nur beim
 * Hintergrundlauf.
 */
export function lookupProviderSymbol(
  userId: string,
  ticker: string,
): Promise<ResolvedSymbol> {
  const clean = ticker.trim().toUpperCase()
  return unstable_cache(
    async () => {
      const [row] = await db
        .select({
          providerSymbol: stock.providerSymbol,
          provider: stock.provider,
          status: stock.resolutionStatus,
        })
        .from(stock)
        .where(and(eq(stock.userId, userId), eq(stock.ticker, clean)))
        .limit(1)

      if (row?.providerSymbol && row.status === 'ok') {
        return {
          symbol: row.providerSymbol,
          provider: (row.provider as ProviderName) ?? 'yahoo',
          resolved: true,
        }
      }
      return { symbol: clean, provider: 'yahoo' as ProviderName, resolved: false }
    },
    ['provider-symbol', userId, clean],
    { revalidate: 300 },
  )()
}

/**
 * Auflöser für viele Zeilen auf einmal — eine Abfrage statt einer je Trade.
 *
 * Warum es das zusätzlich braucht: `lookupProviderSymbol` findet über den
 * TICKER. Ein Trade trägt aber seinen eigenen, oft abweichenden Ticker: Der
 * Solana-Trade heißt `SOL`, das Instrument dazu `SOLUSD`, und beim Anbieter
 * heißt es `SOL-USD`. Über den Ticker war der Trade damit nicht aufzulösen —
 * Yahoo kennt weder `SOL` noch `SOLUSD`, und der Chart des Trades blieb leer.
 * Verbunden sind die beiden über `trade.stockId`; genau darüber geht dieser
 * Auflöser zuerst.
 *
 * Reihenfolge: verknüpftes Instrument → Tickergleichheit → Rohticker. Der
 * Rückfall auf den Rohticker bleibt Absicht (siehe oben).
 */
export async function createSymbolResolver(
  userId: string,
): Promise<(ticker: string, stockId?: number | null) => string> {
  const rows = await db
    .select({
      id: stock.id,
      ticker: stock.ticker,
      providerSymbol: stock.providerSymbol,
      status: stock.resolutionStatus,
    })
    .from(stock)
    .where(eq(stock.userId, userId))

  const byId = new Map<number, string>()
  const byTicker = new Map<string, string>()
  for (const r of rows) {
    if (!r.providerSymbol || r.status !== 'ok') continue
    byId.set(r.id, r.providerSymbol)
    byTicker.set(r.ticker.trim().toUpperCase(), r.providerSymbol)
  }

  return (ticker, stockId) => {
    const clean = ticker.trim().toUpperCase()
    if (stockId != null) {
      const viaInstrument = byId.get(stockId)
      if (viaInstrument) return viaInstrument
    }
    return byTicker.get(clean) ?? clean
  }
}
