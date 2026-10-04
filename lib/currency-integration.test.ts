import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { PGlite } from '../.test-tools/node_modules/@electric-sql/pglite/dist/index.js'
import { drizzle } from '../.test-tools/node_modules/drizzle-orm/pglite/index.js'
import { eq } from 'drizzle-orm'
import * as schema from './db/schema'
import { NextRequest } from 'next/server'
import { PRE_TRADE_QUESTIONS } from './pre-trade-questions'
import { hashToken } from './assistant-api'
import { POST } from '../app/api/assistant/v1/trades/route'
import { assignPortfolioCurrency, updatePortfolioFxRates, moveTrade } from '../app/actions/portfolios'
import { changeCurrency, updateSettings } from '../app/actions/settings'
import { updateTradePlan } from '../app/actions/trades'
import { loadScopeContext, schreibeScope } from './portfolio-context'

const state = vi.hoisted(() => ({ db: null as any }))
vi.mock('@/lib/db', () => ({ get db() { return state.db } }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: async () => ({ user: { id: 'currency-test' } }) } } }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

let pg: PGlite
let demo: number, real: number, foreign: number, original: number
let token: string
const answers = PRE_TRADE_QUESTIONS.map(q => ({ ...q, answer: 'ja', note: 'Isolierte Testantwort' }))
const body = () => ({ portfolioId: demo, ticker: 'META', market: 'aktien', tradeKind: 'langfristig',
  direction: 'short', entryPrice: 754.43, stopLoss: 769, takeProfit: 687.15,
  investedAmount: 1056.2, leverage: 5, quoteCurrency: 'USD', preTradeAnswers: answers,
  source: { kind: 'user_statement', capturedAt: new Date().toISOString(), confirmedByUser: true } })
const request = (raw: object, key: string, bearer = token) => new NextRequest('http://localhost/api/assistant/v1/trades', {
  method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(raw),
})
const getTrade = async (id: number) => (await state.db.select().from(schema.trade).where(eq(schema.trade.id, id)))[0]

beforeAll(async () => {
  pg = new PGlite() // local WASM PostgreSQL, no network and no DATABASE_URL
  const sql = execFileSync(process.execPath, ['node_modules/drizzle-kit/bin.cjs', 'export', '--dialect', 'postgresql', '--schema', './lib/db/schema.ts'], { encoding: 'utf8' })
  // Actual previous schema: remove only the five additive currency columns.
  const before = sql.replace(/^\s*"(?:currency|quoteCurrency|accountCurrency|quoteToAccountRate|fxRateAt)"[^\n]*\n/gm, line => line.includes('NOT NULL') || line.includes('DEFAULT') ? line : '')
  // portfolio.currency is nullable; user_settings.currency has a default and is preserved.
  await pg.exec(before)
  state.db = drizzle(pg, { schema })
  await state.db.insert(schema.user).values([{ id: 'currency-test', name: 'Isolated', email: 'isolated@example.invalid' }, { id: 'other-test', name: 'Other', email: 'other@example.invalid' }])
  await pg.exec(`INSERT INTO portfolio ("userId", name, kind) VALUES ('currency-test','Demo','demo'), ('currency-test','Main','echtgeld'), ('other-test','Foreign','demo');
    INSERT INTO trade ("userId","portfolioId",ticker,"entryPrice","stopLoss","takeProfit",direction,"investedAmount","positionSize",notes,"preTradeAnswered")
    SELECT 'currency-test',id,'META',754.43,769,687.15,'short',1056.2,6.999986744959771,'Preserve original',true FROM portfolio WHERE name='Demo';`)
  const migration = readFileSync('drizzle/0043_money_currency.sql', 'utf8')
  await pg.exec(migration)
  await pg.exec(migration) // idempotent execution, actual SQL engine
  const depots = await state.db.select().from(schema.portfolio)
  demo = depots.find((p: any) => p.name === 'Demo').id
  real = depots.find((p: any) => p.name === 'Main').id
  foreign = depots.find((p: any) => p.name === 'Foreign').id
  original = (await state.db.select().from(schema.trade))[0].id
  await assignPortfolioCurrency(demo, 'USD')
  await state.db.update(schema.portfolio).set({ startCapital: 100000 }).where(eq(schema.portfolio.id, demo))
  await assignPortfolioCurrency(real, 'EUR')
  await state.db.insert(schema.stock).values([{ userId: 'currency-test', ticker: 'META', name: 'Meta', market: 'aktien', resolvedCurrency: 'USD', resolutionStatus: 'ok' },
    { userId: 'currency-test', ticker: 'ES1!', name: 'ES', market: 'rohstoffe', resolvedCurrency: 'USD', resolutionStatus: 'ok' }])
  token = `sat_${'a'.repeat(43)}` // synthetic token exists only in this in-memory database
  await state.db.insert(schema.assistantApiToken).values({ userId: 'currency-test', name: 'Isolated', tokenHash: hashToken(token), scopes: ['trades:write', 'trades:read'] })
}, 60000)
afterAll(async () => { await pg?.close() })

