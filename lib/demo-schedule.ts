import { and, eq, lte } from 'drizzle-orm'
import { db } from '@/lib/db'
import { demoRunState } from '@/lib/db/schema'
import { leererDemoBericht, runDemoFills } from '@/lib/demo-run'

export const DEMO_RUN_INTERVAL_MS = 60 * 60 * 1000
const RETRY_MS = 5 * 60 * 1000
const LEASE_MS = 2 * 60 * 1000

/** An atomic lease prevents overlapping invocations; failed runs retry on the next tick. */
export async function runScheduledDemoFills(force = false) {
  const now = new Date()
  const lease = new Date(now.getTime() + LEASE_MS)
  const [claimed] = await db.insert(demoRunState).values({ id: 'demo', nextRunAt: now, leaseUntil: lease })
    .onConflictDoUpdate({ target: demoRunState.id,
      set: { leaseUntil: lease },
      setWhere: and(lte(demoRunState.leaseUntil, now), force ? undefined : lte(demoRunState.nextRunAt, now)),
    }).returning({ id: demoRunState.id })
  if (!claimed) return { ...leererDemoBericht(), skipped: 'Noch nicht fällig oder bereits in Arbeit.' }
  let report
  try {
    report = await runDemoFills({ maxMs: 40_000 })
  } catch (error) {
    report = { ...leererDemoBericht(), error: error instanceof Error ? error.message : String(error) }
  }
  const retry = report.error != null || report.ausstehend.length > 0 || report.ohneKerzen.length > 0
  await db.update(demoRunState).set({
    nextRunAt: new Date(Date.now() + (retry ? RETRY_MS : DEMO_RUN_INTERVAL_MS)),
    leaseUntil: new Date(),
  }).where(and(eq(demoRunState.id, 'demo'), eq(demoRunState.leaseUntil, lease)))
  return { ...report, skipped: null }
}
