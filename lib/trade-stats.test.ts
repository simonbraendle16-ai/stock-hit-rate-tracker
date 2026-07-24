import { describe, expect, it } from 'vitest'
import { MIN_GROUP_SIZE } from './emotions'
import {
  computeDisciplineStats,
  computeEquityStats,
  computeMoodStats,
  netCashflow,
  pricePositionFraction,
  tradeFees,
  tradeGrossPnl,
  tradePnl,
  tradeRisk,
  unrealizedPnl,
  unrealizedR,
  tradeNetPnl,
  type CashflowRow,
  type TradeEventsByTrade,
  type TradeRow,
} from './trade-stats'
import type { TradeEventRow } from './trade-events'

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

describe('unrealizedPnl (offene Position)', () => {
  const open = makeTrade({ status: 'aktiv', result: null, actualExitPrice: null, positionSize: 10 })

  it('rechnet Long aus dem aktuellen Kurs', () => {
    expect(unrealizedPnl(open, 110)).toBe(100) // (110-100)*10
  })

  it('ist bei Long negativ, wenn der Kurs unter dem Einstieg steht', () => {
    expect(unrealizedPnl(open, 95)).toBe(-50)
  })

  it('dreht das Vorzeichen bei Short', () => {
    const short = makeTrade({ direction: 'short', entryPrice: 100, positionSize: 10, status: 'aktiv' })
    expect(unrealizedPnl(short, 90)).toBe(100) // Short im Gewinn, wenn Kurs fällt
    expect(unrealizedPnl(short, 110)).toBe(-100)
  })

  it('liefert null ohne Stückzahl oder bei ungültigem Kurs', () => {
    expect(unrealizedPnl(makeTrade({ positionSize: null }), 110)).toBeNull()
    expect(unrealizedPnl(open, NaN)).toBeNull()
  })
})

describe('unrealizedR', () => {
  const open = makeTrade({ entryPrice: 100, stopLoss: 90 }) // Risikodistanz 10

  it('ist die Kursbewegung geteilt durch die Risikodistanz', () => {
    expect(unrealizedR(open, 110)).toBe(1) // +10 / 10 = +1 R
    expect(unrealizedR(open, 85)).toBe(-1.5) // -15 / 10
  })

  it('ist größenunabhängig (Hebel/Stückzahl egal)', () => {
    expect(unrealizedR(makeTrade({ entryPrice: 100, stopLoss: 90, positionSize: 999 }), 110)).toBe(1)
  })

  it('rechnet Short korrekt', () => {
    const short = makeTrade({ direction: 'short', entryPrice: 100, stopLoss: 110 })
    expect(unrealizedR(short, 90)).toBe(1) // Kurs fällt um 10, Risiko 10 → +1 R
  })

  it('liefert null bei Risikodistanz 0', () => {
    expect(unrealizedR(makeTrade({ entryPrice: 100, stopLoss: 100 }), 110)).toBeNull()
  })
})

