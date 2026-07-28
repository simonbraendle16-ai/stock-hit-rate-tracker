// Etappe 11 hat den Hebel auf Papier zugelassen und dafür `investedAmount` und
// die daraus abgeleitete `positionSize` AUCH für Demo-Trades gespeichert. Das
// ist ein Eingriff in die Grundannahme der App („Demo ist kein Geld"), und er
// hält nur, solange drei Zusagen gelten. Genau die stehen hier — gegen den
// echten Code, damit ein späterer Umbau sie nicht unbemerkt bricht:
//
//   1. Das R-Vielfache ist von Stückzahl und Hebel unabhängig. Sonst hätte der
//      Papier-Hebel Disziplin-Score, Erwartungswert und Monte-Carlo verschoben.
//   2. Auf Papier fallen keine Gebühren an — auch bei Altbestand ohne Wert.
//   3. Die Geldkennzahlen (Equity, Drawdown, Bilanz) sehen Papier-Trades nicht,
//      egal wie groß deren Papierposition ist.

import { describe, expect, it } from 'vitest'
import {
  baseBucket,
  computeEquityStats,
  tradeFees,
  tradeNetPnl,
  tradeRMultiple,
  type TradeRow,
} from './trade-stats'

/** Ein abgeschlossener Gewinn-Trade: Einstieg 400, Stop 380, Ausstieg 450 → 2,5 R. */
function trade(over: Partial<TradeRow> = {}): TradeRow {
  return {
    id: 1,
    userId: 'u',
    stockId: null,
    ticker: 'TSLA',
    market: 'aktien',
    tradeKind: 'schnell',
    direction: 'long',
    entryPrice: 400,
    stopLoss: 380,
    takeProfit: 450,
    positionSize: null,
    investedAmount: null,
    leverage: 1,
    feeEntry: 0,
    feeExit: 0,
    takeProfitPct: 100,
    strategy: null,
    setupTags: null,
    broker: null,
    riskRewardRatio: null,
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
    actualExitPrice: 450,
    noTradeNote: null,
    openedAt: new Date('2026-07-01T10:00:00Z'),
    closedAt: new Date('2026-07-02T10:00:00Z'),
    createdAt: new Date('2026-07-01T09:00:00Z'),
    ...over,
  } as TradeRow
}

describe('Hebel auf Papier', () => {
  it('lässt das R-Vielfache unberührt — Gewinn und Risiko skalieren gleich', () => {
    const ohne = tradeRMultiple(trade())
    expect(ohne).toBeCloseTo(2.5, 6)
    expect(tradeRMultiple(trade({ positionSize: 25, investedAmount: 2000, leverage: 5 }))).toBeCloseTo(
      ohne,
      6,
    )
    expect(
      tradeRMultiple(trade({ positionSize: 250, investedAmount: 20000, leverage: 5 })),
    ).toBeCloseTo(ohne, 6)
  })

  it('kostet keine Gebühren, auch wenn der Trade gar keine gespeichert hat', () => {
    expect(tradeFees(trade({ tradedWithMoney: false, feeEntry: null, feeExit: null }))).toBe(0)
    expect(tradeFees(trade({ tradedWithMoney: true, feeEntry: 1, feeExit: 1 }))).toBe(2)
  })

  it('bleibt aus Equity und Drawdown heraus, egal wie groß die Papierposition ist', () => {
    const echt = trade({ id: 1, positionSize: 10, investedAmount: 4000 })
    const demoRiesig = trade({
      id: 2,
      tradedWithMoney: false,
      positionSize: 250,
      investedAmount: 20000,
      leverage: 5,
      result: 'verlust',
      actualExitPrice: 380,
    })

    const nurEcht = computeEquityStats([echt], 10000)
    const mitDemo = computeEquityStats([echt, demoRiesig], 10000)

    // Gleich viele Punkte: Der Papier-Trade erzeugt keinen eigenen.
    expect(mitDemo.points).toHaveLength(nurEcht.points.length)
    expect(mitDemo.points.at(-1)!.balance).toBe(nurEcht.points.at(-1)!.balance)
    // Der Papier-Verlust wäre −5.000 gewesen; der Endstand kennt nur den echten Trade.
    expect(mitDemo.points.at(-1)!.balance).toBe(10500)
    expect(mitDemo.maxDrawdown).toBe(nurEcht.maxDrawdown)
  })

  it('zählt aber in die Verlust-Serie — die misst Verhalten, nicht Geld', () => {
    // Bewusst so: Eine Verlustserie ist ein Zustand des Handelnden. Wer auf
    // Papier dreimal hintereinander falsch liegt, hat dreimal falsch gelegen.
    // Deshalb steht am Drawdown „nur Echtgeld", an der Serie nicht.
    const echt = trade({ id: 1, positionSize: 10, investedAmount: 4000 })
    const demoVerlust = trade({
      id: 2,
      tradedWithMoney: false,
      result: 'verlust',
      actualExitPrice: 380,
      positionSize: 25,
      investedAmount: 2000,
      leverage: 5,
      closedAt: new Date('2026-07-03T10:00:00Z'),
    })
    expect(computeEquityStats([echt], 10000).worstLossStreak).toBe(0)
    expect(computeEquityStats([echt, demoVerlust], 10000).worstLossStreak).toBe(1)
  })

  it('zählt trotzdem in Trefferquote und Plan-Treue mit — dort geht es nicht um Geld', () => {
    const echt = trade({ id: 1, positionSize: 10, investedAmount: 4000 })
    const demo = trade({
      id: 2,
      tradedWithMoney: false,
      result: 'verlust',
      actualExitPrice: 380,
      positionSize: 25,
      investedAmount: 2000,
      leverage: 5,
    })
    const b = baseBucket([echt, demo], 1)
    expect(b.trades).toBe(2)
    expect(b.winRate).toBe(50)
  })

  it('rechnet den Papiergewinn in Papiergeld — genau dafür ist der Einsatz da', () => {
    // 25 Stück × 50 Kursgewinn, ohne Gebühren.
    expect(
      tradeNetPnl(
        trade({ tradedWithMoney: false, positionSize: 25, investedAmount: 2000, leverage: 5 }),
      ),
    ).toBe(1250)
  })
})
