// Die Fälle stammen aus dem echten Bestand: 6 von 22 Trades hingen an keinem
// Instrument, weil der erfasste Ticker von dem der Watchlist abwich.

import { describe, expect, it } from 'vitest'
import { matchInstrument, normalizeTicker, type LinkableInstrument } from './instrument-link'

const watchlist: LinkableInstrument[] = [
  { id: 1, ticker: 'BTCUSD', providerSymbol: 'BTC-USD' },
  { id: 2, ticker: 'SOLUSD', providerSymbol: 'SOL-USD' },
  { id: 3, ticker: 'TTD', providerSymbol: 'TTD' },
  { id: 4, ticker: 'AAPL', providerSymbol: 'AAPL' },
  { id: 5, ticker: 'NOVO_B', providerSymbol: 'NOVO-B.CO' },
]

describe('normalizeTicker', () => {
  it('vereinheitlicht Rand, Groß-/Kleinschreibung und Gattungstrenner', () => {
    expect(normalizeTicker('  aapl ')).toBe('AAPL')
    expect(normalizeTicker('novo_b')).toBe('NOVO-B')
  })
})

describe('matchInstrument', () => {
  it('nimmt zuerst die exakte Tickergleichheit', () => {
    const r = matchInstrument('AAPL', 'AAPL', watchlist)
    expect(r.stockId).toBe(4)
    expect(r.reason).toBe('exakter-ticker')
  })

  it('verknüpft abweichende Schreibweisen über das Anbieter-Symbol', () => {
    // Der Fall aus dem Bestand: Trade als „BTC" erfasst, Instrument als „BTCUSD".
    expect(matchInstrument('BTC', 'BTC-USD', watchlist).stockId).toBe(1)
    expect(matchInstrument('BTC', 'BTC-USD', watchlist).reason).toBe('anbieter-symbol')
    expect(matchInstrument('SOL', 'SOL-USD', watchlist).stockId).toBe(2)
  })

  it('findet das Instrument auch, wenn im Trade ein NAME statt eines Kürzels steht', () => {
    // „THE TRADE DESK" löst über die Namenssuche auf `TTD` auf.
    expect(matchInstrument('THE TRADE DESK', 'TTD', watchlist).stockId).toBe(3)
  })

  it('gleicht Unterstrich und Bindestrich an', () => {
    expect(matchInstrument('NOVO-B', null, watchlist).stockId).toBe(5)
  })

  it('verknüpft NICHT, wenn zwei Instrumente dasselbe Papier führen', () => {
    // Zwei Watchlist-Einträge auf Bitcoin — hier darf nicht geraten werden.
    const doppelt: LinkableInstrument[] = [
      { id: 1, ticker: 'BTCUSD', providerSymbol: 'BTC-USD' },
      { id: 9, ticker: 'BTC', providerSymbol: 'BTC-USD' },
    ]
    const r = matchInstrument('BITCOIN', 'BTC-USD', doppelt)
    expect(r.stockId).toBeNull()
    expect(r.reason).toBe('mehrdeutig')
    expect(r.competing).toEqual([1, 9])
  })

  it('verknüpft NICHT ohne Treffer', () => {
    const r = matchInstrument('GIBTESNICHT', 'GIBTESNICHT', watchlist)
    expect(r.stockId).toBeNull()
    expect(r.reason).toBe('kein-treffer')
  })

  it('kommt ohne aufgelöstes Symbol aus — dann zählt nur der Ticker', () => {
    expect(matchInstrument('AAPL', null, watchlist).stockId).toBe(4)
    // Ohne Auflösung ist „BTC" nicht zuzuordnen — und das ist richtig so.
    expect(matchInstrument('BTC', null, watchlist).stockId).toBeNull()
  })

  it('behandelt leere Eingaben als kein Treffer statt zu raten', () => {
    expect(matchInstrument('   ', 'BTC-USD', watchlist).stockId).toBeNull()
  })
})
