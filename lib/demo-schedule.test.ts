import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
const fake = vi.hoisted(() => ({ claimed: true, claim: vi.fn(), update: vi.fn(), where: vi.fn(), run: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: {
  insert: () => ({ values: (values: object) => ({ onConflictDoUpdate: (options: object) => {
    fake.claim(values, options)
    return { returning: async () => fake.claimed ? [{ id: 'demo' }] : [] }
  } }) }),
  update: () => ({ set: (values: object) => { fake.update(values); return { where: async (predicate: unknown) => fake.where(predicate) } } }),
} }))
vi.mock('@/lib/demo-run', () => ({
  runDemoFills: (...args: unknown[]) => fake.run(...args),
  leererDemoBericht: () => ({ ran: false, error: null, ausstehend: [], unvollstaendig: [], ohneKerzen: [] }),
}))
import { runScheduledDemoFills, DEMO_RUN_INTERVAL_MS } from './demo-schedule'
const now = new Date('2026-10-02T12:00:00Z')
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now)
  fake.claimed = true; fake.claim.mockClear(); fake.update.mockClear(); fake.where.mockClear()
  fake.run.mockReset().mockResolvedValue({ ran: true, error: null, ausstehend: [], unvollstaendig: [], ohneKerzen: [] })
})
afterEach(() => vi.useRealTimers())
describe('Stündlicher Demo-Takt', () => {
  it('überspringt nicht fällige oder schon laufende Aufrufe', async () => {
    fake.claimed = false
    expect((await runScheduledDemoFills()).ran).toBe(false)
    expect(fake.run).not.toHaveBeenCalled()
  })
  it('plant nach erfolgreicher Prüfung den nächsten Stundenlauf', async () => {
    await runScheduledDemoFills()
    expect(fake.run).toHaveBeenCalledWith({ maxMs: 40_000 })
    expect(fake.update).toHaveBeenCalledWith({ nextRunAt: new Date(now.getTime() + DEMO_RUN_INTERVAL_MS), leaseUntil: now })
  })
  it.each([{ error: 'offline', ausstehend: [], ohneKerzen: [] },
    { error: null, ausstehend: [1], ohneKerzen: [] },
    { error: null, ausstehend: [], ohneKerzen: [1] }])('wiederholt Fehler und verbleibende Arbeit beim nächsten Tick', async (patch) => {
    fake.run.mockResolvedValue({ ran: true, unvollstaendig: [], ...patch })
    await runScheduledDemoFills()
    expect(fake.update.mock.calls[0][0].nextRunAt).toEqual(new Date(now.getTime() + 5 * 60 * 1000))
  })
  it('schützt Claim und Freigabe mit atomaren Bedingungen und dem eigenen Lease-Zeitpunkt', async () => {
    await runScheduledDemoFills()
    const dialect = new PgDialect()
    const conditions = dialect.sqlToQuery(fake.claim.mock.calls[0][1].setWhere)
    expect(conditions.sql).toContain('"leaseUntil" <=')
    expect(conditions.sql).toContain('"nextRunAt" <=')
    expect(dialect.sqlToQuery(fake.where.mock.calls[0][0]).params)
      .toEqual(['demo', new Date(now.getTime() + 2 * 60 * 1000).toISOString()])
  })
})
