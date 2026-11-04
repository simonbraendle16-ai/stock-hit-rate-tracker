import { afterEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
const state = vi.hoisted(() => ({ collect: vi.fn() }))
vi.mock('./candle-collect', () => ({ runCandleCollect: state.collect }))
import { GET } from '@/app/api/cron/collect-candles/route'
import { GET as compatibilityGET } from '@/app/api/cron/sync-symbols/route'
const request = (token = 'isolated') => new NextRequest('http://localhost/api/cron/collect-candles?force=1', { headers: { authorization: `Bearer ${token}` } })
afterEach(() => { vi.unstubAllEnvs(); state.collect.mockReset() })
it('accepts a scoped key only at the collector, not at the compatibility entry', async () => {
  vi.stubEnv('CRON_SECRET', 'isolated')
  vi.stubEnv('MARKET_SCHEDULER_KEY', 'synthetic-scoped')
  state.collect.mockResolvedValue({ ran: false, error: null, seriesFailed: 0, seriesDeferred: 0 })
  const scoped = (path: string) => new NextRequest(`http://localhost${path}`, { headers: { authorization: 'Bearer synthetic-scoped' } })
  expect((await GET(scoped('/api/cron/collect-candles'))).status).toBe(200)
  expect((await compatibilityGET(scoped('/api/cron/sync-symbols'))).status).toBe(401)
  expect(state.collect).toHaveBeenCalledTimes(1)
})
it('allows only the fixed authenticated limited-source phases', async () => {
  vi.stubEnv('CRON_SECRET', 'isolated')
  const phaseRequest = (phase: string) => new NextRequest(`http://localhost/api/cron/collect-candles?phase=${phase}`, { headers: { authorization: 'Bearer isolated' } })
  expect((await GET(phaseRequest('anything'))).status).toBe(400)
  expect(state.collect).not.toHaveBeenCalled()
  state.collect.mockResolvedValue({ ran: true, error: null, seriesFailed: 0, seriesDeferred: 1 })
  expect((await GET(phaseRequest('limited-1'))).status).toBe(200)
  expect(state.collect).toHaveBeenCalledExactlyOnceWith({ trigger: 'cron', phase: 'limited-1' })
})
it('authenticates both entries, ignores force bypass, and exposes partial/provider errors', async () => {
  vi.stubEnv('CRON_SECRET', 'isolated')
  expect((await GET(request('wrong'))).status).toBe(401)
  expect(state.collect).not.toHaveBeenCalled()
  state.collect.mockResolvedValue({ ran: false, error: null, seriesFailed: 0 })
  expect((await GET(request())).status).toBe(200)
  expect(state.collect).toHaveBeenCalledExactlyOnceWith({ trigger: 'cron' })
  state.collect.mockResolvedValue({ ran: true, error: null, seriesFailed: 1 })
  const degraded = await compatibilityGET(request())
  expect(degraded.status).toBe(503); expect(await degraded.json()).toMatchObject({ ok: false, seriesFailed: 1 })
  state.collect.mockRejectedValue(new Error('private database detail'))
  const failed = await GET(request())
  expect(failed.status).toBe(503); expect(JSON.stringify(await failed.json())).not.toContain('private')
})
it('distinguishes deferred, claimed, completed and actual failed work in the HTTP report', async () => {
  vi.stubEnv('CRON_SECRET','isolated')
  for(const outcome of ['deferred','claimed','complete','failed']) {
    const failed=outcome==='failed',complete=outcome==='complete'
    state.collect.mockResolvedValue({ran:outcome!=='claimed',skipped:null,error:failed?'synthetic provider outage':null,
      seriesFailed:failed?1:0,seriesDeferred:complete?0:2,quotesDeferred:outcome==='deferred'?1:0,
      seriesFetched:0,seriesReused:1,providerFetched:1,complete,outcome})
    const response=await GET(request())
    expect(response.status).toBe(failed?503:200)
    expect(await response.json()).toMatchObject({ok:!failed,complete,outcome,providerFetched:1,seriesReused:1})
  }
})
it('prepares an hourly server schedule outside executable workflows, without broker/demo/alert calls', () => {
  const template = readFileSync(new URL('../../.github/workflow-templates/active-trade-market-data.yml.disabled', import.meta.url), 'utf8')
  expect(template).toContain("cron: '17 * * * *'")
  expect(template).toContain('/api/cron/collect-candles')
  expect(template).not.toMatch(/demo-fills|check-alerts|broker|schedule-task/i)
})
