import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTableName } from 'drizzle-orm'

const state = vi.hoisted(() => ({ last: null as Date | null, fail: true, calls: [] as { symbol: string; options: unknown }[] }))
vi.mock('@/lib/db', () => {
  const query = (rows: () => unknown[]) => {
    const q = { where: () => q, orderBy: () => q, limit: () => q, innerJoin: () => q,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows()).then(resolve) }
    return q
  }
  return { db: {
    selectDistinct: () => ({ from: () => query(() => [{ symbol: 'BAD' }, { symbol: 'META' }]) }),
    select: () => ({ from: (table: Parameters<typeof getTableName>[0]) => query(() => {
      switch (getTableName(table)) {
        case 'candle_collect_run': return state.last ? [{ startedAt: state.last }] : []
        case 'stock': return [{ symbol: 'BAD', market: 'aktien' }, { symbol: 'META', market: 'aktien' }]
        case 'candle_series': return []
        default: return []
      }
    }) }),
    insert: () => ({ values: () => ({ returning: async () => [{ id: 1 }] }) }),
    update: () => ({ set: () => query(() => []) }),
  } }
})
vi.mock('./candle-store', () => ({
  getStoredCandles: async (symbol: string, _market: string, _interval: string, options: unknown) => {
    state.calls.push({ symbol, options })
    if (symbol === 'BAD' && state.fail) throw new Error('Provider offline; old cache exists')
    return []
  },
  pruneStoredCandles: async () => 0,
}))
import { runCandleCollect } from './candle-collect'

beforeEach(() => { state.last = null; state.fail = true; state.calls = [] })
describe('Unabhängiger Kerzensammler', () => {
  it('zählt Anbieterfehler statt alten Cache als Erfolg und sammelt andere Symbole weiter', async () => {
    const report = await runCandleCollect({})
    expect(report.seriesFailed).toBeGreaterThan(0)
    expect(report.seriesFetched).toBeGreaterThan(0)
    expect(state.calls.some(c => c.symbol === 'META')).toBe(true)
    for (const call of state.calls) expect(call.options).toMatchObject({limit:1,forceRefresh:true,requireFresh:true,automatic:true,provider:'yahoo'})
    state.fail = false
    expect((await runCandleCollect({ force: true })).seriesFailed).toBe(0)
  })
  it('behält die stündliche Fälligkeit trotz häufigem Workflow-Aufruf', async () => {
    state.last = new Date()
    expect(await runCandleCollect({})).toMatchObject({ ran: false, seriesFetched: 0 })
    expect(state.calls).toEqual([])
  })
})
