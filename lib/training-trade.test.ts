import { describe, expect, it } from 'vitest'
import {
  clampStopEvery,
  computeInterventionCost,
  DEFAULT_STOP_EVERY,
  fortschrittZeit,
  measureOutcome,
  nextStopAt,
  suggestRating,
  summarizeSession,
  validateTradeDraft,
  type TradeDraft,
} from './training-trade'
import type { Candle } from './market-data/types'

function candle(time: number, low: number, high: number, close = (low + high) / 2): Candle {
  return { time, open: close, high, low, close, volume: 0 }
}

const draft = (over: Partial<TradeDraft> = {}): TradeDraft => ({
  direction: 'long',
  entryPrice: 100,
  stopLoss: 90,
  takeProfit: 120,
  elliottCount: null,
  invalidation: null,
  thesisNote: null,
  setupTags: [],
  ...over,
})

describe('validateTradeDraft', () => {
  it('nimmt eine vollständige Long-These an', () => {
    expect(validateTradeDraft(draft(), 'frei')).toEqual([])
  })

  it('verlangt eine Richtung', () => {
    expect(validateTradeDraft(draft({ direction: null }), 'frei')).toEqual(['Richtung fehlt.'])
  })

  it('lässt „Kein Setup" ohne jede Marke zu', () => {
    const d = draft({ direction: 'keine', entryPrice: null, stopLoss: null, takeProfit: null })
    expect(validateTradeDraft(d, 'elliott')).toEqual([])
  })

  it('verlangt Einstieg, Stop und Ziel, sobald gehandelt wird', () => {
    const d = draft({ entryPrice: null, stopLoss: null, takeProfit: null })
    expect(validateTradeDraft(d, 'frei')).toEqual(['Einstieg fehlt.', 'Stop fehlt.', 'Ziel fehlt.'])
  })

  it('lehnt Stop gleich Einstieg ab — kein Risiko, kein R', () => {
    const f = validateTradeDraft(draft({ stopLoss: 100 }), 'frei')
    expect(f).toHaveLength(1)
    expect(f[0]).toMatch(/kein Risiko/)
  })

  it('prüft die Seiten bei Long', () => {
    expect(validateTradeDraft(draft({ stopLoss: 110 }), 'frei')).toContain(
      'Bei Long muss der Stop unter dem Einstieg liegen.',
    )
    expect(validateTradeDraft(draft({ takeProfit: 80 }), 'frei')).toContain(
      'Bei Long muss das Ziel über dem Einstieg liegen.',
    )
  })

  it('prüft die Seiten bei Short', () => {
    const d = draft({ direction: 'short', entryPrice: 100, stopLoss: 110, takeProfit: 80 })
    expect(validateTradeDraft(d, 'frei')).toEqual([])
    expect(validateTradeDraft({ ...d, stopLoss: 90 }, 'frei')).toContain(
      'Bei Short muss der Stop über dem Einstieg liegen.',
    )
  })

  it('verlangt im Elliott-Modus Zählung und Invalidation', () => {
    const f = validateTradeDraft(draft(), 'elliott')
    expect(f).toEqual(['Wellenzählung fehlt.', 'Invalidation fehlt.'])
    expect(
      validateTradeDraft(draft({ elliottCount: 'Welle 3', invalidation: 89 }), 'elliott'),
    ).toEqual([])
  })
})

