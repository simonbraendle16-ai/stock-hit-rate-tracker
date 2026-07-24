import { describe, expect, it } from 'vitest'
import {
  deriveTimeline,
  hasPartialSale,
  isRiskReducingStop,
  settlePosition,
  type TradeEventRow,
  type TradeRow,
} from './trade-events'

/** Minimaler aktiver Trade; einzelne Felder je Test überschreiben. */
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
    status: 'aktiv',
    elliottWaveCount: null,
    waveDegree: null,
    elliottInvalidation: null,
    preTradeAnswered: true,
    preTradeAnswers: null,
    tradedWithMoney: true,
    followedPlan: null,
    ruleViolations: null,
    lossAccepted: false,
    moodEntry: 2,
    moodEntryTags: null,
    moodEntryNote: null,
    moodExit: null,
    moodExitTags: null,
    moodExitNote: null,
    result: null,
    actualExitPrice: null,
    noTradeNote: null,
    openedAt: new Date('2026-03-02T09:00:00Z'),
    closedAt: null,
    createdAt: new Date('2026-03-01'),
    ...over,
  } as TradeRow
}

let seq = 0
function ev(over: Partial<TradeEventRow> = {}): TradeEventRow {
  seq++
  return {
    id: seq,
    tradeId: 1,
    userId: 'u1',
    type: 'notiz',
    at: new Date(`2026-03-02T09:${String(seq).padStart(2, '0')}:00Z`),
    quantity: null,
    price: null,
    fee: null,
    payload: null,
    note: null,
    createdAt: new Date(),
    ...over,
  } as TradeEventRow
}

describe('settlePosition — Teilverkauf', () => {
  it('Long: halb verkauft → Restmenge, realisierter Brutto-P&L und R', () => {
    const t = makeTrade()
    const events = [
      ev({ type: 'eroeffnet', quantity: 10, price: 100 }),
      ev({ type: 'teilverkauf', quantity: 5, price: 110 }),
    ]
    const s = settlePosition(t, events)
    expect(s.openQty).toBe(5)
    expect(s.totalEntered).toBe(10)
    expect(s.totalExited).toBe(5)
    expect(s.realizedGross).toBe(50) // (110-100)*5
    expect(s.plannedRiskMoney).toBe(100) // |100-90|*10
    expect(s.realizedR).toBeCloseTo(0.5)
    expect(s.isFullyClosed).toBe(false)
  })

  it('Short: Gewinn bei fallendem Kurs (umgekehrtes Vorzeichen)', () => {
    const t = makeTrade({ direction: 'short', entryPrice: 100, stopLoss: 110 })
    const events = [
      ev({ type: 'eroeffnet', quantity: 10, price: 100 }),
      ev({ type: 'teilverkauf', quantity: 4, price: 90 }),
    ]
    const s = settlePosition(t, events)
    expect(s.realizedGross).toBe(40) // (100-90)*4
    expect(s.openQty).toBe(6)
    expect(s.plannedRiskMoney).toBe(100) // |100-110|*10
    expect(s.realizedR).toBeCloseTo(0.4)
  })
})

describe('settlePosition — Nachkauf', () => {
  it('gewichteter Durchschnittseinstieg', () => {
    const t = makeTrade()
    const events = [
      ev({ type: 'eroeffnet', quantity: 10, price: 100 }),
      ev({ type: 'nachkauf', quantity: 10, price: 120 }),
    ]
    const s = settlePosition(t, events)
    expect(s.avgEntry).toBe(110) // (10*100 + 10*120)/20
    expect(s.openQty).toBe(20)
    expect(s.totalEntered).toBe(20)
  })

  it('verschachtelt: Teilverkauf, dann Nachkauf, dann Abschluss', () => {
    const t = makeTrade()
    const events = [
      ev({ type: 'eroeffnet', quantity: 10, price: 100 }),
      ev({ type: 'teilverkauf', quantity: 5, price: 110 }), // +50, Rest 5 @100
      ev({ type: 'nachkauf', quantity: 5, price: 130 }), // avg = (5*100+5*130)/10 = 115, Menge 10
      ev({ type: 'geschlossen', quantity: 0, price: 140 }), // Rest 10 @115 → (140-115)*10 = 250
    ]
    const s = settlePosition(t, events)
    expect(s.avgEntry).toBe(115)
    expect(s.realizedGross).toBe(300) // 50 + 250
    expect(s.openQty).toBe(0)
    expect(s.isFullyClosed).toBe(true)
    expect(s.realizedR).toBeCloseTo(3) // 300 / 100
  })
})

