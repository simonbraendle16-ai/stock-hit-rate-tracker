import { describe, expect, it } from 'vitest'
import { normalizeSettlementReceipt, receiptSignature } from './settlement-receipt'
import { settlePosition, type TradeEventRow, type TradeRow } from './trade-events'

const raw = { currency: 'EUR', netAmount: 72, grossAmount: 80,
  entryFeesTreatment: 'included', commission: 5, financing: 3,
  evidence: 'Broker statement exit 123', source: 'manual_broker_receipt',
  capturedAt: '2026-10-04T12:00:00Z' }
const trade = { id: 1, direction: 'long', entryPrice: 100, stopLoss: 90,
  positionSize: 10, feeEntry: 9, tradedWithMoney: true, quoteCurrency: 'USD',
  accountCurrency: 'EUR', quoteToAccountRate: 0.9, fxRateAt: new Date('2026-10-01') } as TradeRow
const exit = (quantity: number, receipt: unknown, id = 1) => ({ id, tradeId: 1,
  type: quantity === 10 ? 'geschlossen' : 'teilverkauf', quantity, price: 110,
  fee: 99, at: new Date(`2026-10-04T10:0${id}:00Z`), payload: JSON.stringify({ settlement: receipt }) }) as TradeEventRow

describe('actual broker settlement', () => {
  it('takes the actual account amount instead of plan FX and does not deduct costs twice', () => {
    const s = settlePosition(trade, [exit(10, raw)])
    expect(s.moneyComplete).toBe(true)
    expect(s.realizedGross).toBe(80) // Plan projection would be 90 EUR.
    expect(s.totalNet).toBe(72) // Already net of all allocated entry costs.
    expect(s.openQty).toBe(0)
  })
  it('subtracts frozen entry fees only when the broker net explicitly excludes them', () => {
    const s = settlePosition(trade, [exit(10, { ...raw, entryFeesTreatment: 'excluded' })])
    expect(s.totalNet).toBe(63)
  })
  it('can settle a net-only statement without inventing gross P&L or FX', () => {
    const s = settlePosition(trade, [exit(10, { ...raw, grossAmount: null })])
    expect(s.totalNet).toBe(72)
    expect(s.realizedGross).toBeNaN()
    expect(s.realizedR).toBeNaN()
  })
  it('folds partial exits with different actual FX, not one frozen plan rate', () => {
    const s = settlePosition(trade, [exit(4, { ...raw, netAmount: 31, grossAmount: 34 }),
      exit(6, { ...raw, netAmount: -12, grossAmount: -8 }, 2)])
    expect(s.totalNet).toBe(19)
    expect(s.realizedGross).toBe(26)
    expect(s.openQty).toBe(0)
  })
  it('keeps a missing foreign receipt unknown while preserving the exit quantity', () => {
    const s = settlePosition(trade, [exit(4, raw), exit(6, null, 2)])
    expect(s.moneyComplete).toBe(false)
    expect(s.totalNet).toBeNaN()
    expect(s.openQty).toBe(0)
  })
  it('rejects mixed fee scopes and wrong account currencies from aggregation', () => {
    expect(settlePosition(trade, [exit(4, raw), exit(6, { ...raw, entryFeesTreatment: 'excluded' }, 2)]).moneyComplete).toBe(false)
    expect(settlePosition(trade, [exit(10, { ...raw, currency: 'USD' })]).moneyComplete).toBe(false)
  })
  it('supports a documented historical account amount without retrofitting the plan', () => {
    const s = settlePosition({ ...trade, accountCurrency: null, quoteToAccountRate: null }, [exit(10, raw)])
    expect(s.totalNet).toBe(72)
    expect(s.plannedRiskMoney).toBeNaN()
  })
  it('rejects unknown source, missing fee semantics, nonfinite amounts and incomplete FX', () => {
    for (const invalid of [{ ...raw, netAmount: NaN }, { ...raw, entryFeesTreatment: null },
      { ...raw, source: 'estimated' }, { ...raw, quoteToAccountRate: 0.92 }, { ...raw, evidence: '' }]) {
      expect(() => normalizeSettlementReceipt(invalid)).toThrow()
    }
  })
  it('allows negative P&L, zero P&L and financing credits', () => {
    expect(normalizeSettlementReceipt({ ...raw, netAmount: -15, financing: -3 }).netAmount).toBe(-15)
    expect(normalizeSettlementReceipt({ ...raw, netAmount: 0 }).netAmount).toBe(0)
  })
  it('does not turn a repeated observation into a receipt revision', () => {
    expect(receiptSignature(normalizeSettlementReceipt(raw))).toBe(receiptSignature(normalizeSettlementReceipt({
      ...raw, capturedAt: '2026-10-04T13:00:00Z' })))
  })
})
