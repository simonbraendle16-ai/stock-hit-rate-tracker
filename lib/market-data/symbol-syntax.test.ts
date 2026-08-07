import { describe, expect, it } from 'vitest'
import {
  istGueltigerTicker,
  istGueltigesAnbieterSymbol,
  unaufgeloestMeldung,
} from './symbol-syntax'

describe('istGueltigerTicker — was ein Nutzer eingetippt haben darf', () => {
  it('nimmt gewoehnliche Ticker', () => {
    for (const t of ['AAPL', 'BRK-B', '1810.HK', 'NVDA']) {
      expect(istGueltigerTicker(t)).toBe(true)
    }
  })

  it('nimmt die Schreibweisen, an denen die Routen bisher gescheitert sind', () => {
    // Genau diese vier standen im Bestand und wurden mit „Ungültiges Symbol."
    // abgewiesen — obwohl ihre Auflösung in der Datenbank korrekt war.
    expect(istGueltigerTicker('CL1!')).toBe(true)
    expect(istGueltigerTicker('YM1!')).toBe(true)
    expect(istGueltigerTicker('NOVO_B')).toBe(true)
    expect(istGueltigerTicker('THE TRADE DESK')).toBe(true)
  })

  it('nimmt auch ein direkt eingetragenes Anbieter-Symbol', () => {
    for (const t of ['CL=F', '^GDAXI', 'EUR/USD', 'NASDAQ:AAPL']) {
      expect(istGueltigerTicker(t)).toBe(true)
    }
  })

  it('ist unempfindlich gegen Klein- und Randschreibung', () => {
    expect(istGueltigerTicker('  aapl ')).toBe(true)
  })

  it('lehnt Leeres, zu Langes und fremde Zeichen ab', () => {
    expect(istGueltigerTicker('')).toBe(false)
    expect(istGueltigerTicker('   ')).toBe(false)
    expect(istGueltigerTicker(null)).toBe(false)
    expect(istGueltigerTicker(undefined)).toBe(false)
    expect(istGueltigerTicker('A'.repeat(33))).toBe(false)
    // Alles, was in einer URL oder einer Abfrage Unfug stiften koennte.
    for (const t of ['A<B', 'A&B', 'A?B', 'A#B', 'A%B', "A'B", 'A"B', 'A\\B']) {
      expect(istGueltigerTicker(t)).toBe(false)
    }
  })
})

describe('istGueltigesAnbieterSymbol — was wirklich rausgeht', () => {
  it('nimmt Terminkontrakte und Indizes — die Kernfaelle der Etappe 9', () => {
    for (const s of ['CL=F', 'GC=F', 'SI=F', 'YM=F', '^GSPC', '^GDAXI', '^NDX']) {
      expect(istGueltigesAnbieterSymbol(s)).toBe(true)
    }
  })

  it('nimmt Boersensuffixe und Krypto-Paare', () => {
    for (const s of ['ADS.DE', '1810.HK', 'BTC-USD', 'SOL-USD', 'DRO.AX']) {
      expect(istGueltigesAnbieterSymbol(s)).toBe(true)
    }
  })

  it('laesst einen unaufgeloesten Rohticker NICHT durch', () => {
    // Der Rueckfall auf den Rohticker ist Absicht — abgefragt werden darf er
    // trotzdem nicht: Yahoo kennt ein anderes Papier namens `BTC`.
    expect(istGueltigesAnbieterSymbol('CL1!')).toBe(false)
    expect(istGueltigesAnbieterSymbol('THE TRADE DESK')).toBe(false)
    expect(istGueltigesAnbieterSymbol('NOVO_B')).toBe(false)
    expect(istGueltigesAnbieterSymbol('EUR/USD')).toBe(false)
  })

  it('lehnt Leeres und zu Langes ab', () => {
    expect(istGueltigesAnbieterSymbol('')).toBe(false)
    expect(istGueltigesAnbieterSymbol(null)).toBe(false)
    expect(istGueltigesAnbieterSymbol('A'.repeat(25))).toBe(false)
  })
})

describe('unaufgeloestMeldung', () => {
  it('nennt den Wert und den naechsten Handgriff, nicht nur „ungueltig"', () => {
    const m = unaufgeloestMeldung(' CL1! ')
    expect(m).toContain('CL1!')
    expect(m).toContain('Watchlist')
    expect(m).not.toMatch(/^Ungültiges Symbol/)
  })
})
