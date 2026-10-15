import { afterEach, describe, expect, it, vi } from 'vitest'
import { ERWARTETE_GRANULARITAET, passtGranularitaet, yahooProvider } from './yahoo'
import type { Interval } from './types'

describe('Yahoo incremental session boundary', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('fetches the preceding closed bar when since is exactly the regular close', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T20:00:00Z'))
    const close = Date.parse('2026-10-15T15:30:00Z') / 1000
    vi.stubGlobal('fetch', vi.fn(async (input: URL) => {
      const url = new URL(input)
      expect(url.searchParams.get('includePrePost')).toBe('false')
      const hasBar = Number(url.searchParams.get('period1')) <= close - 300
      return new Response(JSON.stringify({ chart: { result: [{
        meta: { dataGranularity: '5m', exchangeName: 'GER', exchangeTimezoneName: 'Europe/Berlin', currentTradingPeriod: { regular: { start: close - 30600, end: close } } },
        timestamp: hasBar ? [close - 300] : [],
        indicators: { quote: [{ open: hasBar ? [40] : [], high: [41], low: [39], close: [40], volume: [100] }] },
      }] } }))
    }))
    const candles = await yahooProvider.getCandles('BAYN.DE', '5min', close)
    expect(candles.map(c => c.time)).toEqual([close - 300])
    expect((candles as typeof candles & {executionSession?: {regularOnly:boolean}}).executionSession?.regularOnly).toBe(true)
  })

  it('still rejects a genuinely empty response rather than inventing a market pause', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({chart:{result:[{meta:{dataGranularity:'5m'},timestamp:[],indicators:{quote:[{}]}}]}}))))
    await expect(yahooProvider.getCandles('BAYN.DE','5min',1792078200)).rejects.toThrow('Keine Kursdaten')
  })
})

/**
 * Die Prüfung, die Yahoos stille Herabstufung abfängt.
 *
 * Der gemessene Fall: `range=max` mit `interval=1wk` antwortet mit Status 200,
 * ohne Fehlerfeld — und `meta.dataGranularity: "3mo"`. Die Kerzen sehen aus wie
 * Wochenkerzen, sind aber Quartale. Genau dieser Fall muss verworfen werden.
 */
describe('passtGranularitaet', () => {
  it('nimmt an, was zum angefragten Intervall passt', () => {
    expect(passtGranularitaet('1week', '1wk')).toBe(true)
    expect(passtGranularitaet('1month', '1mo')).toBe(true)
    expect(passtGranularitaet('1day', '1d')).toBe(true)
    expect(passtGranularitaet('15min', '15m')).toBe(true)
    expect(passtGranularitaet('30min', '30m')).toBe(true)
    expect(passtGranularitaet('1h', '60m')).toBe(true)
  })

  it('verwirft die gemessene Herabstufung auf Quartale', () => {
    expect(passtGranularitaet('1week', '3mo')).toBe(false)
    expect(passtGranularitaet('1month', '3mo')).toBe(false)
  })

  it('verwirft auch eine Herabstufung nach oben oder unten anderswo', () => {
    expect(passtGranularitaet('15min', '1d')).toBe(false)
    expect(passtGranularitaet('1h', '1d')).toBe(false)
    expect(passtGranularitaet('1day', '1wk')).toBe(false)
  })

  it('erwartet bei 4h die 60-Minuten-Kerzen, aus denen wir es bauen', () => {
    expect(passtGranularitaet('4h', '60m')).toBe(true)
    expect(passtGranularitaet('4h', '4h')).toBe(false)
    expect(passtGranularitaet('4h', '1d')).toBe(false)
  })

  /**
   * Der gemessene Fall vom 10.08.2026: Angefragt wird `60m`, zurückgemeldet
   * wird `1h` — dieselbe Granularität, andere Schreibweise. Verglichen wurde
   * wörtlich, also flog JEDE Stundenreihe raus, und der Kurs-Snapshot fiel auf
   * Twelve Data durch, das XETRA nicht kennt.
   */
  it('erkennt 60m und 1h als dieselbe Granularität', () => {
    expect(passtGranularitaet('1h', '1h')).toBe(true)
    expect(passtGranularitaet('1h', '60m')).toBe(true)
    // Auch der 4h-Aufbau lebt von dieser Reihe.
    expect(passtGranularitaet('4h', '1h')).toBe(true)
    // Die Schutzwirkung bleibt: eine echte Abweichung fliegt weiter raus.
    expect(passtGranularitaet('1h', '30m')).toBe(false)
    expect(passtGranularitaet('1h', '1d')).toBe(false)
  })

  it('lässt Groß-/Kleinschreibung und Leerraum durchgehen', () => {
    expect(passtGranularitaet('1week', ' 1WK ')).toBe(true)
  })

  it('lässt eine fehlende Angabe durch — verworfen wird nur Nachweisbares', () => {
    expect(passtGranularitaet('1week', null)).toBe(true)
    expect(passtGranularitaet('1week', undefined)).toBe(true)
    expect(passtGranularitaet('1week', '')).toBe(true)
    expect(passtGranularitaet('1week', '   ')).toBe(true)
  })

  it('kennt für jedes Intervall eine Erwartung', () => {
    const alle: Interval[] = ['15min', '30min', '1h', '4h', '1day', '1week', '1month']
    for (const i of alle) {
      expect(ERWARTETE_GRANULARITAET[i]).toBeTruthy()
      expect(passtGranularitaet(i, ERWARTETE_GRANULARITAET[i])).toBe(true)
    }
  })
})
