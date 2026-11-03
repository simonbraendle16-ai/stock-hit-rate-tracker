import { afterEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
const state = vi.hoisted(() => ({ collect: vi.fn() }))
vi.mock('./candle-collect', () => ({ runCandleCollect: state.collect }))
import { GET } from '@/app/api/cron/collect-candles/route'
import { GET as compatibilityGET } from '@/app/api/cron/sync-symbols/route'
const request = (token = 'isolated') => new NextRequest('http://localhost/api/cron/collect-candles?force=1', { headers: { authorization: `Bearer ${token}` } })
afterEach(() => { vi.unstubAllEnvs(); state.collect.mockReset() })
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
it('prepares an hourly server schedule outside executable workflows, without broker/demo/alert calls', () => {
  const template = readFileSync(new URL('../../.github/workflow-templates/active-trade-market-data.yml.disabled', import.meta.url), 'utf8')
  expect(template).toContain("cron: '17 * * * *'")
  expect(template).toContain('/api/cron/collect-candles')
  expect(template).not.toMatch(/demo-fills|check-alerts|broker|schedule-task/i)
})
