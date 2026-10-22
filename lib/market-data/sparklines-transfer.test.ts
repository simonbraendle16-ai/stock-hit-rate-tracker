import { beforeEach, describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ closes: vi.fn(), refresh: vi.fn(), rows: [] as any[] }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: async () => ({ user: { id: 'synthetic' } }) } } }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/db', () => ({ db: { select: () => ({ from: () => ({ leftJoin: () => ({ where: async () => state.rows }) }) }) } }))
vi.mock('./cached', () => ({ getCachedCloses: state.closes }))
vi.mock('./sync', () => ({ refreshQuotesIfStale: state.refresh }))
import { GET } from '@/app/api/sparklines/route'

beforeEach(() => {
  state.closes.mockReset().mockResolvedValue([1, 2, 3]); state.refresh.mockReset()
  const row = { market: 'aktien', providerSymbol: 'AAPL', status: 'ok', price: 3, changePct: 2, currency: 'USD', quotedAt: 1, fetchedAt: new Date('2026-10-22T00:00:00Z') }
  state.rows = [{ ...row, id: 1 }, { ...row, id: 2 }, { ...row, id: 3, status: 'unresolved', note: 'synthetic' }, { ...row, id: 4, price: null }]
})
describe('watchlist sparkline transfer', () => {
  it('requests exactly 90 closes once per confirmed series, retaining every watchlist entry', async () => {
    const data = await (await GET(new Request('http://localhost/api/sparklines?closes=1'))).json()
    expect(state.closes).toHaveBeenCalledExactlyOnceWith('AAPL', 'aktien', '1day', 90)
    expect(state.refresh).toHaveBeenCalledOnce()
    expect(data.sparks[1].closes).toEqual([1, 2, 3])
    expect(data.sparks[2]).toEqual(data.sparks[1])
    expect(data.sparks[3]).toEqual({ status: 'unresolved', note: 'synthetic' })
    expect(data.sparks[4]).toEqual({ status: 'pending' })
  })
  it('quote-only requests do not fetch candles or change their refresh cadence', async () => {
    const data = await (await GET(new Request('http://localhost/api/sparklines'))).json()
    expect(data.sparks[1]).toMatchObject({ status: 'ok', last: 3, closes: [] })
    expect(state.closes).not.toHaveBeenCalled(); expect(state.refresh).not.toHaveBeenCalled()
  })
  it('missing/error series do not suppress valid quotes', async () => {
    state.closes.mockRejectedValueOnce(new Error('synthetic source unavailable'))
    const data = await (await GET(new Request('http://localhost/api/sparklines?closes=1'))).json()
    expect(data.sparks[1]).toMatchObject({ status: 'ok', last: 3, closes: [] })
    expect(data.sparks[2]).toEqual(data.sparks[1])
  })
})
