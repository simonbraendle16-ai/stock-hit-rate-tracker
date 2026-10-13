import { describe, expect, it } from 'vitest'
import { formNumber } from './form-number'
import { tradeFormPreview, type PreviewForm } from './trade-form-preview'
import { resolveMoneyCurrency } from './money-currency'
import { lookupContractSpec } from './contract-specs'
import { manualPositionSize } from './trade-form-size'

const form: PreviewForm = { entryPrice: '45,28', stopLoss: '46,80', takeProfit: '39,41', direction: 'short', investedAmount: '500', positionSize: '', contracts: '', leverage: '5' }
const conversion = resolveMoneyCurrency({ accountCurrency: 'USD', quoteCurrency: 'EUR', rates: { EUR: 1.1 }, ratesAt: new Date() })
const base = { form, targets: [], conversion, conversionError: null, instrumentStatus: 'ready' as const, spec: null, fees: { entry: 0, exit: 0 } }
function value(overrides: Partial<Parameters<typeof tradeFormPreview>[0]> = {}) {
  const result = tradeFormPreview({ ...base, ...overrides })
  expect(result.error).toBeNull()
  return result.value!
}

describe('form decimal parsing', () => {
  it('preserves scientific notation for small crypto prices', () => expect(formNumber('1,2e-8')).toBe(1.2e-8))
  it.each(['45,28', '45.28', ' 45,28 '])('parses the entire decimal %s', raw => expect(formNumber(raw)).toBe(45.28))
  it.each(['', '45foo', '1,2,3', '1.234,56', 'Infinity', 'NaN'])('rejects ambiguous or invalid input %s', raw => expect(formNumber(raw)).toBeNaN())
  it('uses the same decimal parser for the submitted manual quantity', () => expect(manualPositionSize({ investedAmount: '', contracts: '', positionSize: '20,5' })).toBe(20.5))
})

describe('trade form preview', () => {
  it('reproduces BAYN short capital and leverage in account currency', () => {
    const result = value()
    expect(result.shares).toBeCloseTo(2500 / (45.28 * 1.1), 10)
    expect(result.stop.grossLoss).toBeCloseTo(-83.9222614841, 8)
    expect(result.grossProfit).toBeCloseTo(324.0945229682, 8)
  })
  it('does not multiply a manual quantity by leverage', () => {
    const result = value({ form: { ...form, investedAmount: '', positionSize: '20,5' } })
    expect(result.shares).toBe(20.5)
    expect(result.stop.grossLoss).toBeCloseTo(-1.52 * 20.5 * 1.1)
    expect(result.grossProfit).toBeCloseTo(5.87 * 20.5 * 1.1)
  })
  it('capital wins over a hidden stale manual quantity', () => expect(value({ form: { ...form, positionSize: '999' } }).shares).toBe(value().shares))
  it.each(['long', 'short'] as const)('projects %s in equal and different currencies', direction => {
    for (const rate of [1, 1.1]) {
      const fx = { ...conversion, quoteToAccountRate: rate, accountCurrency: rate === 1 ? 'EUR' : 'USD' }
      const result = value({ conversion: fx, form: { ...form, entryPrice: '100', stopLoss: direction === 'long' ? '90' : '110', takeProfit: direction === 'long' ? '120' : '80', direction, investedAmount: '', positionSize: '10' } })
      expect(result.stop.grossLoss).toBe(-100 * rate)
      expect(result.grossProfit).toBe(200 * rate)
    }
  })
  it('shows every stage using initial quantity and charges entry only once', () => {
    const result = value({ form: { ...form, investedAmount: '', positionSize: '20' }, targets: [{ price: 43, sharePct: 25 }, { price: 41, sharePct: 25 }], fees: { entry: 2, exit: 3 } })
    expect(result.stages.map(stage => stage.projection.soldShares)).toEqual([5, 5, 10])
    expect(result.grossProfit).toBeCloseTo((2.28 * 5 + 4.28 * 5 + 5.87 * 10) * 1.1)
    expect(result.totalFees).toBe(11)
    expect(result.netProfit).toBeCloseTo(result.grossProfit - 11)
    expect(result.stop.netLoss).toBeCloseTo(-1.52 * 20 * 1.1 - 5)
  })
  it('uses existing contract multipliers and margin', () => {
    const result = value({ spec: lookupContractSpec('ES1!', 'rohstoffe'), conversion: { ...conversion, quoteCurrency: 'USD', quoteToAccountRate: 1 }, form: { ...form, entryPrice: '5000', stopLoss: '4990', takeProfit: '5020', direction: 'long', contracts: '2' } })
    expect(result.shares).toBe(100)
    expect(result.stop.grossLoss).toBe(-1000)
    expect(result.grossProfit).toBe(2000)
  })
  it.each(['idle', 'loading', 'error'] as const)('shows a prerequisite for instrument status %s', instrumentStatus => expect(tradeFormPreview({ ...base, instrumentStatus }).error).toMatch(/Instrumentprüfung/))
  it('never guesses missing or stale FX', () => {
    expect(tradeFormPreview({ ...base, conversion: null, conversionError: 'FX-Plankurs veraltet.' })).toEqual({ value: null, error: 'FX-Plankurs veraltet.' })
    expect(() => resolveMoneyCurrency({ accountCurrency: 'USD', quoteCurrency: 'EUR', rates: { EUR: 1.1 }, ratesAt: new Date('2026-01-01') })).toThrow(/sieben Tagen/)
  })
  it.each([{ investedAmount: 'oops' }, { investedAmount: '-5' }, { leverage: '0' }, { stopLoss: '40' }, { takeProfit: '48' }])('explains invalid values %j', patch => expect(tradeFormPreview({ ...base, form: { ...form, ...patch } }).error).toBeTruthy())
  it('does not show a target result for a broken partial plan', () => expect(tradeFormPreview({ ...base, targets: [{ price: NaN, sharePct: 50 }] }).value).toBeNull())
})
