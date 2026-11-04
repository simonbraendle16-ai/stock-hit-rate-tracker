import { expect, it } from 'vitest'
import { marketCronAuthorized } from './market-cron-auth'
const env = { CRON_SECRET: 'synthetic-general', MARKET_SCHEDULER_KEY: 'synthetic-scoped' }
it('limits the new credential to the exact collector path', () => {
  expect(marketCronAuthorized('Bearer synthetic-scoped', '/api/cron/collect-candles', env)).toBe(true)
  for (const path of ['/api/cron/sync-symbols', '/api/cron/demo-cycle', '/api/cron/demo-fills', '/api/cron/check-alerts', '/api/cron/collect-candles/other']) {
    expect(marketCronAuthorized('Bearer synthetic-scoped', path, env)).toBe(false)
  }
})
it('preserves existing authentication and rejects missing or wrong secrets', () => {
  expect(marketCronAuthorized('Bearer synthetic-general', '/api/cron/sync-symbols', env)).toBe(true)
  for (const token of [null, '', 'synthetic-scoped', 'Bearer wrong', 'Bearer synthetic-scoped ']) {
    expect(marketCronAuthorized(token, '/api/cron/collect-candles', env)).toBe(false)
  }
  expect(marketCronAuthorized('Bearer synthetic-scoped', '/api/cron/collect-candles', {})).toBe(false)
})
