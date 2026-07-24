import { describe, expect, it } from 'vitest'
import type { Candle } from './market-data/types'
import {
  alertKindLabel,
  alertTriggeredByCandles,
  candleReachesLevel,
  directionForLevel,
  isAlertDirection,
  isAlertKind,
  isLevelReached,
} from './alerts'

function candle(over: Partial<Candle> = {}): Candle {
  return { time: 1000, open: 100, high: 105, low: 95, close: 102, volume: 0, ...over }
}

describe('directionForLevel', () => {
  it('Level über dem Bezugskurs wird durch Steigen erreicht', () => {
    expect(directionForLevel(120, 100)).toBe('above')
  })
  it('Level unter dem Bezugskurs wird durch Fallen erreicht', () => {
    expect(directionForLevel(80, 100)).toBe('below')
  })
  it('Level exakt auf dem Bezugskurs ist mehrdeutig', () => {
    expect(directionForLevel(100, 100)).toBeNull()
  })
  it('nicht-endliche Eingaben ergeben null', () => {
    expect(directionForLevel(NaN, 100)).toBeNull()
    expect(directionForLevel(120, Infinity)).toBeNull()
  })
})

describe('isLevelReached', () => {
  it('above: Kurs auf oder über dem Level', () => {
    expect(isLevelReached('above', 120, 120)).toBe(true)
    expect(isLevelReached('above', 120, 121)).toBe(true)
    expect(isLevelReached('above', 120, 119)).toBe(false)
  })
  it('below: Kurs auf oder unter dem Level', () => {
    expect(isLevelReached('below', 80, 80)).toBe(true)
    expect(isLevelReached('below', 80, 79)).toBe(true)
    expect(isLevelReached('below', 80, 81)).toBe(false)
  })
})

describe('candleReachesLevel', () => {
  it('above prüft das High, nicht den Schlusskurs', () => {
    // Schlusskurs 102 < 104, aber das High 105 berührt das Level.
    expect(candleReachesLevel('above', 104, candle({ close: 102, high: 105 }))).toBe(true)
  })
  it('below prüft das Low', () => {
    expect(candleReachesLevel('below', 96, candle({ low: 95 }))).toBe(true)
    expect(candleReachesLevel('below', 94, candle({ low: 95 }))).toBe(false)
  })
})

describe('alertTriggeredByCandles', () => {
  const candles: Candle[] = [
    candle({ time: 100, high: 101, low: 99 }),
    candle({ time: 200, high: 108, low: 100 }), // berührt 105 (above)
    candle({ time: 300, high: 103, low: 90 }), // berührt 92 (below)
  ]

  it('erkennt eine Berührung nach oben', () => {
    expect(alertTriggeredByCandles('above', 105, candles)).toBe(true)
  })
  it('erkennt eine Berührung nach unten', () => {
    expect(alertTriggeredByCandles('below', 92, candles)).toBe(true)
  })
  it('löst nicht aus, wenn das Level nie erreicht wird', () => {
    expect(alertTriggeredByCandles('above', 200, candles)).toBe(false)
  })
  it('ignoriert Kerzen vor dem Anlege-Zeitpunkt', () => {
    // Die 105-Berührung liegt bei time=200; ab sinceSec=250 zählt sie nicht mehr.
    expect(alertTriggeredByCandles('above', 105, candles, 250)).toBe(false)
    // Die 92-Berührung bei time=300 zählt weiterhin.
    expect(alertTriggeredByCandles('below', 92, candles, 250)).toBe(true)
  })
  it('überspringt Kerzen mit ungültigem High/Low', () => {
    const broken: Candle[] = [candle({ time: 400, high: NaN, low: NaN })]
    expect(alertTriggeredByCandles('above', 50, broken)).toBe(false)
  })
})

describe('Katalog-Guards & Labels', () => {
  it('isAlertDirection', () => {
    expect(isAlertDirection('above')).toBe(true)
    expect(isAlertDirection('sideways')).toBe(false)
  })
  it('isAlertKind', () => {
    expect(isAlertKind('stop')).toBe(true)
    expect(isAlertKind('foo')).toBe(false)
  })
  it('alertKindLabel fällt bei Unbekanntem auf „Alert" zurück', () => {
    expect(alertKindLabel('ziel')).toBe('Ziel')
    expect(alertKindLabel('unbekannt')).toBe('Alert')
  })
})
