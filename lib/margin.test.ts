import { describe, expect, it } from 'vitest'
import {
  berechneDeckung,
  maxKontrakte,
  parseFxRates,
  pruefeDeckung,
  umrechnen,
  type Deckung,
} from './margin'

const KURSE = { USD: 0.92 }

function deckung(over: Partial<Deckung> = {}): Deckung {
  return { kontostand: 30000, gebundeneMargin: 0, frei: 30000, ...over }
}

describe('parseFxRates', () => {
  it('liest gepflegte Kurse', () => {
    expect(parseFxRates('{"USD": 0.92, "chf": 1.05}')).toEqual({ USD: 0.92, CHF: 1.05 })
  })

  it('verwirft Unsinn statt ihn zu uebernehmen', () => {
    expect(parseFxRates('{"USD": 0}')).toEqual({})
    expect(parseFxRates('{"USD": -1}')).toEqual({})
    expect(parseFxRates('{"USD": "0.92"}')).toEqual({})
    expect(parseFxRates('kaputt')).toEqual({})
    expect(parseFxRates('[1,2]')).toEqual({})
    expect(parseFxRates(null)).toEqual({})
  })
})

describe('umrechnen', () => {
  it('laesst die Kontowaehrung unveraendert', () => {
    const u = umrechnen(1000, 'EUR', 'EUR', {})
    expect(u.ok && u.wert).toBe(1000)
  })

  it('rechnet mit dem gepflegten Kurs', () => {
    const u = umrechnen(1000, 'USD', 'EUR', KURSE)
    expect(u.ok && u.wert).toBeCloseTo(920, 6)
  })

  it('raet NICHT, wenn kein Kurs hinterlegt ist', () => {
    const u = umrechnen(1000, 'USD', 'EUR', {})
    expect(u.ok).toBe(false)
    expect(!u.ok && u.grund).toContain('USD')
  })
})

describe('berechneDeckung', () => {
  it('ist Kontostand minus gebundener Einschuss', () => {
    const d = berechneDeckung({
      startCapital: 25000,
      netCashflow: 5000,
      realisiertePnl: -2000,
      gebundeneMargin: 12420,
    })
    expect(d.kontostand).toBe(28000)
    expect(d.frei).toBe(15580)
  })

  it('zaehlt Verluste mit — nach zehn Verlusten ist nicht mehr alles frei', () => {
    const d = berechneDeckung({
      startCapital: 30000,
      netCashflow: 0,
      realisiertePnl: -20000,
      gebundeneMargin: 0,
    })
    expect(d.frei).toBe(10000)
  })

  it('darf negativ werden statt bei 0 zu luegen', () => {
    const d = berechneDeckung({
      startCapital: 10000,
      netCashflow: 0,
      realisiertePnl: 0,
      gebundeneMargin: 14000,
    })
    expect(d.frei).toBe(-4000)
  })
})

describe('pruefeDeckung', () => {
  it('laesst einen gedeckten Trade durch', () => {
    const p = pruefeDeckung({
      einschuss: 13500,
      waehrung: 'USD',
      kontowaehrung: 'EUR',
      rates: KURSE,
      deckung: deckung(),
    })
    expect(p.ok).toBe(true)
    expect(p.benoetigt).toBeCloseTo(12420, 6)
  })

  it('lehnt einen ungedeckten Trade ab — mit lesbarer Begruendung samt Zahlen', () => {
    const p = pruefeDeckung({
      einschuss: 27000,
      waehrung: 'USD',
      kontowaehrung: 'EUR',
      rates: KURSE,
      deckung: deckung({ kontostand: 30000, gebundeneMargin: 21600, frei: 8400 }),
      label: 'ES1! · 2 Kontrakte',
    })
    expect(p.ok).toBe(false)
    if (p.ok) throw new Error('unerwartet gedeckt')
    expect(p.grund).toContain('ES1! · 2 Kontrakte')
    expect(p.grund).toContain('24.840,00 EUR') // benötigt
    expect(p.grund).toContain('8.400,00 EUR') // frei
    expect(p.grund).toContain('30.000,00 EUR') // Kontostand
    expect(p.grund).toContain('21.600,00 EUR') // gebunden
  })

  it('prueft NICHT still 1:1, wenn der Umrechnungskurs fehlt — sondern sagt es', () => {
    const p = pruefeDeckung({
      einschuss: 27000,
      waehrung: 'USD',
      kontowaehrung: 'EUR',
      rates: {},
      deckung: deckung({ kontostand: 1000, gebundeneMargin: 0, frei: 1000 }),
    })
    // Der Trade wird nicht daran gehindert, dass die App etwas nicht weiss …
    expect(p.ok).toBe(true)
    // … verschwiegen wird es aber auch nicht.
    expect(p.ok && p.hinweis).toContain('NICHT gegen die Depotdeckung geprüft')
  })

  it('prueft ohne Umrechnung, wenn Kontrakt und Konto dieselbe Waehrung haben', () => {
    const p = pruefeDeckung({
      einschuss: 30000,
      waehrung: 'EUR',
      kontowaehrung: 'EUR',
      rates: {},
      deckung: deckung({ kontostand: 20000, gebundeneMargin: 0, frei: 20000 }),
    })
    expect(p.ok).toBe(false)
  })

  it('laesst einen Trade ohne Einschuss immer durch', () => {
    const p = pruefeDeckung({
      einschuss: 0,
      waehrung: 'USD',
      kontowaehrung: 'EUR',
      rates: {},
      deckung: deckung({ kontostand: 0, gebundeneMargin: 0, frei: 0 }),
    })
    expect(p.ok).toBe(true)
  })

  it('lehnt bei exakt aufgebrauchter Deckung noch nicht ab, beim naechsten Cent schon', () => {
    const genau = pruefeDeckung({
      einschuss: 10000,
      waehrung: 'EUR',
      kontowaehrung: 'EUR',
      rates: {},
      deckung: deckung({ kontostand: 10000, gebundeneMargin: 0, frei: 10000 }),
    })
    expect(genau.ok).toBe(true)
    const knapp = pruefeDeckung({
      einschuss: 10000.01,
      waehrung: 'EUR',
      kontowaehrung: 'EUR',
      rates: {},
      deckung: deckung({ kontostand: 10000, gebundeneMargin: 0, frei: 10000 }),
    })
    expect(knapp.ok).toBe(false)
  })
})

describe('maxKontrakte', () => {
  it('sagt, wie viele noch gegangen waeren', () => {
    expect(
      maxKontrakte({
        einschussJeKontrakt: 13500,
        waehrung: 'USD',
        kontowaehrung: 'EUR',
        rates: KURSE,
        frei: 30000,
      }),
    ).toBe(2) // 13.500 $ = 12.420 €; 30.000 / 12.420 = 2,41
  })

  it('ist 0, wenn nicht einmal einer geht', () => {
    expect(
      maxKontrakte({
        einschussJeKontrakt: 13500,
        waehrung: 'EUR',
        kontowaehrung: 'EUR',
        rates: {},
        frei: 5000,
      }),
    ).toBe(0)
  })

  it('ist null statt geraten, wenn der Kurs fehlt', () => {
    expect(
      maxKontrakte({
        einschussJeKontrakt: 13500,
        waehrung: 'USD',
        kontowaehrung: 'EUR',
        rates: {},
        frei: 30000,
      }),
    ).toBeNull()
  })
})
