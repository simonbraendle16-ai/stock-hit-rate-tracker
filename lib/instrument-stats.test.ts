import { describe, expect, it } from 'vitest'
import {
  computeInstrumentStats,
  overallGap,
  MIN_INSTRUMENT_TRADES,
  type AssessmentLike,
  type InstrumentLike,
} from './instrument-stats'
import type { TradeRow } from './trade-stats'

const instruments: InstrumentLike[] = [
  { id: 1, ticker: 'RHM', name: 'Rheinmetall', market: 'aktien' },
  { id: 2, ticker: 'AAPL', name: 'Apple', market: 'aktien' },
  { id: 3, ticker: 'STILL', name: 'Nur beobachtet', market: 'aktien' },
]

function prognose(stockId: number, isCorrect: boolean, zoneNotReached = false): AssessmentLike {
  return { stockId, isCorrect, zoneNotReached }
}

/** Minimaler abgeschlossener Trade; einzelne Felder je Test überschreiben. */
function makeTrade(over: Partial<TradeRow> = {}): TradeRow {
  return {
    id: 1,
    userId: 'u1',
    stockId: 1,
    ticker: 'RHM',
    market: 'aktien',
    direction: 'long',
    entryPrice: 100,
    stopLoss: 90,
    takeProfit: 120,
    positionSize: 10,
    investedAmount: 1000,
    leverage: 1,
    feeEntry: 0,
    feeExit: 0,
    takeProfitPct: 100,
    strategy: null,
    setupTags: null,
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
    moodEntry: null,
    moodEntryTags: null,
    moodEntryNote: null,
    moodExit: null,
    moodExitTags: null,
    moodExitNote: null,
    result: 'gewinn',
    actualExitPrice: 120,
    noTradeNote: null,
    openedAt: new Date('2026-01-01'),
    closedAt: new Date('2026-01-02'),
    createdAt: new Date('2026-01-01'),
    ...over,
  } as TradeRow
}

describe('computeInstrumentStats', () => {
  it('lässt Instrumente ohne Prognose und ohne Trade weg', () => {
    const rows = computeInstrumentStats(instruments, [prognose(1, true)], [])
    expect(rows.map((r) => r.ticker)).toEqual(['RHM'])
  })

  it('zählt neutrale Prognosen nicht in die Quote', () => {
    const rows = computeInstrumentStats(
      instruments,
      [prognose(1, true), prognose(1, false), prognose(1, false, true)],
      [],
    )
    const rhm = rows[0].assessments
    expect(rhm.total).toBe(3)
    expect(rhm.notReached).toBe(1)
    expect(rhm.decided).toBe(2)
    expect(rhm.hitRate).toBe(50)
  })

  it('trennt Echtgeld von Demo', () => {
    const rows = computeInstrumentStats(
      instruments,
      [],
      [
        makeTrade({ id: 1, tradedWithMoney: true, result: 'gewinn' }),
        makeTrade({ id: 2, tradedWithMoney: true, result: 'verlust', actualExitPrice: 90 }),
        makeTrade({ id: 3, tradedWithMoney: false, result: 'gewinn' }),
      ],
    )
    const t = rows[0].trades
    expect(t.total).toBe(3)
    expect(t.decided).toBe(3)
    expect(t.money.trades).toBe(2)
    expect(t.demo.trades).toBe(1)
    // Der Geldbetrag stammt ausschließlich aus den Echtgeld-Trades.
    expect(t.money.netPnl).toBe(200 - 100)
    expect(t.demo.netPnl).toBe(200)
  })

  it('zählt geplante Trades mit, aber nicht in die Quote', () => {
    const rows = computeInstrumentStats(
      instruments,
      [],
      [
        makeTrade({ id: 1, result: 'gewinn' }),
        makeTrade({ id: 2, status: 'geplant', result: null }),
      ],
    )
    expect(rows[0].trades.total).toBe(2)
    expect(rows[0].trades.decided).toBe(1)
    expect(rows[0].trades.core.winRate).toBe(100)
  })

  it('markiert dünne Datenlage über `enough`', () => {
    const wenige = computeInstrumentStats(instruments, [], [makeTrade({ id: 1 })])
    expect(wenige[0].trades.enough).toBe(false)

    const genug = computeInstrumentStats(
      instruments,
      [],
      Array.from({ length: MIN_INSTRUMENT_TRADES }, (_, i) => makeTrade({ id: i + 1 })),
    )
    expect(genug[0].trades.enough).toBe(true)
  })

  it('rechnet die Lücke zwischen Prognose und Umsetzung', () => {
    const rows = computeInstrumentStats(
      instruments,
      [prognose(1, true), prognose(1, true), prognose(1, true), prognose(1, false)],
      [
        makeTrade({ id: 1, result: 'gewinn' }),
        makeTrade({ id: 2, result: 'verlust', actualExitPrice: 90 }),
      ],
    )
    // Prognose 75 %, Umsetzung 50 % → 25 Prozentpunkte Lücke.
    expect(rows[0].assessments.hitRate).toBe(75)
    expect(rows[0].trades.core.winRate).toBe(50)
    expect(rows[0].gap).toBe(25)
  })

  it('lässt die Lücke offen, wenn eine Seite leer ist', () => {
    const nurPrognosen = computeInstrumentStats(instruments, [prognose(1, true)], [])
    expect(nurPrognosen[0].gap).toBeNull()

    const nurTrades = computeInstrumentStats(instruments, [], [makeTrade({ id: 1 })])
    expect(nurTrades[0].gap).toBeNull()
  })

  it('ignoriert Trades ohne Instrument', () => {
    const rows = computeInstrumentStats(
      instruments,
      [prognose(1, true)],
      [makeTrade({ id: 1, stockId: null })],
    )
    expect(rows[0].trades.total).toBe(0)
  })

  it('sortiert nach Aktivität, bei Gleichstand nach Prognosequote', () => {
    const rows = computeInstrumentStats(
      instruments,
      [prognose(1, true), prognose(2, true), prognose(2, true), prognose(2, false)],
      [],
    )
    expect(rows.map((r) => r.ticker)).toEqual(['AAPL', 'RHM'])
  })
})

describe('overallGap', () => {
  it('fasst beide Seiten über alle Instrumente zusammen', () => {
    const rows = computeInstrumentStats(
      instruments,
      [prognose(1, true), prognose(1, false), prognose(2, true), prognose(2, true)],
      [
        makeTrade({ id: 1, stockId: 1, result: 'gewinn' }),
        makeTrade({ id: 2, stockId: 1, result: 'verlust', actualExitPrice: 90 }),
        makeTrade({ id: 3, stockId: 2, ticker: 'AAPL', result: 'verlust', actualExitPrice: 90 }),
      ],
    )
    const g = overallGap(rows)
    expect(g).not.toBeNull()
    // Prognosen: 3 von 4 richtig = 75 %. Trades: 1 von 3 = 33,3 %.
    expect(g!.assessmentsDecided).toBe(4)
    expect(g!.tradesDecided).toBe(3)
    expect(g!.assessmentHitRate).toBeCloseTo(75, 5)
    expect(g!.tradeHitRate).toBeCloseTo(33.333, 2)
    expect(g!.gap).toBeCloseTo(41.667, 2)
  })

  it('bleibt leer, solange eine Seite fehlt', () => {
    const rows = computeInstrumentStats(instruments, [prognose(1, true)], [])
    expect(overallGap(rows)).toBeNull()
  })
})
