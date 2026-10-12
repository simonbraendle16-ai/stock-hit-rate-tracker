import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TradeInputError } from './trade-input-error'
import { createTrade } from '../app/actions/trades'

const mocks = vi.hoisted(() => ({ create: vi.fn(), revalidate: vi.fn(), session: vi.fn() }))
vi.mock('@/lib/create-trade-service', () => ({ createTradeForUser: mocks.create }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.session } } }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))

const input = { ticker: 'TEST', direction: 'long' as const, entryPrice: 100, stopLoss: 90 }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'isolated' } })
})

describe('trade creation action boundary', () => {
  it('returns an expected validation message as serializable data', async () => {
    mocks.create.mockRejectedValue(new TradeInputError('Positionsgröße und Kapitaleinsatz widersprechen sich.'))
    const result = await createTrade(input)
    expect(result).toEqual({ ok: false, message: 'Positionsgröße und Kapitaleinsatz widersprechen sich.' })
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it('hides database details and logs only a correlation reference and error type', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const privateMessage = 'SQL password=private connection=private'
    mocks.create.mockRejectedValue(new Error(privateMessage))
    const result = await createTrade(input)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.reference).toBeTruthy()
    expect(result.message).toContain(result.reference)
    expect(JSON.stringify([result, log.mock.calls])).not.toContain(privateMessage)
    expect(log).toHaveBeenCalledWith('trade.create.failed', expect.objectContaining({ reference: result.reference }))
    log.mockRestore()
  })
  it('still reports persistence success if later cache refresh fails', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.create.mockResolvedValue({ id: 1, deckungsHinweis: null, planReady: true })
    mocks.revalidate.mockImplementation(() => { throw new Error('cache unavailable') })
    expect(await createTrade(input)).toEqual({ ok: true, id: 1, deckungsHinweis: null, planReady: true })
    expect(mocks.create).toHaveBeenCalledOnce()
    log.mockRestore()
  })
})