describe('measureOutcome', () => {
  const long = { direction: 'long' as const, entryPrice: 100, stopLoss: 90, takeProfit: 120 }

  it('erkennt das Ziel und rechnet R', () => {
    const m = measureOutcome(long, [candle(10, 99, 105), candle(20, 110, 121)], 5)!
    expect(m.outcome).toBe('ziel')
    expect(m.atTime).toBe(20)
    expect(m.rMultiple).toBeCloseTo(2) // 20 Gewinn / 10 Risiko
    expect(m.ambiguous).toBe(false)
  })

  it('erkennt den Stop', () => {
    const m = measureOutcome(long, [candle(10, 89, 105)], 5)!
    expect(m.outcome).toBe('stop')
    expect(m.rMultiple).toBeCloseTo(-1)
  })

  it('nimmt bei Stop UND Ziel in derselben Kerze den Stop und weist es aus', () => {
    const m = measureOutcome(long, [candle(10, 89, 121)], 5)!
    expect(m.outcome).toBe('stop')
    expect(m.ambiguous).toBe(true)
  })

  it('lässt die Einstiegskerze selbst außen vor', () => {
    // Die Kerze BEI fromSec enthält Bewegung von vor dem Einstieg.
    const m = measureOutcome(long, [candle(5, 80, 130), candle(10, 99, 105)], 5)!
    expect(m.outcome).toBe('offen')
  })

  it('meldet „offen", wenn nichts berührt wurde', () => {
    const m = measureOutcome(long, [candle(10, 99, 105, 104)], 5)!
    expect(m.outcome).toBe('offen')
    expect(m.exitPrice).toBe(104)
    expect(m.rMultiple).toBeCloseTo(0.4)
  })

  it('rechnet bei Short in die andere Richtung', () => {
    const short = { direction: 'short' as const, entryPrice: 100, stopLoss: 110, takeProfit: 80 }
    const m = measureOutcome(short, [candle(10, 79, 95)], 5)!
    expect(m.outcome).toBe('ziel')
    expect(m.rMultiple).toBeCloseTo(2) // (100-80)/10
  })

  it('gibt null zurück, wenn nichts messbar ist', () => {
    expect(measureOutcome(long, [], 5)).toBeNull()
    expect(measureOutcome(long, [candle(1, 90, 110)], 5)).toBeNull() // nur davor
    expect(
      measureOutcome({ ...long, stopLoss: 100 }, [candle(10, 90, 110)], 5),
    ).toBeNull() // kein Risiko
    expect(
      measureOutcome({ ...long, direction: 'keine' }, [candle(10, 90, 110)], 5),
    ).toBeNull()
  })
})

describe('nextStopAt', () => {
  it('hält alle N Kerzen ab dem Startpunkt', () => {
    expect(nextStopAt(100, 100, 200, 'auto', 10)).toBe(110)
    expect(nextStopAt(105, 100, 200, 'auto', 10)).toBe(110)
    expect(nextStopAt(110, 100, 200, 'auto', 10)).toBe(120)
  })

  it('kennt im manuellen Modus keinen Halt', () => {
    expect(nextStopAt(100, 100, 200, 'manuell', 10)).toBeNull()
  })

  it('läuft nicht über das Ende hinaus', () => {
    expect(nextStopAt(195, 100, 200, 'auto', 10)).toBe(200)
    expect(nextStopAt(200, 100, 200, 'auto', 10)).toBeNull()
  })
})

describe('clampStopEvery', () => {
  it('hält den Abstand im sinnvollen Bereich', () => {
    expect(clampStopEvery(10)).toBe(10)
    expect(clampStopEvery(1)).toBe(3)
    expect(clampStopEvery(9999)).toBe(100)
    expect(clampStopEvery('viel')).toBe(DEFAULT_STOP_EVERY)
    expect(clampStopEvery(null)).toBe(DEFAULT_STOP_EVERY)
  })
})

describe('suggestRating', () => {
  it('schlägt vor, entscheidet aber nichts', () => {
    expect(suggestRating('ziel')).toBe('korrekt')
    expect(suggestRating('stop')).toBe('falsch')
    expect(suggestRating('offen')).toBe('teilweise')
  })
})

