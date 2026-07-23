import { describe, expect, it } from 'vitest'
import {
  computeDisciplineStats,
  computeEquityStats,
  netCashflow,
  tradeFees,
  tradeGrossPnl,
  tradePnl,
  tradeRisk,
  type CashflowRow,
  type TradeRow,
} from './trade-stats'

/** Minimaler abgeschlossener Trade; einzelne Felder je Test überschreiben. */
function makeTrade(over: Partial<TradeRow> = {}): TradeRow {
  return {
    id: 1,
    userId: 'u1',
    stockId: null,
    ticker: 'TEST',
    market: 'aktien',
    direction: 'long',
    entryPrice: 100,
    stopLoss: 90,
    takeProfit: 120,
    positionSize: 10,
    investedAmount: 1000,
    leverage: 1,
    feeEntry: 9,
    feeExit: 9,
    takeProfitPct: 100,
    strategy: null,
    broker: null,
    riskRewardRatio: 2,
    notes: null,
    status: 'abgeschlossen',
    elliottWaveCount: null,
    waveDegree: null,
    elliottInvalidation: null,
    preTradeAnswered: true,
    preTradeAnswers: null,
    tradedWithMoney: true,
    followedPlan: true,
    ruleViolations: null,
    lossAccepted: false,
    result: 'gewinn',
    actualExitPrice: 120,
    noTradeNote: null,
    openedAt: new Date('2026-01-01'),
    closedAt: new Date('2026-01-02'),
    createdAt: new Date('2026-01-01'),
    ...over,
  } as TradeRow
}

describe('tradeFees', () => {
  it('nutzt die eingefrorenen Werte vom Trade', () => {
    expect(tradeFees(makeTrade({ feeEntry: 4, feeExit: 6 }))).toBe(10)
  })

  it('ist bei Demo-Trades immer 0', () => {
    expect(tradeFees(makeTrade({ tradedWithMoney: false, feeEntry: 9, feeExit: 9 }))).toBe(0)
  })

  it('verändert sich NICHT, wenn die Standardgebühr später geändert wird', () => {
    // Der Kern von Befund 1: die Gebühr steht auf dem Trade, nicht in einer Konstante.
    const alt = makeTrade({ feeEntry: 9, feeExit: 9 })
    expect(tradeFees(alt)).toBe(18)
    const neu = makeTrade({ feeEntry: 1, feeExit: 1 })
    expect(tradeFees(neu)).toBe(2)
    expect(tradeFees(alt)).toBe(18) // der alte Trade bleibt unberührt
  })
})

describe('tradeGrossPnl', () => {
  it('rechnet Long aus dem tatsächlichen Ausstiegskurs', () => {
    expect(tradeGrossPnl(makeTrade({ actualExitPrice: 120 }))).toBe(200)
  })

  it('rechnet Short in die Gegenrichtung', () => {
    const t = makeTrade({ direction: 'short', entryPrice: 100, actualExitPrice: 80, result: 'gewinn' })
    expect(tradeGrossPnl(t)).toBe(200)
  })

  it('liefert 0 bei Breakeven', () => {
    expect(tradeGrossPnl(makeTrade({ result: 'breakeven', actualExitPrice: null }))).toBe(0)
  })

  it('erfindet KEINEN Betrag ohne Ausstiegskurs, sondern liefert null', () => {
    // Befund 2: früher kam hier `size * 10` heraus.
    expect(tradeGrossPnl(makeTrade({ actualExitPrice: null }))).toBeNull()
    expect(tradeGrossPnl(makeTrade({ result: 'verlust', actualExitPrice: null }))).toBeNull()
  })
})

describe('tradePnl', () => {
  it('zieht die Gebühren vom Rohgewinn ab', () => {
    expect(tradePnl(makeTrade({ actualExitPrice: 120 }))).toBe(182)
  })

  it('belastet Demo-Trades nicht mit Gebühren', () => {
    expect(tradePnl(makeTrade({ tradedWithMoney: false }))).toBe(200)
  })
})

