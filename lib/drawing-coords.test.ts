import { describe, expect, it } from 'vitest'
import { barStep } from './chart-coords'
import {
  balkenIndex,
  formatKurs,
  parseBalken,
  parseKurs,
  zeitAusBalken,
} from './drawing-coords'

/** Zehn Stundenkerzen ab einem runden Zeitpunkt. */
const T0 = 1_700_000_000
const times = Array.from({ length: 10 }, (_, i) => T0 + i * 3600)
const step = barStep(times)

describe('balkenIndex', () => {
  it('zaehlt die letzte Kerze als 0 und rueckwaerts negativ', () => {
    expect(balkenIndex(times, step, times[9])).toBe(0)
    expect(balkenIndex(times, step, times[8])).toBe(-1)
    expect(balkenIndex(times, step, times[0])).toBe(-9)
  })

  it('zaehlt hinter der letzten Kerze positiv weiter', () => {
    expect(balkenIndex(times, step, times[9] + 5 * 3600)).toBe(5)
  })

  it('bleibt bei leerer Reihe bei 0, statt zu werfen', () => {
    expect(balkenIndex([], 60, T0)).toBe(0)
  })
})

describe('zeitAusBalken', () => {
  it('ist die Umkehrung von balkenIndex', () => {
    for (const b of [-9, -5, -1, 0, 3, 20]) {
      expect(balkenIndex(times, step, zeitAusBalken(times, step, b))).toBe(b)
    }
  })

  it('trifft echte Kerzenzeiten innerhalb der Reihe', () => {
    expect(zeitAusBalken(times, step, -3)).toBe(times[6])
  })

  it('schreibt hinter der Reihe auf dem Raster fort', () => {
    expect(zeitAusBalken(times, step, 4)).toBe(times[9] + 4 * 3600)
  })

  it('rundet gebrochene Eingaben auf einen ganzen Balken', () => {
    expect(zeitAusBalken(times, step, -2.4)).toBe(times[7])
  })
})

describe('parseKurs', () => {
  it('liest die deutsche Schreibweise mit Tausender-Punkt', () => {
    expect(parseKurs('63.533,80')).toBe(63533.8)
    expect(parseKurs('1.000.000,5')).toBe(1000000.5)
  })

  it('liest den Punkt als Dezimalzeichen, wenn kein Komma da ist', () => {
    expect(parseKurs('0.618')).toBe(0.618)
    expect(parseKurs('105')).toBe(105)
  })

  it('nimmt Vorzeichen und Leerzeichen hin', () => {
    expect(parseKurs(' -12,5 ')).toBe(-12.5)
  })

  it('gibt null statt einer Notloesung', () => {
    expect(parseKurs('')).toBeNull()
    expect(parseKurs('abc')).toBeNull()
    expect(parseKurs('1,2,3')).toBeNull()
    expect(parseKurs('--5')).toBeNull()
  })
})

describe('parseBalken', () => {
  it('nimmt ganze Zahlen mit Vorzeichen', () => {
    expect(parseBalken('-264')).toBe(-264)
    expect(parseBalken('0')).toBe(0)
    expect(parseBalken('+12')).toBe(12)
  })

  it('lehnt alles ab, was kein ganzer Balken ist', () => {
    expect(parseBalken('-2,5')).toBeNull()
    expect(parseBalken('')).toBeNull()
    expect(parseBalken('x')).toBeNull()
  })
})

describe('formatKurs', () => {
  it('staffelt die Nachkommastellen nach Groessenordnung', () => {
    expect(formatKurs(63533.8)).toBe('63.533,8')
    expect(formatKurs(105.1234567)).toBe('105,12')
    expect(formatKurs(1.23456789)).toBe('1,2346')
    expect(formatKurs(0.00002134)).toBe('0,000021')
  })

  it('laesst sich vom eigenen Parser wieder lesen', () => {
    for (const v of [63533.8, 105.12, 1.2346, 0.000021]) {
      expect(parseKurs(formatKurs(v))).toBeCloseTo(v, 8)
    }
  })

  it('gibt bei unbrauchbaren Zahlen einen leeren Text', () => {
    expect(formatKurs(Number.NaN)).toBe('')
  })
})