describe('computeInterventionCost', () => {
  const trades = [
    { id: 1, outcome: 'ziel' as const, rMultiple: 2 },
    { id: 2, outcome: 'stop' as const, rMultiple: -1 },
    { id: 3, outcome: 'ziel' as const, rMultiple: 1.5 },
  ]

  it('zählt, was ein Ausstieg gekostet hätte', () => {
    const k = computeInterventionCost(trades, [
      { tradeId: 1, decision: 'raus' },
      { tradeId: 2, decision: 'raus' },
      { tradeId: 3, decision: 'haelt' },
    ])
    expect(k.ausstiege).toBe(2)
    expect(k.waerenAufgegangen).toBe(1)
    expect(k.entgangenR).toBeCloseTo(2)
    expect(k.richtigGewesen).toBe(1)
  })

  it('zählt denselben Trade nur einmal, auch bei mehrfachem Ausstiegswunsch', () => {
    const k = computeInterventionCost(trades, [
      { tradeId: 1, decision: 'raus' },
      { tradeId: 1, decision: 'raus' },
      { tradeId: 1, decision: 'raus' },
    ])
    expect(k.ausstiege).toBe(1)
    expect(k.entgangenR).toBeCloseTo(2)
  })

  it('ignoriert Haltepunkte ohne Trade und ohne Ergebnis', () => {
    const k = computeInterventionCost(
      [{ id: 9, outcome: null, rMultiple: null }],
      [
        { tradeId: null, decision: 'kein_setup' },
        { tradeId: 9, decision: 'raus' },
        { tradeId: 99, decision: 'raus' },
      ],
    )
    expect(k.ausstiege).toBe(0)
    expect(k.entgangenR).toBe(0)
  })

  it('bleibt bei null, wenn nie ausgestiegen werden wollte', () => {
    const k = computeInterventionCost(trades, [
      { tradeId: 1, decision: 'haelt' },
      { tradeId: 2, decision: 'gedreht' },
    ])
    expect(k).toEqual({
      ausstiege: 0,
      waerenAufgegangen: 0,
      entgangenR: 0,
      richtigGewesen: 0,
    })
  })
})

describe('summarizeSession', () => {
  it('zählt Ergebnisse und summiert R', () => {
    const s = summarizeSession([
      { outcome: 'ziel', rMultiple: 2 },
      { outcome: 'stop', rMultiple: -1 },
      { outcome: 'ziel', rMultiple: 1.5 },
      { outcome: 'offen', rMultiple: 0.2 },
    ])
    expect(s.entschieden).toBe(4)
    expect(s.ziel).toBe(2)
    expect(s.stop).toBe(1)
    expect(s.offen).toBe(1)
    expect(s.summeR).toBeCloseTo(2.7)
    expect(s.quote).toBeCloseTo(50)
  })

  it('hält Enthaltungen aus der Quote heraus', () => {
    const s = summarizeSession([
      { outcome: 'ziel', rMultiple: 1 },
      { outcome: null, rMultiple: null },
      { outcome: null, rMultiple: null },
    ])
    expect(s.keinSetup).toBe(2)
    expect(s.entschieden).toBe(1)
    // Nicht 33 % — sich bewusst herauszuhalten ist kein Fehlschlag.
    expect(s.quote).toBe(100)
  })

  it('zeigt ohne entschiedenen Trade keine Quote', () => {
    expect(summarizeSession([]).quote).toBeNull()
    expect(summarizeSession([{ outcome: null, rMultiple: null }]).quote).toBeNull()
  })
})

describe('fortschrittZeit', () => {
  it('nimmt die spaeteste gesehene Kerze', () => {
    expect(fortschrittZeit([100, 300, 200])).toBe(300)
  })

  it('ignoriert fehlende und unbrauchbare Werte', () => {
    expect(fortschrittZeit([null, 250, undefined, Number.NaN])).toBe(250)
  })

  it('ergibt null, wenn nichts gesehen wurde', () => {
    expect(fortschrittZeit([])).toBe(null)
    expect(fortschrittZeit([null, undefined])).toBe(null)
  })
})
