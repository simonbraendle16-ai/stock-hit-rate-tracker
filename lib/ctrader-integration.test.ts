import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import * as schema from './db/schema'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({ database: null as any, owner: 'isolated' }))
vi.mock('@/lib/db', () => ({ get db() { return state.database } }))
vi.mock('@/lib/assistant-api', async importOriginal => ({
  ...await importOriginal<typeof import('./assistant-api')>(),
  requireApiScope: vi.fn(async () => state.owner),
}))
import { POST as importOrder, GET as readOrders } from '../app/api/assistant/v1/broker-orders/route'
import { POST as importExit } from '../app/api/assistant/v1/broker-exits/route'

let pg: PGlite
const order = { broker: 'ctrader', portfolioId: 1, brokerAccountId: 'isolated-account', brokerOrderId: '10',
  brokerPositionId: '20', ticker: 'SOLUSD', direction: 'short', orderType: 'limit', state: 'filled',
  quantity: 18, limitPrice: 112.1, executionPrice: 112.1, stopLoss: 115, takeProfit: 96,
  filledAt: '2026-10-14T12:00:00Z', observedAt: '2026-10-14T12:01:00Z',
  brokerDetails: { symbolId: 10132, sourceOrderType: 'LIMIT', sourceStatus: 'FILLED',
    advancedTakeProfit: [{ takeProfit: 101.56, volume: 900 }], trailingStopLoss: false } }
function req(path: string, body?: unknown) {
  return new NextRequest('https://isolated.invalid/api/assistant/v1' + path,
    body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
}

beforeAll(async () => {
  pg = new PGlite(); state.database = drizzle(pg, { schema })
  const dialect = new PgDialect()
  for (const table of [schema.user, schema.portfolio, schema.trade, schema.tradeEvent, schema.brokerOrder, schema.brokerExit]) {
    const c = getTableConfig(table)
    const columns = c.columns.filter(col => col.name !== 'brokerDetails').map(col => {
      const v = col.default
      const def = v === undefined ? '' : ' DEFAULT ' + (typeof v === 'string' ? `'${v.replaceAll("'", "''")}'`
        : typeof v === 'number' || typeof v === 'boolean' ? String(v) : dialect.sqlToQuery(v as any).sql)
      return `"${col.name}" ${col.getSQLType()}${col.primary ? ' PRIMARY KEY' : ''}${def}`
    })
    await pg.exec(`CREATE TABLE "${c.name}" (${columns.join(',')})`)
  }
  await pg.exec(`CREATE UNIQUE INDEX broker_order_identity ON broker_order ("userId",broker,"brokerAccountId","brokerOrderId");
    CREATE UNIQUE INDEX broker_exit_identity ON broker_exit ("userId",broker,"brokerAccountId","brokerExitId");
    INSERT INTO broker_order ("userId",broker,"brokerAccountId","brokerOrderId",ticker) VALUES ('legacy','avatrade','legacy','legacy','LEGACY');`)
  const migration = readFileSync(new URL('../drizzle/0054_ctrader_broker_details.sql', import.meta.url), 'utf8')
  await pg.exec(migration); await pg.exec(migration)
  const old = await pg.query('SELECT ticker,"brokerDetails" FROM broker_order WHERE "userId"=\'legacy\'')
  expect(old.rows).toEqual([{ ticker: 'LEGACY', brokerDetails: null }])
}, 30000)
afterAll(async () => { vi.unstubAllEnvs(); await pg?.close() })
beforeEach(async () => {
  vi.stubEnv('CTRADER_DEMO_ACCOUNT_ID', 'isolated-account'); vi.stubEnv('CTRADER_DEMO_PORTFOLIO_ID', '1')
  vi.stubEnv('AVATRADE_DEMO_ACCOUNT_ID', 'isolated-account'); state.owner = 'isolated'
  await pg.exec(`TRUNCATE broker_order,broker_exit,portfolio,trade,trade_event RESTART IDENTITY;
    INSERT INTO portfolio (id,"userId",name,kind,currency) VALUES
    (1,'isolated','Demo','demo','EUR'),(2,'isolated','Other demo','demo','EUR'),(3,'isolated','Live','echtgeld','EUR');`)
})

describe('cTrader broker evidence on isolated PostgreSQL', () => {
  it('isolates same-numbered AvaTrade orders, repeats safely, and clears complete protections', async () => {
    expect((await importOrder(req('/broker-orders', order))).status).toBe(201)
    expect((await importOrder(req('/broker-orders', { ...order, broker: 'avatrade', brokerDetails: undefined }))).status).toBe(201)
    expect((await importOrder(req('/broker-orders', order))).status).toBe(200)
    const later = { ...order, stopLoss: null, takeProfit: null, observedAt: '2026-10-14T12:02:00Z',
      brokerDetails: { ...order.brokerDetails, advancedTakeProfit: [] } }
    expect((await importOrder(req('/broker-orders', later))).status).toBe(200)
    const page = await (await readOrders(req('/broker-orders?portfolioId=1'))).json()
    expect(page.items).toHaveLength(2)
    const current = page.items.find((r: any) => r.broker === 'ctrader')
    expect(current.stopLoss).toBeNull(); expect(current.takeProfit).toBeNull()
    expect(current.brokerDetails.advancedTakeProfit).toEqual([])
    // An older repeated snapshot must not restore the removed protection.
    await importOrder(req('/broker-orders', order))
    expect((await (await readOrders(req('/broker-orders?portfolioId=1'))).json()).items.find((r: any) => r.broker === 'ctrader').stopLoss).toBeNull()
  })
  it('rejects wrong account, wrong depot, live depot and another owner', async () => {
    for (const change of [{ brokerAccountId: 'other' }, { portfolioId: 2 }, { portfolioId: 3 }]) {
      expect((await importOrder(req('/broker-orders', { ...order, ...change }))).status).toBeGreaterThanOrEqual(400)
    }
    state.owner = 'other'
    expect((await importOrder(req('/broker-orders', order))).status).toBe(404)
    expect((await pg.query('SELECT * FROM broker_order')).rows).toHaveLength(0)
  })
  it('stores an exit once without manufacturing a confirmed entry or personal trade event', async () => {
    await importOrder(req('/broker-orders', order))
    const exit = { broker: 'ctrader', portfolioId: 1, brokerAccountId: 'isolated-account', brokerPositionId: '20',
      brokerExitId: '30', quantity: 9, price: 101.56, exitedAt: '2026-10-14T12:10:00Z', observedAt: '2026-10-14T12:11:00Z' }
    const response = await importExit(req('/broker-exits', exit))
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200)
    expect((await response.json()).outcome).toBe('unresolved')
    expect((await importExit(req('/broker-exits', exit))).status).toBe(200)
    expect((await pg.query('SELECT * FROM broker_exit')).rows).toHaveLength(1)
    expect((await pg.query('SELECT * FROM trade_event')).rows).toHaveLength(0)
    expect((await importExit(req('/broker-exits', { ...exit, quantity: 10 }))).status).toBe(409)
    expect((await importExit(req('/broker-exits', { ...exit, broker: 'avatrade' }))).status).toBe(200)
    expect((await pg.query('SELECT * FROM broker_exit')).rows).toHaveLength(2)
  })
})
