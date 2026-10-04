import { describe, expect, it } from 'vitest'
import { resolveMoneyCurrency, frozenFxRate, scopeCurrency } from './money-currency'
import { computeShares, projectStopLoss, projectTakeProfit, computeRiskReward } from './trade-math'
import { tradeGrossPnl, tradeRisk, type TradeRow } from './trade-stats'
import { settlePosition } from './trade-events'

const at = new Date('2026-10-02T16:00:00Z')
describe('currency-aware trade planning', () => {
  it('keeps the Meta USD demo risk at 101.99 without multiplying leverage twice', () => {
    const fx = resolveMoneyCurrency({ accountCurrency: 'USD', quoteCurrency: 'USD', rates: {} })
    expect(fx.quoteToAccountRate).toBe(1)
    expect(computeShares(1056.2, 754.43, 5, 1)).toBeCloseTo(7, 4)
    expect(projectStopLoss({ invested: 1056.2, entry: 754.43, sl: 769, direction: 'short', leverage: 5, fees: { entry: 0, exit: 0 }, quoteToAccountRate: 1 })!.netLoss).toBeCloseTo(-101.99, 2)
  })
  it('converts EUR capital to USD units, then USD profit back to EUR before EUR fees', () => {
    const rate = resolveMoneyCurrency({ accountCurrency: 'EUR', quoteCurrency: 'USD', rates: { USD: 0.9 }, ratesAt: at }).quoteToAccountRate
    expect(computeShares(900, 100, 1, rate)).toBe(10)
    const sl = projectStopLoss({ invested: 900, entry: 100, sl: 90, direction: 'long', quoteToAccountRate: rate, fees: { entry: 2, exit: 3 } })!
    const tp = projectTakeProfit({ invested: 900, entry: 100, tp: 120, direction: 'long', sellPct: 100, quoteToAccountRate: rate, fees: { entry: 2, exit: 3 } })!
    expect(sl.grossLoss).toBe(-90)
    expect(sl.netLoss).toBe(-95)
    expect(tp.grossProfit).toBe(180)
    expect(tp.netProfit).toBe(175)
    expect(computeRiskReward(100, 90, 120)).toBe(2)
  })
  it('rejects missing, invalid and undated foreign exchange rates and conflicting quote currencies', () => {
    for (const rates of [{}, { USD: 0 }, { USD: -1 }, { USD: NaN }] as Record<string, number>[]) {
      expect(() => resolveMoneyCurrency({ accountCurrency: 'EUR', quoteCurrency: 'USD', rates, ratesAt: at })).toThrow()
    }
    expect(() => resolveMoneyCurrency({ accountCurrency: 'EUR', quoteCurrency: 'USD', rates: { USD: 0.9 } })).toThrow()
    expect(() => resolveMoneyCurrency({ accountCurrency: 'EUR', quoteCurrency: 'EUR', resolvedCurrency: 'USD', rates: {} })).toThrow()
    expect(() => resolveMoneyCurrency({ accountCurrency: 'EUR', rates: {} })).toThrow()
    expect(frozenFxRate({})).toBeNull()
    expect(frozenFxRate({ accountCurrency: 'EUR', quoteCurrency: 'USD', quoteToAccountRate: 0.9, fxRateAt: at })).toBe(0.9)
  })
  it('does not add EUR and USD portfolios as if they were the same unit', () => {
    expect(scopeCurrency([{ currency: 'EUR' }], 'USD')).toBe('EUR')
    expect(() => scopeCurrency([{ currency: 'EUR' }, { currency: 'USD' }], 'EUR')).toThrow()
  })
  it('keeps foreign plan risk but does not claim a realized FX settlement', () => {
    const t = { entryPrice: 100, stopLoss: 90, actualExitPrice: 120, positionSize: 10, direction: 'long', result: 'gewinn', tradedWithMoney: true, feeEntry: 0, quoteCurrency: 'USD', accountCurrency: 'EUR', quoteToAccountRate: 0.9, fxRateAt: at } as TradeRow
    expect(tradeGrossPnl(t)).toBeNull()
    expect(tradeRisk(t)).toBe(90)
    const s = settlePosition(t, [{ id: 1, type: 'teilverkauf', price: 120, quantity: 5, fee: 2, at, createdAt: at, userId: 'u', tradeId: 1, note: null, payload: null }])
    expect(s.realizedGross).toBeNaN()
    expect(s.totalNet).toBeNaN()
    expect(s.openQty).toBe(5)
    expect(s.plannedRiskMoney).toBe(90)
  })
})
