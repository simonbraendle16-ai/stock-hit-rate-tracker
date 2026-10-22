import { describe, it, expect, vi } from 'vitest'

const calls = vi.hoisted(() => ({ auth: vi.fn(), db: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: calls.auth } } }))
vi.mock('@/lib/db', () => ({ db: new Proxy({}, { get() { calls.db(); throw new Error('Unexpected database access') } }) }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { getTrainingStats, startTrainingSession, deleteTrainingAnnotation } from '@/app/actions/training'
import { listSessionTrades, endTrainingSession } from '@/app/actions/training-trades'
import { GET } from '@/app/api/candles/route'
import { NextRequest } from 'next/server'

describe('retired trainer cannot consume database/auth reads or mutate historical data', () => {
  it('blocks trainer reads and writes at the shared server guard before authentication', async () => {
    const operations = [
      () => getTrainingStats(), () => startTrainingSession({} as any),
      () => deleteTrainingAnnotation(1), () => listSessionTrades(1),
      () => endTrainingSession(1),
    ]
    for (const operation of operations) await expect(operation()).rejects.toThrow('Trainer ist deaktiviert')
    expect(calls.auth).not.toHaveBeenCalled()
    expect(calls.db).not.toHaveBeenCalled()
  })
  it('rejects direct trainer candle requests, including malformed IDs, without querying', async () => {
    for (const id of ['1', '', 'invalid']) {
      const result = await GET(new NextRequest(`http://localhost/api/candles?trainingSessionId=${id}`))
      expect(result.status).toBe(410)
      expect((await result.json()).code).toBe('trainer_disabled')
    }
    expect(calls.auth).not.toHaveBeenCalled()
    expect(calls.db).not.toHaveBeenCalled()
  })
  it('keeps ordinary instrument candle requests on their existing authenticated path', async () => {
    calls.auth.mockResolvedValueOnce(null)
    const result = await GET(new NextRequest('http://localhost/api/candles?symbol=AAPL'))
    expect(result.status).toBe(401)
    expect(calls.auth).toHaveBeenCalledOnce()
    expect(calls.db).not.toHaveBeenCalled()
  })
})