describe('tradeRisk', () => {
  it('ist |Einstieg − Stop| × Stückzahl', () => {
    expect(tradeRisk(makeTrade({ entryPrice: 100, stopLoss: 90, positionSize: 10 }))).toBe(100)
  })

  it('wächst mit dem Hebel, weil der in der Stückzahl steckt', () => {
    expect(tradeRisk(makeTrade({ positionSize: 30 }))).toBe(300)
  })
})

describe('netCashflow', () => {
  it('verrechnet Ein- gegen Auszahlungen', () => {
    const flows: CashflowRow[] = [
      { amount: 5000, kind: 'einzahlung', occurredAt: '2026-01-01' },
      { amount: 1000, kind: 'auszahlung', occurredAt: '2026-02-01' },
    ]
    expect(netCashflow(flows)).toBe(4000)
  })

  it('ist ohne Bewegungen 0', () => {
    expect(netCashflow([])).toBe(0)
  })
})

describe('computeDisciplineStats', () => {
  it('liefert bei leerer Historie neutrale Werte statt NaN', () => {
    const s = computeDisciplineStats([], 10000)
    expect(s.completed).toBe(0)
    expect(s.disciplineScore).toBe(0)
    expect(s.winRate).toBe(0)
    expect(s.expectancy).toBe(0)
    expect(s.currentBalance).toBe(10000)
    expect(s.returnPct).toBe(0)
  })

  it('trennt Disziplin-Score von der Gewinnquote', () => {
    // Zwei Trades: einer verloren aber plankonform, einer gewonnen mit Abweichung.
    const rows = [
      makeTrade({ id: 1, result: 'verlust', actualExitPrice: 90, followedPlan: true }),
      makeTrade({ id: 2, result: 'gewinn', actualExitPrice: 120, followedPlan: false }),
    ]
    const s = computeDisciplineStats(rows, 10000)
    expect(s.disciplineScore).toBe(50)
    expect(s.winRate).toBe(50)
  })

  it('zählt Breakeven weder als Gewinn noch als Verlust', () => {
    const rows = [
      makeTrade({ id: 1, result: 'gewinn', actualExitPrice: 120 }),
      makeTrade({ id: 2, result: 'breakeven', actualExitPrice: null }),
    ]
    expect(computeDisciplineStats(rows, 10000).winRate).toBe(100)
  })

  it('hält Demo-Trades aus der Bilanz heraus', () => {
    const rows = [
      makeTrade({ id: 1, actualExitPrice: 120, tradedWithMoney: true }),
      makeTrade({ id: 2, actualExitPrice: 120, tradedWithMoney: false }),
    ]
    const s = computeDisciplineStats(rows, 10000)
    expect(s.totalPnL).toBe(182) // nur der Echtgeld-Trade
  })

  it('zählt die Plan-Streak vom jüngsten Trade rückwärts', () => {
    const rows = [
      makeTrade({ id: 1, followedPlan: false }),
      makeTrade({ id: 2, followedPlan: true }),
      makeTrade({ id: 3, followedPlan: true }),
    ]
    expect(computeDisciplineStats(rows, 10000).streak).toBe(2)
  })

  it('bezieht die Rendite auf das tatsächlich eingezahlte Kapital', () => {
    // Befund 4: ohne Cashflows würde hier gegen 10.000 statt 15.000 gerechnet.
    const rows = [makeTrade({ actualExitPrice: 120 })]
    const flows: CashflowRow[] = [{ amount: 5000, kind: 'einzahlung', occurredAt: '2026-01-01' }]
    const s = computeDisciplineStats(rows, 10000, flows)
    expect(s.currentBalance).toBe(15182)
    expect(s.returnPct).toBeCloseTo((182 / 15000) * 100, 6)
  })

  it('meldet unvollständige Trades, statt sie mitzurechnen', () => {
    const rows = [
      makeTrade({ id: 1, actualExitPrice: 120 }),
      makeTrade({ id: 2, result: 'verlust', actualExitPrice: null }),
    ]
    const s = computeDisciplineStats(rows, 10000)
    expect(s.incomplete).toBe(1)
    expect(s.totalPnL).toBe(182) // der unvollständige Trade zieht nichts ab
  })

  it('zählt Regelbrüche über alle Trades', () => {
    const rows = [
      makeTrade({ id: 1, ruleViolations: JSON.stringify(['stop_moved']) }),
      makeTrade({ id: 2, ruleViolations: JSON.stringify(['revenge', 'stop_moved']) }),
      makeTrade({ id: 3, ruleViolations: 'kaputtes json' }),
    ]
    expect(computeDisciplineStats(rows, 10000).ruleViolations).toBe(3)
  })
})

