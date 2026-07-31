import { describe, expect, it } from 'vitest'
import { computeRiskReward } from './trade-math'
import {
  MAX_TARGETS,
  blendedRiskReward,
  effectiveTargets,
  isProfitSide,
  normalizeTargets,
  plannedQty,
  remainderPct,
  targetProgress,
  type TradeRow,
  type TradeTargetRow,
} from './trade-targets'

/** Minimaler Trade; einzelne Felder je Test überschreiben. */
function makeTrade(over: Partial<TradeRow> = {}): TradeRow {
  return {
    id: 1,
    userId: 'u1',
    portfolioId: 1,
    stockId: null,
    ticker: 'TEST',
    market: 'aktien',
    direction: 'long',
    entryPrice: 100,
    stopLoss: 90,
    takeProfit: 120,
    positionSize: 10,
    takeProfitPct: 100,
    status: 'aktiv',
    tradedWithMoney: true,
    ...over,
  } as TradeRow
}

let seq = 0
function row(over: Partial<TradeTargetRow> = {}): TradeTargetRow {
  seq += 1
  return {
    id: seq,
    tradeId: 1,
    userId: 'u1',
    sortOrder: 0,
    price: 110,
    sharePct: 50,
    executedAt: null,
    executedPrice: null,
    executedQty: null,
    eventId: null,
    note: null,
    createdAt: new Date('2026-07-01'),
    ...over,
  } as TradeTargetRow
}

const plan = (targets: { price: number; sharePct: number }[], over: Partial<{ entry: number; stopLoss: number; direction: string }> = {}) =>
  normalizeTargets({ entry: 100, stopLoss: 90, direction: 'long', targets, ...over })

describe('isProfitSide', () => {
  it('erkennt die Gewinnseite je Richtung', () => {
    expect(isProfitSide('long', 100, 110)).toBe(true)
    expect(isProfitSide('long', 100, 90)).toBe(false)
    expect(isProfitSide('short', 100, 90)).toBe(true)
    expect(isProfitSide('short', 100, 110)).toBe(false)
  })

  it('zählt den Einstieg selbst nicht als Ziel', () => {
    expect(isProfitSide('long', 100, 100)).toBe(false)
    expect(isProfitSide('short', 100, 100)).toBe(false)
  })
})

describe('normalizeTargets', () => {
  it('lässt eine leere Planung zu (ein Trade braucht kein Ziel)', () => {
    expect(plan([])).toEqual([])
  })

  it('sortiert nach Abstand zum Einstieg, nicht nach Eingabereihenfolge', () => {
    const t = plan([
      { price: 130, sharePct: 25 },
      { price: 110, sharePct: 50 },
      { price: 120, sharePct: 25 },
    ])
    expect(t.map((x) => x.price)).toEqual([110, 120, 130])
  })

  it('sortiert bei Short absteigend — dort ist tiefer näher am Ziel', () => {
    const t = plan(
      [
        { price: 70, sharePct: 30 },
        { price: 90, sharePct: 70 },
      ],
      { entry: 100, stopLoss: 110, direction: 'short' },
    )
    expect(t.map((x) => x.price)).toEqual([90, 70])
  })

  it('weist ein Ziel auf der falschen Seite des Einstiegs ab', () => {
    expect(() => plan([{ price: 95, sharePct: 50 }])).toThrow(/über dem Einstieg/)
    expect(() =>
      plan([{ price: 105, sharePct: 50 }], { entry: 100, stopLoss: 110, direction: 'short' }),
    ).toThrow(/unter dem Einstieg/)
  })

  it('weist ein Ziel genau auf dem Einstieg ab', () => {
    expect(() => plan([{ price: 100, sharePct: 50 }])).toThrow(/über dem Einstieg/)
  })

  it('weist Anteile von 0 oder darunter ab', () => {
    expect(() => plan([{ price: 110, sharePct: 0 }])).toThrow(/größer als 0 %/)
    expect(() => plan([{ price: 110, sharePct: -5 }])).toThrow(/größer als 0 %/)
  })

  it('weist mehr als 100 % Gesamtanteil ab', () => {
    expect(() =>
      plan([
        { price: 110, sharePct: 60 },
        { price: 120, sharePct: 60 },
      ]),
    ).toThrow(/mehr als die Position groß ist/)
  })

  it('lässt weniger als 100 % zu — der Rest darf bewusst laufen', () => {
    const t = plan([
      { price: 110, sharePct: 50 },
      { price: 130, sharePct: 20 },
    ])
    expect(remainderPct(t)).toBeCloseTo(30)
  })

  it('weist zwei Stufen auf demselben Kurs ab', () => {
    expect(() =>
      plan([
        { price: 110, sharePct: 40 },
        { price: 110, sharePct: 40 },
      ]),
    ).toThrow(/demselben Kurs/)
  })

  it('begrenzt die Anzahl der Stufen', () => {
    const zuViele = Array.from({ length: MAX_TARGETS + 1 }, (_, i) => ({
      price: 110 + i,
      sharePct: 10,
    }))
    expect(() => plan(zuViele)).toThrow(new RegExp(`Höchstens ${MAX_TARGETS}`))
  })

  it('verlangt einen brauchbaren Einstieg und Stop', () => {
    expect(() => plan([{ price: 110, sharePct: 50 }], { entry: 0 })).toThrow(/Einstiegskurs/)
    expect(() => plan([{ price: 110, sharePct: 50 }], { stopLoss: 0 })).toThrow(/Stop-Loss/)
  })

  it('trimmt Notizen und macht Leerstrings zu null', () => {
    const t = normalizeTargets({
      entry: 100,
      stopLoss: 90,
      direction: 'long',
      targets: [{ price: 110, sharePct: 50, note: '  erste Hälfte  ' }, { price: 120, sharePct: 50, note: '   ' }],
    })
    expect(t[0].note).toBe('erste Hälfte')
    expect(t[1].note).toBeNull()
  })
})

