import { describe, it, expect } from 'vitest'
import { resolveMoneyCurrency, frozenFxRate, currencyAssignment } from './money-currency'
import { computeDisciplineStats, computeEquityStats, tradeNetPnl, tradeRisk, unrealizedPnl, type TradeRow } from './trade-stats'
import { settlePosition, type TradeEventRow } from './trade-events'
import { projectStopLoss, projectTakeProfit } from './trade-math'
import { normalizeAssistantTradeInput } from './assistant-trade-input'
import { PRE_TRADE_QUESTIONS } from './pre-trade-questions'

const now = new Date('2026-10-04T12:00:00Z')
const known = { id: 1, entryPrice: 100, stopLoss: 90, takeProfit: 120, positionSize: 10, direction: 'long', result: 'gewinn', actualExitPrice: 120, tradedWithMoney: true, feeEntry: 2, feeExit: 3, quoteCurrency: 'USD', accountCurrency: 'USD', quoteToAccountRate: 1, fxRateAt: null, createdAt: now, closedAt: now } as TradeRow
const event = { id: 1, type: 'teilverkauf', price: 120, quantity: 5, fee: 3, at: now } as TradeEventRow
describe('independent currency regressions', () => {
  it('keeps legacy row and event money unknown without inventing one unit or a rate', () => {
    const legacy = { ...known, quoteCurrency: null, accountCurrency: null, quoteToAccountRate: null }
    expect(tradeNetPnl(legacy)).toBeNull()
    expect(tradeNetPnl(legacy, [event])).toBeNull()
    expect(tradeRisk(legacy)).toBeNaN()
    expect(unrealizedPnl(legacy, 120)).toBeNull()
    const stats = computeDisciplineStats([known, legacy], 10000, [], new Map([[1, [event]]]))
    expect(stats.incomplete).toBe(1)
    expect(stats.totalPnL).toBeNaN()
    expect(stats.currentBalance).toBeNaN()
    expect(computeEquityStats([legacy], 10000).points).toEqual([])
    expect(tradeNetPnl({ ...known, positionSize: null })).toBeNull()
    expect(tradeRisk({ ...known, stopLoss: 100 })).toBeNaN()
  })
  it('never aggregates complete USD and EUR amounts into a common balance', () => {
    expect(computeDisciplineStats([known, { ...known, id: 2, quoteCurrency: 'EUR', accountCurrency: 'EUR' }], 10000).totalPnL).toBeNaN()
  })
  it('accounts for same currency partial exits and account fees with independent arithmetic', () => {
    const s = settlePosition(known, [event])
    expect(s.openQty).toBe(5)
    expect(s.realizedGross).toBe(100) // 5 units * $20
    expect(s.totalNet).toBe(95) // $100 - $2 entry - $3 exit
    expect(s.plannedRiskMoney).toBe(100)
  })
  it('rejects future and stale rates but retains historical snapshots without revalidation against today', () => {
    const args = { accountCurrency: 'EUR', quoteCurrency: 'USD', rates: { USD: 0.9 }, now }
    expect(() => resolveMoneyCurrency({ ...args, ratesAt: new Date('2026-10-05') })).toThrow('Zukunft')
    expect(() => resolveMoneyCurrency({ ...args, ratesAt: new Date('2026-09-01') })).toThrow('sieben Tagen')
    expect(frozenFxRate({ ...known, accountCurrency: 'EUR', quoteToAccountRate: 0.9, fxRateAt: new Date('2020-01-01') })).toBe(0.9)
    expect(frozenFxRate({ ...known, quoteToAccountRate: 0.9 })).toBeNull()
  })
  it('makes currency reassignment idempotent instead of clearing confirmed rates', () => {
    expect(currencyAssignment('USD', 'usd')).toBeNull()
    expect(currencyAssignment(null, 'USD')).toEqual({ currency: 'USD', fxRates: null, fxRatesAt: null })
    expect(() => currencyAssignment('EUR', 'USD')).toThrow('Umrechnung')
  })
  it('uses frozen futures units instead of deriving units from margin and leverage', () => {
    // One ES contract = 50 USD per point, independent of margin and leverage.
    expect(projectStopLoss({ invested: 15000, entry: 5000, sl: 4990, direction: 'long', leverage: 5, positionSize: 50, fees: { entry: 2, exit: 3 } })!.netLoss).toBe(-505)
    expect(projectTakeProfit({ invested: 15000, entry: 5000, tp: 5020, direction: 'long', sellPct: 50, positionSize: 50, fees: { entry: 2, exit: 3 } })!.netProfit).toBe(495)
  })
  it('retains honest negative preanswers and rejects duplicates or client-controlled gate', () => {
    const raw = { portfolioId: 1, ticker: 'META', market: 'aktien', tradeKind: 'langfristig', direction: 'short', entryPrice: 100, stopLoss: 110, takeProfit: 80, source: { kind: 'user_statement', capturedAt: now.toISOString(), confirmedByUser: true } }
    const answers = PRE_TRADE_QUESTIONS.map(q => ({ ...q, answer: 'nein', note: 'Unklar' }))
    expect(normalizeAssistantTradeInput({ ...raw, preTradeAnswers: answers }).input.preTradeAnswers?.every(a => a.answer === 'nein')).toBe(true)
    expect(() => normalizeAssistantTradeInput({ ...raw, preTradeAnswers: [answers[0], answers[0]] })).toThrow('doppelt')
    expect(() => normalizeAssistantTradeInput({ ...raw, preTradeAnswered: true })).toThrow('Unbekanntes')
  })
})
