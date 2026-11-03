import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { db } from '@/lib/db'
import { candleCache, candleSeries, candleCollectRun } from '@/lib/db/schema'
import { marketLocation, MARKET_POOL_OPTIONS } from './location.mjs'

// This module is imported only by server data paths. Never expose URLs/status errors.
let target: ReturnType<typeof drizzle> | undefined
let targetPool: Pool | undefined
const configured = { MARKET_DATA_ROUTING_VERSION: process.env.MARKET_DATA_ROUTING_VERSION,
  MARKET_DATA_LOCATION: process.env.MARKET_DATA_LOCATION, MARKET_DATABASE_URL: process.env.MARKET_DATABASE_URL,
  DATABASE_URL: process.env.DATABASE_URL }
function database(): typeof db {
  const location = marketLocation(configured)
  if (location.location === 'A') return db
  if (!target) {
    targetPool = new Pool({ connectionString: location.connectionString, ...MARKET_POOL_OPTIONS })
    targetPool.on('error', () => { lastPoolError = true })
    target = drizzle(targetPool, { schema: { candleCache, candleSeries, candleCollectRun } })
  }
  // B never inherits the AsyncLocalStorage transaction in A. No distributed commit.
  return target as typeof db
}
let lastPoolError = false
export const marketDb: typeof db = new Proxy({} as typeof db, {
  get(_target, property) {
    const connection = database()
    const value = Reflect.get(connection, property)
    return typeof value === 'function' ? value.bind(connection) : value
  },
})
export function marketDatabaseStatus() {
  try { const { location, version } = marketLocation(configured)
    return { location, version, initialized: !!targetPool, poolError: lastPoolError,
      total: targetPool?.totalCount ?? 0, idle: targetPool?.idleCount ?? 0, waiting: targetPool?.waitingCount ?? 0 }
  } catch { return { location: 'unavailable', version: 'invalid', initialized: false, poolError: true } }
}
export async function closeMarketDatabase() { await targetPool?.end(); targetPool = undefined; target = undefined }
