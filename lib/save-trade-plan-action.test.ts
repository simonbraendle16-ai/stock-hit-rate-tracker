import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TradeInputError } from './trade-input-error'
const fake = vi.hoisted(() => ({ update: vi.fn(), manual: vi.fn() }))
vi.mock('@/lib/trade-position-service', () => ({ updateTradePlanForUser: fake.update }))
vi.mock('@/lib/manual-trade', () => ({ withManualTrade: (...args: unknown[]) => fake.manual(...args) }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: async () => ({ user: { id: 'isolated' } }) } } }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
import { saveTradePlan } from '@/app/actions/trades'

beforeEach(() => {
  vi.resetAllMocks()
  fake.manual.mockImplementation(async (_user, _id, callback) => callback(8))
})
describe('Plan editor action boundary', () => {
  it('requires a current expected version before reconciling or saving', async () => {
    expect(await saveTradePlan(1, {})).toMatchObject({ ok: false, message: expect.stringContaining('Trade-Version') })
    expect(fake.manual).not.toHaveBeenCalled()
  })
  it('passes the expected version to reconciliation and uses its guarded current version', async () => {
    expect(await saveTradePlan(1, { notes: 'isolated' }, false, undefined, 7)).toEqual({ ok: true })
    expect(fake.manual).toHaveBeenCalledWith('isolated', 1, expect.any(Function), { expectedVersion: 7 })
    expect(fake.update).toHaveBeenCalledWith('isolated', 1, { notes: 'isolated' }, false, undefined, 8)
  })
  it('returns deliberate validation failures without throwing across the server boundary', async () => {
    fake.update.mockRejectedValue(new TradeInputError('Währungsangaben fehlen.'))
    const result = await saveTradePlan(1, {}, false, undefined, 7)
    expect(JSON.parse(JSON.stringify(result))).toEqual({ ok: false, message: 'Währungsangaben fehlen.' })
  })
  it('returns conflicts before saving and hides unexpected database details', async () => {
    fake.manual.mockRejectedValueOnce(new TradeInputError('Trade wurde inzwischen geändert.'))
    expect(await saveTradePlan(1, {}, false, undefined, 7)).toMatchObject({ ok: false, message: 'Trade wurde inzwischen geändert.' })
    expect(fake.update).not.toHaveBeenCalled()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    fake.manual.mockRejectedValueOnce(new Error('SQL password=private'))
    const result = await saveTradePlan(1, {}, false, undefined, 7)
    expect(result).toMatchObject({ ok: false, reference: expect.any(String) })
    expect(JSON.stringify([result, log.mock.calls])).not.toContain('password=private')
    log.mockRestore()
  })
})
