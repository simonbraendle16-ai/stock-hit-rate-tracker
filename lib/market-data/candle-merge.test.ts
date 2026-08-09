import { describe, expect, it } from 'vitest'
import {
  candlesToWrite,
  collectIntervalMs,
  coverageOf,
  freshnessMs,
  isDueForCollection,
  isFresh,
  mergeCandles,
  orderByStaleness,
  summarizeCoverage,
  takeLast,
} from './candle-merge'
import type { Candle } from './types'

const k = (time: number, close = 100, volume = 10): Candle => ({
  time,
  open: close - 1,
  high: close + 1,
  low: close - 2,
  close,
  volume,
})

describe('mergeCandles', () => {
  it('behält alte Kerzen, die der Anbieter nicht mehr hergibt', () => {
    // Genau der Zweck des Speichers: Yahoo liefert 15m nur 60 Tage weit.
    const gespeichert = [k(100), k(200), k(300)]
    const frisch = [k(300), k(400)]
    expect(mergeCandles(gespeichert, frisch).map((c) => c.time)).toEqual([100, 200, 300, 400])
  })

  it('lässt die frische Fassung einer Kerze gewinnen (die letzte läuft noch)', () => {
    const merged = mergeCandles([k(300, 100)], [k(300, 105)])
    expect(merged).toHaveLength(1)
    expect(merged[0].close).toBe(105)
  })

  it('sortiert nach Zeit, auch wenn der Anbieter durcheinander liefert', () => {
    expect(mergeCandles([k(300)], [k(100), k(200)]).map((c) => c.time)).toEqual([100, 200, 300])
  })

  it('kommt mit leeren Seiten zurecht', () => {
    expect(mergeCandles([], [])).toEqual([])
    expect(mergeCandles([k(100)], []).map((c) => c.time)).toEqual([100])
    expect(mergeCandles([], [k(100)]).map((c) => c.time)).toEqual([100])
  })
})

describe('candlesToWrite', () => {
  it('schreibt nur Neues und tatsächlich Verändertes', () => {
    const gespeichert = [k(100), k(200), k(300, 100)]
    const frisch = [k(200), k(300, 107), k(400)]
    expect(candlesToWrite(gespeichert, frisch).map((c) => c.time)).toEqual([300, 400])
  })

  it('schreibt nichts, wenn sich nichts geändert hat', () => {
    const satz = [k(100), k(200)]
    expect(candlesToWrite(satz, satz)).toEqual([])
  })

  it('merkt auch eine reine Volumenänderung', () => {
    expect(candlesToWrite([k(100, 100, 10)], [k(100, 100, 11)])).toHaveLength(1)
  })
})

describe('coverageOf', () => {
  it('liefert Rand und Anzahl', () => {
    expect(coverageOf([k(300), k(100), k(200)])).toEqual({
      firstTime: 100,
      lastTime: 300,
      count: 3,
    })
  })

  it('bleibt auf einer leeren Reihe still', () => {
    expect(coverageOf([])).toEqual({ firstTime: null, lastTime: null, count: 0 })
  })
})

describe('Frische', () => {
  it('gibt Intraday 15 Minuten und allem darüber 12 Stunden', () => {
    expect(freshnessMs('15min')).toBe(15 * 60 * 1000)
    expect(freshnessMs('4h')).toBe(15 * 60 * 1000)
    expect(freshnessMs('1day')).toBe(12 * 60 * 60 * 1000)
  })

  it('gilt nie ohne Zeitstempel', () => {
    expect(isFresh('1day', null)).toBe(false)
  })

  it('prüft gegen die Uhr', () => {
    const jetzt = new Date('2026-08-03T12:00:00Z')
    expect(isFresh('15min', new Date('2026-08-03T11:50:00Z'), jetzt)).toBe(true)
    expect(isFresh('15min', new Date('2026-08-03T11:40:00Z'), jetzt)).toBe(false)
    expect(isFresh('1day', new Date('2026-08-03T02:00:00Z'), jetzt)).toBe(true)
  })
})

describe('takeLast', () => {
  it('gibt die jüngsten Kerzen zurück', () => {
    expect(takeLast([k(1), k(2), k(3)], 2).map((c) => c.time)).toEqual([2, 3])
  })

  it('gibt bei 0 oder negativem Limit alles zurück', () => {
    expect(takeLast([k(1), k(2)], 0)).toHaveLength(2)
    expect(takeLast([k(1), k(2)], -5)).toHaveLength(2)
  })

  it('kürzt nicht, wenn es ohnehin weniger sind', () => {
    expect(takeLast([k(1)], 900)).toHaveLength(1)
  })
})

describe('orderByStaleness', () => {
  it('stellt nie geholte Reihen nach vorn, dann die ältesten', () => {
    const rows = [
      { name: 'b', fetchedAt: new Date('2026-08-01T00:00:00Z') },
      { name: 'neu', fetchedAt: null },
      { name: 'a', fetchedAt: new Date('2026-07-01T00:00:00Z') },
    ]
    expect(orderByStaleness(rows).map((r) => r.name)).toEqual(['neu', 'a', 'b'])
  })
})