describe('pricePositionFraction (Balken Stop→Ziel)', () => {
  it('ist 0 am Stop und 1 am Ziel (Long)', () => {
    const t = makeTrade({ stopLoss: 90, takeProfit: 120 })
    expect(pricePositionFraction(t, 90)).toBe(0)
    expect(pricePositionFraction(t, 120)).toBe(1)
    expect(pricePositionFraction(t, 105)).toBeCloseTo(0.5)
  })

  it('funktioniert richtungsbewusst bei Short (Ziel unter dem Stop)', () => {
    const t = makeTrade({ direction: 'short', stopLoss: 110, takeProfit: 80 })
    expect(pricePositionFraction(t, 110)).toBeCloseTo(0) // am Stop (−0 ist ok)
    expect(pricePositionFraction(t, 80)).toBe(1) // am Ziel
  })

  it('liefert null ohne Ziel', () => {
    expect(pricePositionFraction(makeTrade({ takeProfit: null }), 100)).toBeNull()
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

// ---------------------------------------------------------------------------
// Emotions-Auswertung (Etappe 4)
// ---------------------------------------------------------------------------

let seq = 0
/** n gleichartige Trades — für Gruppen, die die Mindestgröße erreichen sollen. */
function makeMany(n: number, over: Partial<TradeRow> = {}): TradeRow[] {
  return Array.from({ length: n }, () => makeTrade({ id: ++seq, ...over }))
}

/** Standard-Gewinn = +182 € bei 100 € Risiko → +1,82 R. */
const gewinn = { result: 'gewinn', actualExitPrice: 120 } as const
/** Standard-Verlust = −118 € bei 100 € Risiko → −1,18 R. */
const verlust = { result: 'verlust', actualExitPrice: 90 } as const

const gruppe = (s: ReturnType<typeof computeMoodStats>, key: string) =>
  s.byEntryGroup.find((g) => g.key === key)!

describe('computeMoodStats', () => {
  it('liefert bei leerer Eingabe drei leere Gruppen und keine Tags', () => {
    const s = computeMoodStats([])
    expect(s.byEntryGroup).toHaveLength(3)
    expect(s.byEntryGroup.every((g) => g.trades === 0 && !g.enough)).toBe(true)
    expect(s.byEntryTag).toEqual([])
    expect(s.coverage).toEqual({
      decided: 0,
      withEntryMood: 0,
      withEntryTags: 0,
      withExitMood: 0,
    })
  })

  it('zählt Trades ohne Check-in nicht in eine Gruppe, aber in die Abdeckung', () => {
    // Der Altbestand darf nicht stillschweigend als „ruhig" durchgehen.
    const s = computeMoodStats(makeMany(5, gewinn))
    expect(s.coverage.decided).toBe(5)
    expect(s.coverage.withEntryMood).toBe(0)
    expect(s.byEntryGroup.reduce((a, g) => a + g.trades, 0)).toBe(0)
    expect(s.overall.trades).toBe(5)
  })

  it('gruppiert 1–2 / 3 / 4–5 wie die Roadmap es vorgibt', () => {
    const s = computeMoodStats([
      ...makeMany(2, { ...gewinn, moodEntry: 1 }),
      ...makeMany(1, { ...gewinn, moodEntry: 2 }),
      ...makeMany(3, { ...gewinn, moodEntry: 3 }),
      ...makeMany(4, { ...verlust, moodEntry: 5 }),
    ])
    expect(gruppe(s, 'ruhig').trades).toBe(3)
    expect(gruppe(s, 'angespannt').trades).toBe(3)
    expect(gruppe(s, 'aufgewuehlt').trades).toBe(4)
    expect(s.coverage.withEntryMood).toBe(10)
  })

  it('markiert Gruppen unter der Mindestgröße als „zu wenige Daten"', () => {
    const knapp = computeMoodStats(makeMany(MIN_GROUP_SIZE - 1, { ...gewinn, moodEntry: 1 }))
    expect(gruppe(knapp, 'ruhig').enough).toBe(false)

    const genug = computeMoodStats(makeMany(MIN_GROUP_SIZE, { ...gewinn, moodEntry: 1 }))
    expect(gruppe(genug, 'ruhig').enough).toBe(true)
  })

  it('rechnet Trefferquote und Erwartungswert je Gruppe getrennt', () => {
    const s = computeMoodStats([
      ...makeMany(10, { ...gewinn, moodEntry: 1 }),
      ...makeMany(10, { ...verlust, moodEntry: 5 }),
    ])
    expect(gruppe(s, 'ruhig').winRate).toBe(100)
    expect(gruppe(s, 'ruhig').expectancy).toBeCloseTo(1.82, 5)
    expect(gruppe(s, 'aufgewuehlt').winRate).toBe(0)
    expect(gruppe(s, 'aufgewuehlt').expectancy).toBeCloseTo(-1.18, 5)
    // Der Gesamtwert liegt dazwischen — er ist der Bezugspunkt, kein Ersatz.
    expect(s.overall.expectancy).toBeCloseTo(0.32, 5)
  })

  it('lässt Breakeven und nicht entschiedene Trades draußen', () => {
    const s = computeMoodStats([
      ...makeMany(2, { ...gewinn, moodEntry: 1 }),
      ...makeMany(3, { result: 'breakeven', actualExitPrice: 100, moodEntry: 1 }),
      ...makeMany(4, { result: null, status: 'aktiv', moodEntry: 1 }),
    ])
    expect(s.coverage.decided).toBe(2)
    expect(gruppe(s, 'ruhig').trades).toBe(2)
  })

  it('zählt einen Trade in jedem seiner Tags — Tags summieren sich nicht', () => {
    const s = computeMoodStats([
      ...makeMany(3, {
        ...verlust,
        moodEntry: 4,
        moodEntryTags: JSON.stringify(['fomo', 'ungeduld']),
      }),
      ...makeMany(2, { ...gewinn, moodEntry: 1, moodEntryTags: JSON.stringify(['gleichmut']) }),
    ])
    const tag = (k: string) => s.byEntryTag.find((t) => t.key === k)
    expect(tag('fomo')!.trades).toBe(3)
    expect(tag('ungeduld')!.trades).toBe(3)
    expect(tag('gleichmut')!.trades).toBe(2)
    expect(s.byEntryTag.reduce((a, t) => a + t.trades, 0)).toBe(8) // > 5 Trades
    expect(s.coverage.withEntryTags).toBe(5)
  })

  it('zeigt nur Tags, die überhaupt vergeben wurden', () => {
    const s = computeMoodStats(makeMany(2, { ...gewinn, moodEntry: 1, moodEntryTags: '["gier"]' }))
    expect(s.byEntryTag.map((t) => t.key)).toEqual(['gier'])
  })

  it('ignoriert defekte oder unbekannte Tag-Werte, statt zu werfen', () => {
    const s = computeMoodStats([
      ...makeMany(1, { ...gewinn, moodEntry: 1, moodEntryTags: '{kaputt' }),
      ...makeMany(1, { ...gewinn, moodEntry: 1, moodEntryTags: '["euphorie"]' }),
    ])
    expect(s.byEntryTag).toEqual([])
    expect(s.coverage.withEntryTags).toBe(0)
    expect(gruppe(s, 'ruhig').trades).toBe(2)
  })

  it('wertet den Ausstiegs-Zustand getrennt vom Einstieg aus', () => {
    const s = computeMoodStats(
      makeMany(10, { ...verlust, moodEntry: 1, moodExit: 5, followedPlan: false }),
    )
    expect(gruppe(s, 'ruhig').trades).toBe(10)
    expect(s.byExitGroup.find((g) => g.key === 'aufgewuehlt')!.trades).toBe(10)
    expect(s.coverage.withExitMood).toBe(10)
  })

  it('führt die Plan-Treue je Gruppe mit — der Douglas-Wert neben dem Geld', () => {
    const s = computeMoodStats([
      ...makeMany(5, { ...gewinn, moodEntry: 5, followedPlan: true }),
      ...makeMany(5, { ...verlust, moodEntry: 5, followedPlan: false }),
    ])
    expect(gruppe(s, 'aufgewuehlt').planFollowedRate).toBe(50)
  })

  it('trennt Nenner: Trefferquote über entschiedene, Erwartungswert über berechenbare', () => {
    // Ein Verlust ohne Ausstiegskurs zählt in die Quote, aber nicht ins R —
    // dieselbe Trennung wie in computeDisciplineStats.
    const s = computeMoodStats([
      ...makeMany(1, { ...gewinn, moodEntry: 1 }),
      ...makeMany(1, { result: 'verlust', actualExitPrice: null, moodEntry: 1 }),
    ])
    const g = gruppe(s, 'ruhig')
    expect(g.trades).toBe(2)
    expect(g.rated).toBe(1)
    expect(g.winRate).toBe(50)
    expect(g.expectancy).toBeCloseTo(1.82, 5)
  })
})

// ---------------------------------------------------------------------------
// Event-aware Integration (Etappe 6): Teilverkäufe fließen korrekt in die
// Aggregat-Kennzahlen; ohne Event-Map bleibt alles beim Alt-Verhalten.
// ---------------------------------------------------------------------------

let evSeq = 0
function evt(over: Partial<TradeEventRow>): TradeEventRow {
  evSeq++
  return {
    id: evSeq,
    tradeId: 1,
    userId: 'u1',
    type: 'notiz',
    at: new Date(`2026-01-02T10:${String(evSeq).padStart(2, '0')}:00Z`),
    quantity: null,
    price: null,
    fee: null,
    payload: null,
    note: null,
    createdAt: new Date(),
    ...over,
  } as TradeEventRow
}

describe('computeDisciplineStats — event-aware', () => {
  // Trade: 10 @100 eröffnet, 5 @110 teilverkauft, Rest 5 @120 geschlossen.
  // Brutto = (110-100)*5 + (120-100)*5 = 150; ohne Gebühren = totalNet 150.
  // plannedRisk = |100-90|*10 = 100 → R = 150/100 = 1,5.
  const events = [
    evt({ type: 'eroeffnet', quantity: 10, price: 100, fee: 0 }),
    evt({ type: 'teilverkauf', quantity: 5, price: 110, fee: 0 }),
    evt({ type: 'geschlossen', quantity: 5, price: 120, fee: 0 }),
  ]
  const trade = makeTrade({ id: 1, result: 'gewinn', actualExitPrice: 120, positionSize: 10 })
  const map: TradeEventsByTrade = new Map([[1, events]])

  it('rechnet P&L und Erwartungswert aus dem Settlement, nicht aus der Zeile', () => {
    const s = computeDisciplineStats([trade], 1000, [], map)
    expect(s.totalPnL).toBeCloseTo(150)
    expect(s.expectancy).toBeCloseTo(1.5)
    expect(s.currentBalance).toBeCloseTo(1150)
    expect(s.incomplete).toBe(0)
  })

  it('ohne Event-Map bleibt es beim Row-basierten Alt-Verhalten', () => {
    // Row: (120-100)*10 - (9+9) = 200 - 18 = 182.
    const s = computeDisciplineStats([trade], 1000)
    expect(s.totalPnL).toBeCloseTo(182)
  })

  it('tradeNetPnl liefert den realisierten Gesamt-Netto eines Event-Trades', () => {
    expect(tradeNetPnl(trade, events)).toBeCloseTo(150)
    expect(tradeNetPnl(trade, [])).toBeCloseTo(182) // Fallback = tradePnl
  })
})

describe('computeEquityStats — event-aware', () => {
  it('trägt den realisierten Gesamt-Netto zum Abschluss in die Kurve', () => {
    const events = [
      evt({ type: 'eroeffnet', quantity: 10, price: 100, fee: 0 }),
      evt({ type: 'teilverkauf', quantity: 5, price: 110, fee: 0 }),
      evt({ type: 'geschlossen', quantity: 5, price: 120, fee: 0 }),
    ]
    const trade = makeTrade({ id: 1, result: 'gewinn', actualExitPrice: 120, positionSize: 10 })
    const s = computeEquityStats([trade], 1000, [], new Map([[1, events]]))
    const last = s.points[s.points.length - 1]
    expect(last.balance).toBeCloseTo(1150)
  })
})
