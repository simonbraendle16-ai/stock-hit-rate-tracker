import { describe, expect, it } from 'vitest'
import { matchingPlannedTradeId, normalizeBrokerOrder } from './assistant-broker-order'

const accepted = {
  portfolioId: 6,
  brokerAccountId: 'demo-account',
  brokerOrderId: 'limit-123',
  ticker: 'SOLUSD',
  direction: 'short',
  orderType: 'limit',
  state: 'accepted',
  limitPrice: 120.5,
  stopLoss: 123,
  observedAt: '2026-09-28T12:00:00Z',
}

describe('Broker-Auftragsimport', () => {
  it('nimmt eine angenommene Limit-Order ohne Ziel als unvollständig an', () => {
    const order = normalizeBrokerOrder(accepted)
    expect(order.takeProfit).toBeNull()
    expect(order.state).toBe('accepted')
  })

  it('erfasst einen Fill auch bei noch fehlenden Ausführungsdetails ohne Werte zu erfinden', () => {
    const partial = normalizeBrokerOrder({ ...accepted, state: 'filled' })
    expect(partial.executionPrice).toBeNull()
    expect(partial.filledAt).toBeNull()
    expect(normalizeBrokerOrder({ ...accepted, state: 'filled',
      filledAt: '2026-09-28T12:10:00Z', executionPrice: 120.5 }).filledAt).toBeInstanceOf(Date)
  })

  it('verknüpft nur einen eindeutigen Plan mit gleicher Richtung und gleichem Einstieg', () => {
    const order = normalizeBrokerOrder(accepted)
    const plan = { id: 10, ticker: 'SOLUSD', direction: 'short', entryPrice: 120.5 }
    expect(matchingPlannedTradeId(order, [plan])).toBe(10)
    expect(matchingPlannedTradeId(order, [plan, { ...plan, id: 11 }])).toBeNull()
    expect(matchingPlannedTradeId(order, [{ ...plan, direction: 'long' }])).toBeNull()
  })
})