describe('computeEquityStats', () => {
  it('startet beim Startkapital und folgt den Trades', () => {
    const rows = [
      makeTrade({ id: 1, actualExitPrice: 120, closedAt: new Date('2026-01-02') }),
      makeTrade({ id: 2, result: 'verlust', actualExitPrice: 90, closedAt: new Date('2026-01-03') }),
    ]
    const s = computeEquityStats(rows, 10000)
    expect(s.points.map((p) => p.balance)).toEqual([10182, 10064])
  })

  it('misst den Drawdown vom Hoch', () => {
    const rows = [
      makeTrade({ id: 1, actualExitPrice: 120, closedAt: new Date('2026-01-02') }),
      makeTrade({ id: 2, result: 'verlust', actualExitPrice: 90, closedAt: new Date('2026-01-03') }),
    ]
    const s = computeEquityStats(rows, 10000)
    expect(s.maxDrawdown).toBe(118) // 10182 → 10064
  })

  it('wertet eine Auszahlung NICHT als Drawdown', () => {
    const rows = [makeTrade({ id: 1, actualExitPrice: 120, closedAt: new Date('2026-01-02') })]
    const flows: CashflowRow[] = [
      { amount: 5000, kind: 'auszahlung', occurredAt: '2026-01-03', note: 'Miete' },
    ]
    const s = computeEquityStats(rows, 10000, flows)
    expect(s.points.at(-1)!.balance).toBe(5182)
    expect(s.points.at(-1)!.kind).toBe('cashflow')
    expect(s.maxDrawdown).toBe(0)
  })

  it('sortiert Trades und Cashflows gemeinsam chronologisch', () => {
    const rows = [makeTrade({ id: 1, actualExitPrice: 120, closedAt: new Date('2026-03-01') })]
    const flows: CashflowRow[] = [{ amount: 1000, kind: 'einzahlung', occurredAt: '2026-01-01' }]
    const s = computeEquityStats(rows, 10000, flows)
    expect(s.points.map((p) => p.kind)).toEqual(['cashflow', 'trade'])
    expect(s.points.map((p) => p.balance)).toEqual([11000, 11182])
  })

  it('findet die längste und die aktuelle Verlustserie', () => {
    const rows = [
      makeTrade({ id: 1, result: 'verlust', actualExitPrice: 90 }),
      makeTrade({ id: 2, result: 'verlust', actualExitPrice: 90 }),
      makeTrade({ id: 3, result: 'gewinn', actualExitPrice: 120 }),
      makeTrade({ id: 4, result: 'verlust', actualExitPrice: 90 }),
    ]
    const s = computeEquityStats(rows, 10000)
    expect(s.worstLossStreak).toBe(2)
    expect(s.currentLossStreak).toBe(1)
  })

  it('lässt Demo-Trades aus der Kurve heraus', () => {
    const rows = [makeTrade({ id: 1, actualExitPrice: 120, tradedWithMoney: false })]
    expect(computeEquityStats(rows, 10000).points).toHaveLength(0)
  })
})
