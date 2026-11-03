import { afterEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ effect: null as null | (() => (() => void)), sets: [] as unknown[] }))
vi.mock('react', () => ({ useState: (initial: unknown) => [initial, (v: unknown) => state.sets.push(v)],
  useEffect: (fn: () => () => void) => { state.effect = fn } }))
import { useSparklines } from '@/components/watchlist/use-sparklines'
let cleanup: (() => void) | undefined
afterEach(() => { cleanup?.(); vi.useRealTimers(); vi.unstubAllGlobals(); state.sets = [] })
it('loads once on page demand, never polls/retries pending quotes, and cancels on unmount', async () => {
  vi.useFakeTimers()
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sparks: { 1: { status: 'pending' } } }) })
  vi.stubGlobal('fetch', fetch)
  useSparklines(); cleanup = state.effect!()
  await vi.advanceTimersByTimeAsync(120 * 60_000)
  expect(fetch.mock.calls.map(c => c[0])).toEqual(['/api/sparklines', '/api/sparklines?closes=1'])
  expect(vi.getTimerCount()).toBe(0)
  cleanup(); expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
})
it('an unavailable source does not create an automatic retry loop', async () => {
  vi.useFakeTimers(); const fetch = vi.fn().mockRejectedValue(new Error('isolated offline'))
  vi.stubGlobal('fetch', fetch)
  useSparklines(); cleanup = state.effect!()
  await vi.advanceTimersByTimeAsync(120 * 60_000)
  expect(fetch).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0)
})
