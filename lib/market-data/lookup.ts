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