describe('summarizeCoverage', () => {
  const TAG = 86400
  it('nimmt je Zeitebene die längste Reihe, nicht den Durchschnitt', () => {
    const rows = [
      { interval: '15min', firstTime: 0, lastTime: 60 * TAG, candleCount: 5000 },
      { interval: '15min', firstTime: 0, lastTime: 10 * TAG, candleCount: 900 },
      { interval: '1day', firstTime: 0, lastTime: 3650 * TAG, candleCount: 2500 },
    ]
    const s = summarizeCoverage(rows, ['15min', '1day', '1week'])
    expect(s.find((r) => r.interval === '15min')).toEqual({
      interval: '15min',
      days: 60,
      symbols: 2,
      candles: 5900,
    })
    expect(s.find((r) => r.interval === '1day')!.days).toBe(3650)
    // Zeitebene ohne jede Reihe erscheint trotzdem — mit ehrlicher Null.
    expect(s.find((r) => r.interval === '1week')).toEqual({
      interval: '1week',
      days: 0,
      symbols: 0,
      candles: 0,
    })
  })

  it('zählt leere Reihen nicht mit', () => {
    const s = summarizeCoverage(
      [{ interval: '1h', firstTime: null, lastTime: null, candleCount: 0 }],
      ['1h'],
    )
    expect(s[0]).toMatchObject({ symbols: 0, days: 0 })
  })
})

describe('Sammellauf-Fälligkeit', () => {
  it('holt kleine Zeitebenen täglich, große wöchentlich', () => {
    expect(collectIntervalMs('15min')).toBeLessThan(24 * 60 * 60 * 1000)
    expect(collectIntervalMs('1h')).toBeLessThan(24 * 60 * 60 * 1000)
    expect(collectIntervalMs('1day')).toBeGreaterThan(6 * 24 * 60 * 60 * 1000)
  })

  it('ist ohne Zeitstempel immer fällig', () => {
    expect(isDueForCollection('1month', null)).toBe(true)
  })

  it('wartet die Staffel ab', () => {
    const jetzt = new Date('2026-08-03T12:00:00Z')
    expect(isDueForCollection('15min', new Date('2026-08-03T00:00:00Z'), jetzt)).toBe(false)
    expect(isDueForCollection('15min', new Date('2026-08-02T00:00:00Z'), jetzt)).toBe(true)
    expect(isDueForCollection('1day', new Date('2026-07-30T12:00:00Z'), jetzt)).toBe(false)
    expect(isDueForCollection('1day', new Date('2026-07-20T12:00:00Z'), jetzt)).toBe(true)
  })
})

/**
 * Die Rechtfertigung für die SQL-Begrenzung in `readStoredCandles`.
 *
 * `getStoredCandles` liest seit dem Transfer-Fix nicht mehr die ganze Reihe,
 * sondern nur noch deren jüngste `limit` Kerzen, und führt DIESEN Ausschnitt
 * mit dem frischen Satz des Anbieters zusammen. Das ist nur zulässig, wenn
 * dabei exakt dasselbe herauskommt wie beim Zusammenführen der vollständigen
 * Reihe. Genau das prüfen diese Tests — fällt einer, ist die Begrenzung nicht
 * mehr verlustfrei und der Chart zeigt stillschweigend etwas anderes an.
 */
describe('Ausschnitt statt Vollabzug (Transfer-Fix)', () => {
  const alle = Array.from({ length: 500 }, (_, i) => k(1000 + i * 60, 100 + i))
  const limit = 50

  it('liefert dasselbe Fenster wie der Vollabzug, wenn der Anbieter anschließt', () => {
    // Anbieter liefert die letzten drei Kerzen neu plus zwei echte neue.
    const frisch = [
      k(1000 + 497 * 60, 999),
      k(1000 + 498 * 60, 998),
      k(1000 + 499 * 60, 997),
      k(1000 + 500 * 60, 996),
      k(1000 + 501 * 60, 995),
    ]
    const schwanz = takeLast(alle, limit)

    expect(takeLast(mergeCandles(schwanz, frisch), limit)).toEqual(
      takeLast(mergeCandles(alle, frisch), limit),
    )
  })

  it('liefert dasselbe Fenster, wenn der Anbieter gar nichts Neues hat', () => {
    const schwanz = takeLast(alle, limit)
    expect(takeLast(mergeCandles(schwanz, []), limit)).toEqual(
      takeLast(mergeCandles(alle, []), limit),
    )
  })

  it('übernimmt Korrekturen des Anbieters an bereits gespeicherten Kerzen', () => {
    // Dieselbe Zeit, anderer Schluss — der frische Satz muss gewinnen.
    const korrigiert = k(1000 + 499 * 60, 4242)
    const schwanz = takeLast(alle, limit)
    const fenster = takeLast(mergeCandles(schwanz, [korrigiert]), limit)

    expect(fenster[fenster.length - 1].close).toBe(4242)
    expect(fenster).toEqual(takeLast(mergeCandles(alle, [korrigiert]), limit))
  })

  it('vergleicht nur das Fenster, das der Anbieter überhaupt abdeckt', () => {
    // `candlesToWrite` bekommt seit dem Fix nur noch die gespeicherten Kerzen
    // ab dem ältesten frischen Zeitpunkt. Ältere können mit keiner frischen
    // Kerze kollidieren — das Ergebnis muss daher identisch sein.
    const frisch = [k(1000 + 498 * 60, 998), k(1000 + 499 * 60, 997), k(1000 + 500 * 60, 996)]
    const aeltester = Math.min(...frisch.map((c) => c.time))
    const fenster = alle.filter((c) => c.time >= aeltester)

    expect(candlesToWrite(fenster, frisch)).toEqual(candlesToWrite(alle, frisch))
  })
})