describe('settlePosition — Abschluss & Randfälle', () => {
  it('geschlossen ohne Menge schließt den gesamten Rest', () => {
    const t = makeTrade()
    const events = [
      ev({ type: 'eroeffnet', quantity: 10, price: 100 }),
      ev({ type: 'teilverkauf', quantity: 3, price: 110 }),
      ev({ type: 'geschlossen', quantity: 0, price: 120 }),
    ]
    const s = settlePosition(t, events)
    expect(s.openQty).toBe(0)
    expect(s.totalExited).toBe(10)
    expect(s.realizedGross).toBe(30 + 140) // (110-100)*3 + (120-100)*7
  })

  it('ohne eroeffnet-Event (vor Etappe 6 aktiviert) erbt den Anfangszustand aus der Zeile', () => {
    const t = makeTrade({ positionSize: 8, entryPrice: 50, stopLoss: 45 })
    const s = settlePosition(t, [ev({ type: 'teilverkauf', quantity: 3, price: 55 })])
    expect(s.openQty).toBe(5)
    expect(s.avgEntry).toBe(50)
    expect(s.realizedGross).toBe(15) // (55-50)*3
    expect(s.plannedRiskMoney).toBe(40) // |50-45|*8
  })

  it('leere Event-Liste → hasEvents false, nichts realisiert', () => {
    const s = settlePosition(makeTrade(), [])
    expect(s.hasEvents).toBe(false)
    expect(s.openQty).toBe(10)
    expect(s.realizedGross).toBe(0)
  })
})

describe('settlePosition — Gebühren', () => {
  it('Echtgeld: Ein- und Ausstiegsgebühren fließen in netto', () => {
    const t = makeTrade()
    const events = [
      ev({ type: 'eroeffnet', quantity: 10, price: 100, fee: 9 }),
      ev({ type: 'teilverkauf', quantity: 5, price: 110, fee: 4 }),
    ]
    const s = settlePosition(t, events)
    expect(s.entryFees).toBe(9)
    expect(s.realizedExitFees).toBe(4)
    expect(s.realizedNet).toBe(46) // 50 - 4 (ohne Einstiegsgebühr)
    expect(s.totalNet).toBe(37) // 50 - 4 - 9
  })

  it('Demo (tradedWithMoney=false): keine Gebühren', () => {
    const t = makeTrade({ tradedWithMoney: false })
    const events = [
      ev({ type: 'eroeffnet', quantity: 10, price: 100, fee: 9 }),
      ev({ type: 'teilverkauf', quantity: 5, price: 110, fee: 4 }),
    ]
    const s = settlePosition(t, events)
    expect(s.entryFees).toBe(0)
    expect(s.realizedExitFees).toBe(0)
    expect(s.realizedNet).toBe(50)
    expect(s.totalNet).toBe(50)
  })
})

describe('isRiskReducingStop', () => {
  it('Long: höher = risiko-reduzierend, tiefer = nicht, gleich = nein', () => {
    expect(isRiskReducingStop('long', 90, 95)).toBe(true)
    expect(isRiskReducingStop('long', 90, 105)).toBe(true) // in den Profit
    expect(isRiskReducingStop('long', 90, 85)).toBe(false) // Aufweiten
    expect(isRiskReducingStop('long', 90, 90)).toBe(false)
  })

  it('Short: tiefer = risiko-reduzierend, höher = nicht', () => {
    expect(isRiskReducingStop('short', 110, 105)).toBe(true)
    expect(isRiskReducingStop('short', 110, 115)).toBe(false)
    expect(isRiskReducingStop('short', 110, 110)).toBe(false)
  })
})

describe('hasPartialSale', () => {
  it('erkennt einen Teilverkauf im Event-Log', () => {
    expect(hasPartialSale([ev({ type: 'eroeffnet' })])).toBe(false)
    expect(hasPartialSale([ev({ type: 'eroeffnet' }), ev({ type: 'teilverkauf' })])).toBe(true)
  })
})

describe('deriveTimeline — mit echten Events', () => {
  it('bildet Events chronologisch ab und markiert Regelbrüche aus dem Payload', () => {
    const t = makeTrade()
    const items = deriveTimeline(t, [
      ev({ type: 'eroeffnet', quantity: 10, price: 100 }),
      ev({ type: 'stop_verschoben', payload: JSON.stringify({ from: 90, to: 100, violation: false }) }),
      ev({ type: 'stop_verschoben', payload: JSON.stringify({ from: 100, to: 80, violation: true }) }),
    ])
    expect(items).toHaveLength(3)
    expect(items[0].type).toBe('eroeffnet')
    expect(items[1].isViolation).toBe(false)
    expect(items[1].from).toBe(90)
    expect(items[1].to).toBe(100)
    expect(items[2].isViolation).toBe(true) // Aufweiten
    expect(items.every((i) => i.derived === false)).toBe(true)
  })
})

describe('deriveTimeline — Alt-Trade ohne Events', () => {
  it('leitet Eröffnung, Regelbrüche (ohne Zeitstempel) und Abschluss ab', () => {
    const t = makeTrade({
      status: 'abgeschlossen',
      result: 'verlust',
      actualExitPrice: 88,
      ruleViolations: JSON.stringify(['stop_moved']),
      closedAt: new Date('2026-03-07T15:40:00Z'),
    })
    const items = deriveTimeline(t, [])
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({ type: 'eroeffnet', derived: true })
    expect(items[0].at).not.toBeNull()
    expect(items[1]).toMatchObject({ type: 'stop_verschoben', isViolation: true, derived: true })
    expect(items[1].at).toBeNull() // Zeitpunkt unbekannt — nichts erfunden
    expect(items[2]).toMatchObject({ type: 'geschlossen', derived: true })
    expect(items[2].note).toContain('verlust')
  })
})