describe('blendedRiskReward', () => {
  it('ergibt bei genau einer vollen Stufe exakt das bisherige R:R', () => {
    const einzeln = computeRiskReward(100, 90, 120)
    const gestaffelt = blendedRiskReward({
      entry: 100,
      stopLoss: 90,
      targets: [{ price: 120, sharePct: 100 }],
    })
    expect(gestaffelt).toBeCloseTo(einzeln!, 10)
    expect(gestaffelt).toBeCloseTo(2, 10)
  })

  it('gewichtet mehrere Stufen nach ihrem Anteil', () => {
    // 50 % bei 1 R + 50 % bei 3 R = 2 R
    const rr = blendedRiskReward({
      entry: 100,
      stopLoss: 90,
      targets: [
        { price: 110, sharePct: 50 },
        { price: 130, sharePct: 50 },
      ],
    })
    expect(rr).toBeCloseTo(2, 10)
  })

  it('schlägt einen freien Rest der letzten Stufe zu — er läuft ja bis dorthin', () => {
    // 50 % bei 1 R, Rest 50 % läuft bis 3 R → wie 50/50
    const rr = blendedRiskReward({
      entry: 100,
      stopLoss: 90,
      targets: [
        { price: 110, sharePct: 50 },
        { price: 130, sharePct: 20 },
      ],
    })
    expect(rr).toBeCloseTo(0.5 * 1 + 0.5 * 3, 10)
  })

  it('rechnet richtungsunabhängig', () => {
    const rr = blendedRiskReward({
      entry: 100,
      stopLoss: 110,
      targets: [
        { price: 90, sharePct: 50 },
        { price: 70, sharePct: 50 },
      ],
    })
    expect(rr).toBeCloseTo(0.5 * 1 + 0.5 * 3, 10)
  })

  it('gibt ohne Stufen oder ohne Risikoabstand nichts zurück', () => {
    expect(blendedRiskReward({ entry: 100, stopLoss: 90, targets: [] })).toBeNull()
    expect(
      blendedRiskReward({ entry: 100, stopLoss: 100, targets: [{ price: 110, sharePct: 100 }] }),
    ).toBeNull()
  })
})

describe('effectiveTargets', () => {
  it('liest einen Trade ohne Stufen als eine implizite Stufe aus takeProfit', () => {
    const t = effectiveTargets(makeTrade({ takeProfit: 120, takeProfitPct: 60 }), [])
    expect(t).toHaveLength(1)
    expect(t[0].id).toBeNull()
    expect(t[0].price).toBe(120)
    expect(t[0].sharePct).toBe(60)
  })

  it('nimmt 100 % an, wenn der Alt-Trade keinen Anteil trägt', () => {
    const t = effectiveTargets(makeTrade({ takeProfitPct: null }), [])
    expect(t[0].sharePct).toBe(100)
  })

  it('gibt für einen Trade ohne Ziel gar nichts zurück', () => {
    expect(effectiveTargets(makeTrade({ takeProfit: null }), [])).toEqual([])
  })

  it('bevorzugt echte Stufen und ordnet sie nach sortOrder', () => {
    const t = effectiveTargets(makeTrade(), [
      row({ sortOrder: 1, price: 130, sharePct: 40 }),
      row({ sortOrder: 0, price: 110, sharePct: 60 }),
    ])
    expect(t.map((x) => x.price)).toEqual([110, 130])
    expect(t.map((x) => x.sortOrder)).toEqual([0, 1])
    expect(t[0].id).not.toBeNull()
  })

  it('übernimmt den Ausführungsstand', () => {
    const t = effectiveTargets(makeTrade(), [
      row({ executedAt: new Date('2026-07-05'), executedPrice: 111, executedQty: 5 }),
    ])
    expect(t[0].executedAt).toEqual(new Date('2026-07-05'))
    expect(t[0].executedPrice).toBe(111)
    expect(t[0].executedQty).toBe(5)
  })
})

describe('plannedQty', () => {
  it('nimmt den Anteil der Anfangsposition', () => {
    expect(plannedQty(10, 50)).toBeCloseTo(5)
    expect(plannedQty(7.5, 20)).toBeCloseTo(1.5)
  })

  it('bleibt bei fehlender Basis bei 0, statt zu raten', () => {
    expect(plannedQty(0, 50)).toBe(0)
    expect(plannedQty(Number.NaN, 50)).toBe(0)
  })
})

describe('targetProgress', () => {
  it('zählt ausgeführte und offene Stufen und nennt die nächste', () => {
    const targets = effectiveTargets(makeTrade(), [
      row({ sortOrder: 0, price: 110, sharePct: 50, executedAt: new Date('2026-07-05'), executedQty: 5 }),
      row({ sortOrder: 1, price: 130, sharePct: 30 }),
    ])
    const p = targetProgress(targets)
    expect(p.total).toBe(2)
    expect(p.executed).toBe(1)
    expect(p.executedPct).toBeCloseTo(50)
    expect(p.openPct).toBeCloseTo(30)
    expect(p.remainderPct).toBeCloseTo(20)
    expect(p.next?.price).toBe(130)
    expect(p.allExecuted).toBe(false)
  })

  it('meldet erst dann „alles abgerechnet", wenn keine Stufe mehr offen ist', () => {
    const targets = effectiveTargets(makeTrade(), [
      row({ sortOrder: 0, price: 110, sharePct: 100, executedAt: new Date('2026-07-05') }),
    ])
    expect(targetProgress(targets).allExecuted).toBe(true)
    expect(targetProgress([]).allExecuted).toBe(false)
  })
})