describe('isolated PostgreSQL currency integration', () => {
  it('keeps mixed-currency scope selectable without summing its capital', async () => {
    const [extra] = await state.db.insert(schema.portfolio).values({ userId: 'currency-test', name: 'Second real', kind: 'echtgeld', currency: 'USD', startCapital: 1234 }).returning()
    await schreibeScope('currency-test', { type: 'alleEchtgeld' })
    const context = await loadScopeContext('currency-test')
    expect(context.moneyAvailable).toBe(false)
    expect(context.startCapital).toBeNaN()
    expect(context.portfolioIds).toContain(extra.id)
    expect(context.moneyIssue).toContain('einzelnes Depot')
  })
  it('applies the additive migration twice and preserves original history', async () => {
    const t = await getTrade(original)
    expect(t).toMatchObject({ notes: 'Preserve original', quoteCurrency: null, accountCurrency: null, quoteToAccountRate: null, investedAmount: 1056.2, preTradeAnswered: true })
    expect(t.positionSize).toBeCloseTo(6.999986744959771, 12)
  })
  it('creates via the real API route, reads back the snapshot and preserves preanswers', async () => {
    const raw = body(), key = '10000000-0000-4000-8000-000000000001'
    const response = await POST(request(raw, key))
    expect(response.status).toBe(201)
    const saved = await response.json()
    expect(await getTrade(saved.id)).toMatchObject({ portfolioId: demo, quoteCurrency: 'USD', accountCurrency: 'USD', quoteToAccountRate: 1, preTradeAnswered: true, tradedWithMoney: false })
    expect(saved.positionSize).toBeCloseTo(6.999986744959771, 12)
    expect(JSON.parse(saved.preTradeAnswers)).toEqual(answers)
    expect((await POST(request(raw, key))).status).toBe(200)
    expect((await POST(request({ ...raw, notes: 'different' }, key))).status).toBe(409)
    expect((await getTrade(original)).notes).toBe('Preserve original')
  })
  it('rejects foreign ownership, missing permissions and conflicting instrument currency', async () => {
    expect((await POST(request({ ...body(), portfolioId: foreign }, '10000000-0000-4000-8000-000000000002'))).status).toBe(422)
    expect((await POST(request({ ...body(), quoteCurrency: 'EUR' }, '10000000-0000-4000-8000-000000000003'))).status).toBe(422)
    const readOnly = `sat_${'b'.repeat(43)}`
    await state.db.insert(schema.assistantApiToken).values({ userId: 'currency-test', name: 'Read only', tokenHash: hashToken(readOnly), scopes: ['trades:read'] })
    expect((await POST(request(body(), '10000000-0000-4000-8000-000000000004', readOnly))).status).toBe(403)
  })
  it('freezes FX snapshots across depot rate edits and repeated currency assignment', async () => {
    await updatePortfolioFxRates(real, { USD: 0.9 })
    const response = await POST(request({ ...body(), portfolioId: real, entryPrice: 100, stopLoss: 110, takeProfit: 80, investedAmount: 900, leverage: 1, feeEntry: 2, feeExit: 3 }, '10000000-0000-4000-8000-000000000005'))
    expect(response.status).toBe(201)
    const t = await response.json()
    expect(t.positionSize).toBe(10)
    await assignPortfolioCurrency(real, 'EUR')
    expect((await state.db.select().from(schema.portfolio).where(eq(schema.portfolio.id, real)))[0].fxRates).toBe('{"USD":0.9}')
    await updatePortfolioFxRates(real, { USD: 0.8 })
    expect((await getTrade(t.id)).quoteToAccountRate).toBe(0.9)
    await expect(moveTrade(t.id, demo)).rejects.toThrow('verschiedenen Depotwährungen')
  })
  it('blocks global conversion and legacy size recalculation before writes', async () => {
    await expect(changeCurrency({ currency: 'USD', rate: 0.8, defaultRiskPct: 1, maxRiskPct: 2 })).rejects.toThrow('gesperrt')
    await expect(updateSettings({ currency: 'USD', defaultRiskPct: 1, maxRiskPct: 2 })).rejects.toThrow('umetikettieren')
    await expect(updateTradePlan(original, { investedAmount: 1200 })).rejects.toThrow('FX-Snapshot')
    expect((await getTrade(original)).investedAmount).toBe(1056.2)
  })
  it('uses contract quantities and currency rather than invested amount times leverage', async () => {
    const response = await POST(request({ ...body(), ticker: 'ES1!', market: 'rohstoffe', portfolioId: demo, direction: 'long', entryPrice: 5000, stopLoss: 4990, takeProfit: 5020, contracts: 1, investedAmount: 1, leverage: 1 }, '10000000-0000-4000-8000-000000000006'))
    expect(response.status).toBe(201)
    const t = await response.json()
    expect(t.positionSize).toBe(50)
    expect(t.contractCurrency).toBe('USD')
    expect(t.investedAmount).toBe(t.contractInitialMargin)
  })
})
