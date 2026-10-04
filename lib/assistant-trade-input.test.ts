import { describe, expect, it } from 'vitest'
import { canonicalBody, normalizeAssistantTradeInput } from './assistant-trade-input'

const valid = {
  portfolioId: 12, ticker: 'SOL', market: 'krypto', tradeKind: 'schnell',
  direction: 'long', entryPrice: 100, stopLoss: 98, takeProfit: 104,
  source: { kind: 'user_statement', capturedAt: '2026-09-23T08:00:00Z', confirmedByUser: true },
}

describe('assistant trade input', () => {
  it('accepts an explicitly confirmed planned trade', () => {
    const result = normalizeAssistantTradeInput(valid)
    expect(result.input).toMatchObject({ portfolioId: 12, ticker: 'SOL', entryPrice: 100 })
    expect(result.source.capturedAt).toBe('2026-09-23T08:00:00.000Z')
  })

  it('rejects absent user confirmation', () => {
    expect(() => normalizeAssistantTradeInput({ ...valid, source: { ...valid.source, confirmedByUser: false } }))
      .toThrow('bestätigte Nutzeraussage')
  })

  it('rejects derived or client-controlled trade state', () => {
    expect(() => normalizeAssistantTradeInput({ ...valid, tradedWithMoney: false })).toThrow('Unbekanntes')
    expect(() => normalizeAssistantTradeInput({ ...valid, stockId: 7 })).toThrow('Unbekanntes')
    expect(() => normalizeAssistantTradeInput({ ...valid, positionSize: 2 })).toThrow('Unbekanntes')
  })

  it('rejects malformed numerical values', () => {
    expect(() => normalizeAssistantTradeInput({ ...valid, entryPrice: '100' })).toThrow('Einstieg')
    expect(() => normalizeAssistantTradeInput({ ...valid, portfolioId: -1 })).toThrow('ID')
  })

  it('hashes equivalent JSON property order identically', () => {
    expect(canonicalBody(valid)).toBe(canonicalBody({ ...valid, source: { confirmedByUser: true,
      capturedAt: valid.source.capturedAt, kind: 'user_statement' } }))
  })
})
