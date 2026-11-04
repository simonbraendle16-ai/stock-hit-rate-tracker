import { timingSafeEqual } from 'node:crypto'

function matches(header: string | null, secret: string | undefined): boolean {
  if (!header || !secret) return false
  const actual = Buffer.from(header), expected = Buffer.from(`Bearer ${secret}`)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
/** Prepared B3 only: a separate credential authorizes exactly the market route.
 * Existing GitHub/Vercel credentials keep their existing compatibility entry. */
export function marketCronAuthorized(header: string | null, pathname: string,
  env: { CRON_SECRET?: string; MARKET_SCHEDULER_KEY?: string }): boolean {
  if (matches(header, env.CRON_SECRET)) return true
  return pathname === '/api/cron/collect-candles' && matches(header, env.MARKET_SCHEDULER_KEY)
}
