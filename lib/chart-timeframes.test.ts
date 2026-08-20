import { describe, expect, it } from 'vitest'
import {
  CHART_TIMEFRAME_IDS,
  KONTEXT_STUFEN,
  MAX_KONTEXT_EBENEN,
  ebenenUeber,
  intervalForTimeframe,
  isChartTimeframe,
  kontextEbene,
  kontextEbenen,
  normalizeKontextEbenen,
  serializeKontextEbenen,
} from './chart-timeframes'

describe('kontextEbene', () => {
  it('geht zwei Stufen über die Arbeitsebene', () => {
    expect(kontextEbene('15m')).toBe('1h')
    expect(kontextEbene('30m')).toBe('4h')
    expect(kontextEbene('1h')).toBe('T')
    expect(kontextEbene('4h')).toBe('W')
    expect(kontextEbene('T')).toBe('M')
  })

  it('klemmt am oberen Ende, statt umzubrechen', () => {
    expect(kontextEbene('W')).toBe('M')
    expect(kontextEbene('M')).toBe('M')
  })

  it('fällt bei Unbekanntem auf die höchste Ebene zurück', () => {
    expect(kontextEbene('quatsch')).toBe('M')
    expect(kontextEbene('')).toBe('M')
  })

  it('liefert für jede bekannte Ebene eine gültige Ebene', () => {
    for (const tf of CHART_TIMEFRAME_IDS) {
      const k = kontextEbene(tf)
      expect(isChartTimeframe(k)).toBe(true)
      expect(intervalForTimeframe(k)).toBeTruthy()
    }
  })

  it('liegt nie UNTER der Basis — der Kontext ist nie feiner als die Arbeit', () => {
    for (const tf of CHART_TIMEFRAME_IDS) {
      const basis = CHART_TIMEFRAME_IDS.indexOf(tf)
      const kontext = CHART_TIMEFRAME_IDS.indexOf(kontextEbene(tf))
      expect(kontext).toBeGreaterThanOrEqual(basis)
      expect(kontext - basis).toBeLessThanOrEqual(KONTEXT_STUFEN)
    }
  })
})

// --- Teil 4: bis zu zwei übergeordnete Ebenen -------------------------------

describe('kontextEbenen', () => {
  it('ist ohne Ebene leer', () => {
    expect(kontextEbenen('15m', 0)).toEqual([])
  })

  it('liefert bei einer Ebene genau die bisherige Vorgabe', () => {
    // Der Abnahmepunkt „ohne Auswahl wie heute": eine Ebene muss identisch
    // sein mit dem, was `kontextEbene` schon immer geliefert hat.
    for (const basis of CHART_TIMEFRAME_IDS) {
      const eine = kontextEbenen(basis, 1)
      const alt = kontextEbene(basis)
      if (alt === basis) expect(eine).toEqual([])
      else expect(eine).toEqual([alt])
    }
  })

  it('setzt bei zwei Ebenen +2 und +4 an', () => {
    expect(kontextEbenen('15m', 2)).toEqual(['1h', 'T'])
    expect(kontextEbenen('1m', 2)).toEqual(['15m', '1h'])
  })

  it('kuerzt am oberen Ende, statt dieselbe Ebene zu doppeln', () => {
    // Von „W" aus gibt es über +2 nur noch „M"; +4 traefe denselben Wert.
    expect(kontextEbenen('W', 2)).toEqual(['M'])
    expect(kontextEbenen('M', 2)).toEqual([])
  })

  it('gibt nie mehr als zwei Ebenen', () => {
    for (const basis of CHART_TIMEFRAME_IDS) {
      expect(kontextEbenen(basis, 99).length).toBeLessThanOrEqual(MAX_KONTEXT_EBENEN)
    }
  })

  it('liefert nie die Basis selbst', () => {
    for (const basis of CHART_TIMEFRAME_IDS) {
      expect(kontextEbenen(basis, 2)).not.toContain(basis)
    }
  })
})

describe('ebenenUeber', () => {
  it('nennt nur echt hoehere Ebenen', () => {
    expect(ebenenUeber('4h')).toEqual(['T', 'W', 'M'])
    expect(ebenenUeber('M')).toEqual([])
  })

  it('ist bei unbekannter Basis leer statt geraten', () => {
    expect(ebenenUeber('quatsch')).toEqual([])
  })
})

describe('normalizeKontextEbenen', () => {
  it('faellt ohne Eintrag auf die bisherige Vorgabe zurueck — NULL heisst „nie entschieden"', () => {
    expect(normalizeKontextEbenen(null, '15m')).toEqual(['1h'])
    expect(normalizeKontextEbenen(undefined, '15m')).toEqual(['1h'])
  })

  it('unterscheidet „nicht gefragt" von „mit Nein beantwortet"', () => {
    // Leeres Array ist eine Entscheidung und bleibt leer.
    expect(normalizeKontextEbenen('[]', '15m')).toEqual([])
  })

  it('nimmt eine gueltige Wahl unveraendert', () => {
    expect(normalizeKontextEbenen('["1h","T"]', '15m')).toEqual(['1h', 'T'])
  })

  it('sortiert aufsteigend — „Kontext 1" ist immer die feinere Ebene', () => {
    expect(normalizeKontextEbenen('["T","1h"]', '15m')).toEqual(['1h', 'T'])
  })

  it('verwirft Ebenen, die nicht ueber der Arbeitsebene liegen', () => {
    expect(normalizeKontextEbenen('["5m","T"]', '1h')).toEqual(['T'])
    // Gleich der Arbeitsebene zeigte denselben Chart zweimal.
    expect(normalizeKontextEbenen('["1h"]', '1h')).toEqual([])
  })

  it('verwirft Duplikate und Unbekanntes', () => {
    expect(normalizeKontextEbenen('["T","T"]', '15m')).toEqual(['T'])
    expect(normalizeKontextEbenen('["quatsch","T"]', '15m')).toEqual(['T'])
    expect(normalizeKontextEbenen('[1,2,3]', '15m')).toEqual([])
  })

  it('kappt bei zwei Ebenen', () => {
    expect(normalizeKontextEbenen('["1h","4h","T","W"]', '15m')).toEqual(['1h', '4h'])
  })

  it('behandelt kaputtes JSON als Defekt, nicht als Nein', () => {
    expect(normalizeKontextEbenen('{kaputt', '15m')).toEqual(['1h'])
    expect(normalizeKontextEbenen('"text"', '15m')).toEqual(['1h'])
  })
})

describe('serializeKontextEbenen', () => {
  it('schreibt eine gesaeuberte, sortierte Liste', () => {
    expect(serializeKontextEbenen(['T', '1h'], '15m')).toBe('["1h","T"]')
  })

  it('haelt das leere Array — es ist eine Entscheidung', () => {
    expect(serializeKontextEbenen([], '15m')).toBe('[]')
  })

  it('laesst Ungueltiges gar nicht erst in die Datenbank', () => {
    expect(serializeKontextEbenen(['5m', 'quatsch', 'T'], '1h')).toBe('["T"]')
  })

  it('ist mit normalizeKontextEbenen deckungsgleich', () => {
    for (const basis of CHART_TIMEFRAME_IDS) {
      const wahl = kontextEbenen(basis, 2)
      expect(normalizeKontextEbenen(serializeKontextEbenen(wahl, basis), basis)).toEqual(wahl)
    }
  })
})
