import { describe, expect, it } from 'vitest'
import {
  CHART_TIMEFRAME_IDS,
  KONTEXT_STUFEN,
  intervalForTimeframe,
  isChartTimeframe,
  kontextEbene,
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
