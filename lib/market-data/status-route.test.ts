import { afterEach, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
const state = vi.hoisted(() => ({ authorize: vi.fn(), read: vi.fn() }))
vi.mock('@/lib/assistant-api', () => ({ requireApiScope: state.authorize, apiResponseError: () => NextResponse.json({error:'unauthorized'},{status:401}) }))
vi.mock('@/lib/market-data/database', () => ({ marketDb: { select: () => ({from: () => ({limit: state.read})}) }, marketDatabaseStatus: () => ({location:'B',version:'1'}) }))
import { GET } from '@/app/api/assistant/v1/market-data/status/route'
const request = () => new NextRequest('http://localhost/api/assistant/v1/market-data/status')
afterEach(() => vi.resetAllMocks())
it('denies unauthorized requests before touching stored market data', async () => {
 state.authorize.mockRejectedValue(new Error('denied'))
 expect((await GET(request())).status).toBe(401);expect(state.read).not.toHaveBeenCalled()
})
it('reads only bounded stored rows and returns no values, identity or credentials', async () => {
 state.read.mockResolvedValue([{present:'private-value'}]);const response=await GET(request())
 expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true,location:'B',version:'1',storedSeriesAvailable:true,storedCandlesAvailable:true})
 expect(state.authorize).toHaveBeenCalledWith(expect.anything(),'trades:read');expect(state.read.mock.calls).toEqual([[1],[1]])
})
it('reports an unavailable market target without leaking database errors or claiming fresh data', async () => {
 state.read.mockRejectedValue(new Error('postgres://credential'))
 const response=await GET(request());expect(response.status).toBe(503);expect(await response.text()).not.toContain('credential')
})
