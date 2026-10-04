import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'
import { AsyncLocalStorage } from 'node:async_hooks'

/** Die Neon-Postgres-Verbindung, bereitgestellt als DATABASE_URL. */
const connectionString = process.env.DATABASE_URL

export const pool = new Pool({ connectionString })
const database = drizzle(pool, { schema })
export type DatabaseTransaction = Parameters<Parameters<typeof database.transaction>[0]>[0]
const transactions = new AsyncLocalStorage<DatabaseTransaction>()

/** Locked trade operations share one connection, including existing helpers. */
export const db: typeof database = new Proxy(database, {
  get(target, property) {
    const connection = transactions.getStore() ?? target
    if (property === 'transaction') {
      return (callback: (tx: DatabaseTransaction) => Promise<unknown>, config?: Parameters<typeof database.transaction>[1]) => {
        const run = (tx: DatabaseTransaction) => transactions.run(tx, () => callback(tx))
        const active = transactions.getStore()
        return active ? active.transaction(run) : database.transaction(run, config)
      }
    }
    const value = Reflect.get(connection, property)
    return typeof value === 'function' ? value.bind(connection) : value
  },
})

// Reserve pool capacity for auth's direct Pool queries while trades hold locks.
// Without this, ten waiting trade transactions can starve the lock holder's auth query.
let activeTradeTransactions = 0
const waitingTradeTransactions: Array<() => void> = []
const tradeTransactionLimit = Math.max(1, Math.floor((pool.options?.max ?? 10) / 2))

export async function inDatabaseTransaction<T>(callback: () => Promise<T>): Promise<T> {
  if (transactions.getStore()) return db.transaction(() => callback())
  if (activeTradeTransactions >= tradeTransactionLimit) {
    await new Promise<void>((resolve) => waitingTradeTransactions.push(resolve))
  } else {
    activeTradeTransactions++
  }
  try {
    return await db.transaction(() => callback())
  } finally {
    const next = waitingTradeTransactions.shift()
    if (next) next()
    else activeTradeTransactions--
  }
}
