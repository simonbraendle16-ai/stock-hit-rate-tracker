import { describe, expect, it } from 'vitest'
import { assertBrokerBinding, normalizeBrokerSource, normalizeBrokerDetails } from './broker-source'
import { normalizeBrokerOrder } from './assistant-broker-order'

const env = { AVATRADE_DEMO_ACCOUNT_ID: '101', CTRADER_DEMO_ACCOUNT_ID: '101', CTRADER_DEMO_PORTFOLIO_ID: '9' }
describe('isolated broker identity', () => {
  it('preserves the old collector but refuses unknown or null sources', () => {
    expect(normalizeBrokerSource(undefined)).toBe('avatrade')
    expect(normalizeBrokerSource('ctrader')).toBe('ctrader')
    for (const bad of [null, '', 'icmarkets', 'live']) expect(() => normalizeBrokerSource(bad)).toThrow()
  })
  it('binds cTrader to both account and portfolio, including overlapping broker IDs', () => {
    expect(() => assertBrokerBinding('avatrade', '101', 6, env)).not.toThrow()
    expect(() => assertBrokerBinding('ctrader', '101', 9, env)).not.toThrow()
    for (const [account, portfolio] of [['102', 9], ['101', 6]] as const) {
      expect(() => assertBrokerBinding('ctrader', account, portfolio, env)).toThrow()
    }
    expect(() => assertBrokerBinding('ctrader', '101', 9, {})).toThrow()
    expect(() => assertBrokerBinding('ctrader', '101', 9, { CTRADER_DEMO_ACCOUNT_ID: '101' })).toThrow()
  })
  it('preserves broker partial targets without treating them as user plan edits', () => {
    const details = { symbolId: 10132, sourceOrderType: 'LIMIT', sourceStatus: 'FILLED',
      advancedTakeProfit: [{ takeProfit: 101.56, volume: 900 }], trailingStopLoss: false }
    const order = normalizeBrokerOrder({ broker: 'ctrader', portfolioId: 9, brokerAccountId: '101',
      brokerOrderId: '100', ticker: 'SOLUSD', direction: 'short', orderType: 'limit', state: 'filled',
      quantity: 18, executionPrice: 112.1, observedAt: '2026-10-14T12:00:00Z', brokerDetails: details })
    expect(order.broker).toBe('ctrader')
    expect(order.brokerDetails).toEqual(details)
    expect(() => normalizeBrokerDetails({ ...details, Authorization: 'secret' }, 'ctrader')).toThrow()
    expect(() => normalizeBrokerDetails(details, 'avatrade')).toThrow()
    expect(() => normalizeBrokerDetails({ ...details, advancedTakeProfit: [{ takeProfit: 0, volume: 900 }] }, 'ctrader')).toThrow()
  })
})
