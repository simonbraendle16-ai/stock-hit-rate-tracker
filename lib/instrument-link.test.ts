// Die Fälle stammen aus dem echten Bestand: 6 von 22 Trades hingen an keinem
// Instrument, weil der erfasste Ticker von dem der Watchlist abwich.

import { describe, expect, it } from 'vitest'
import {
  grundTicker,
  matchInstrument,
  normalizeTicker,
  type LinkableInstrument,
} from './instrument-link'

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

describe('grundTicker', () => {
  it('entfernt Börsensuffix und Präfix', () => {
    expect(grundTicker('RHM.DE')).toBe('RHM')
    expect(grundTicker('NASDAQ:AAPL')).toBe('AAPL')
    expect(grundTicker('XETR:SAP')).toBe('SAP')
    expect(grundTicker('0700.HK')).toBe('0700')
  })

  it('lässt Gattungen und Anbieter-Schreibweisen stehen', () => {
    // `.B` ist eine Aktiengattung, keine Börse — sie wegzuwerfen würde
    // BRK.A und BRK.B zu demselben Papier machen.
    expect(grundTicker('BRK.B')).toBe('BRK.B')
    expect(grundTicker('GC=F')).toBe('GC=F')
    expect(grundTicker('^GDAXI')).toBe('^GDAXI')
    expect(grundTicker('BTC-USD')).toBe('BTC-USD')
  })
})

describe('matchInstrument — Grundticker', () => {
  it('verbindet einen Trade auf RHM mit dem Instrument RHM.DE', () => {
    // Genau der Fall aus dem Bestand: Der Trade lief ohne Instrument, weil
    // weder Ticker noch aufgelöstes Symbol übereinstimmten.
    const r = matchInstrument('RHM', null, [
      { id: 56, ticker: 'RHM.DE', providerSymbol: 'RHM.DE' },
      { id: 9, ticker: 'SAP.DE', providerSymbol: 'SAP.DE' },
    ])
    expect(r.stockId).toBe(56)
    expect(r.reason).toBe('grundticker')
  })

  it('rät nicht, wenn dasselbe Papier an zwei Börsen geführt wird', () => {
    const r = matchInstrument('RHM', null, [
      { id: 1, ticker: 'RHM.DE', providerSymbol: 'RHM.DE' },
      { id: 2, ticker: 'RHM.F', providerSymbol: 'RHM.F' },
    ])
    expect(r.stockId).toBeNull()
    expect(r.reason).toBe('mehrdeutig')
    expect(r.competing).toEqual([1, 2])
  })

  it('verbindet nicht über blosse Namensähnlichkeit', () => {
    const r = matchInstrument('RHM', null, [
      { id: 1, ticker: 'RHEINMETALL', providerSymbol: null },
    ])
    expect(r.stockId).toBeNull()
    expect(r.reason).toBe('kein-treffer')
  })

  it('lässt die exakte Tickergleichheit vorgehen', () => {
    const r = matchInstrument('RHM', null, [
      { id: 1, ticker: 'RHM', providerSymbol: null },
      { id: 2, ticker: 'RHM.DE', providerSymbol: 'RHM.DE' },
    ])
    expect(r.stockId).toBe(1)
    expect(r.reason).toBe('exakter-ticker')
  })
})
