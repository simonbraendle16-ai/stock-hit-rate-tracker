// Verknüpfung Trade → Instrument.
//
// Das Problem: `createTrade` verknüpft über EXAKTE Tickergleichheit
// (`eq(stock.ticker, ticker)`). Wer den Trade als `BTC` erfasst, das Instrument
// aber als `BTCUSD` führt, bekommt keine Verknüpfung — und ohne `stockId` hat
// der Trade weder Chart noch Kerzen noch Bot-Zwilling, und er fehlt in jeder
// Instrumentensicht. Im Bestand betraf das 6 von 22 Trades: `BTC` (2), `SOL`,
// `THE TRADE DESK` (ein Name statt eines Kürzels), `AAPL`, `TSLA`.
//
// Die Lösung nutzt, was die Symbolauflösung ohnehin schon weiß: Sowohl `BTC` als
// auch `BTCUSD` lösen auf dasselbe Anbieter-Symbol `BTC-USD` auf. Das
// Anbieter-Symbol ist damit der belastbare gemeinsame Schlüssel — nicht die
// Schreibweise, die jemand eingetippt hat.
//
// Grundsatz: Verknüpft wird nur bei EINDEUTIGEM Treffer. Passen zwei Instrumente
// gleich gut, bleibt der Trade lieber unverknüpft und sichtbar offen, als still
// am falschen Instrument zu hängen — eine falsche Zuordnung verfälscht die
// Trefferquote eines Instruments dauerhaft und fällt niemandem auf.

/** Ein Instrument, soweit es für die Zuordnung gebraucht wird. */
export interface LinkableInstrument {
  id: number
  ticker: string
  /** Aufgelöstes Anbieter-Symbol (Etappe 9), sofern vorhanden. */
  providerSymbol: string | null
}

export type LinkReason =
  | 'exakter-ticker'
  | 'anbieter-symbol'
  | 'mehrdeutig'
  | 'kein-treffer'

export interface LinkResult {
  /** Das gefundene Instrument — null, wenn nichts eindeutig passt. */
  stockId: number | null
  reason: LinkReason
  /** Bei Mehrdeutigkeit: die konkurrierenden Instrumente, für die Anzeige. */
  competing: number[]
}

/** Vergleichsform eines Tickers: ohne Rand, Großschreibung, `_` wie `-`. */
export function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/_/g, '-')
}

/**
 * Ordnet einen Trade einem Instrument zu — rein, ohne Datenbank und ohne Netz.
 *
 * @param tradeTicker         Der am Trade erfasste Ticker.
 * @param tradeProviderSymbol Dessen aufgelöstes Anbieter-Symbol, falls bekannt.
 *                            Ohne Angabe greift nur die Tickergleichheit.
 * @param instruments         Die Instrumente desselben Nutzers.
 */
export function matchInstrument(
  tradeTicker: string,
  tradeProviderSymbol: string | null,
  instruments: LinkableInstrument[],
): LinkResult {
  const wanted = normalizeTicker(tradeTicker)
  if (!wanted) return { stockId: null, reason: 'kein-treffer', competing: [] }

  // 1. Exakte Tickergleichheit. Bleibt der erste Weg, weil er das bisherige
  //    Verhalten unverändert abbildet und keine Auflösung braucht.
  const byTicker = instruments.filter((s) => normalizeTicker(s.ticker) === wanted)
  if (byTicker.length === 1) {
    return { stockId: byTicker[0].id, reason: 'exakter-ticker', competing: [] }
  }
  if (byTicker.length > 1) {
    return {
      stockId: null,
      reason: 'mehrdeutig',
      competing: byTicker.map((s) => s.id),
    }
  }

  // 2. Gleiches Anbieter-Symbol. Fängt abweichende Schreibweisen ab, ohne zu
  //    raten: Beide Seiten wurden unabhängig gegen einen echten Kurs geprüft.
  if (tradeProviderSymbol) {
    const wantedSymbol = tradeProviderSymbol.trim().toUpperCase()
    const bySymbol = instruments.filter(
      (s) => s.providerSymbol && s.providerSymbol.trim().toUpperCase() === wantedSymbol,
    )
    if (bySymbol.length === 1) {
      return { stockId: bySymbol[0].id, reason: 'anbieter-symbol', competing: [] }
    }
    if (bySymbol.length > 1) {
      // Mehrere Watchlist-Einträge auf dasselbe Papier (kommt vor, etwa `BTC`
      // und `BTCUSD` nebeneinander). Hier NICHT raten — der Nutzer entscheidet,
      // welcher Eintrag der gemeinte ist.
      return {
        stockId: null,
        reason: 'mehrdeutig',
        competing: bySymbol.map((s) => s.id),
      }
    }
  }

  return { stockId: null, reason: 'kein-treffer', competing: [] }
}

/** Klartext für Protokoll und Oberfläche. */
export function describeLinkReason(reason: LinkReason): string {
  switch (reason) {
    case 'exakter-ticker':
      return 'Ticker stimmt genau überein.'
    case 'anbieter-symbol':
      return 'Zugeordnet über das gemeinsame Anbieter-Symbol.'
    case 'mehrdeutig':
      return 'Mehrere Instrumente passen gleich gut — bitte selbst zuordnen.'
    case 'kein-treffer':
      return 'Kein passendes Instrument in der Watchlist.'
  }
}
