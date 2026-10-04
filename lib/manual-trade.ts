import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { trade } from '@/lib/db/schema'
import { runDemoFills } from '@/lib/demo-run'
import { withTradeLock } from '@/lib/trade-lock'
import { normalizePortfolioKind } from '@/lib/portfolio-scope'

/** Reconciliation commits independently, even if the following manual input is invalid. */
export async function withManualTrade<T>(
  userId: string, tradeId: number, callback: () => Promise<T>,
  opts: { boundary?: boolean } = {},
): Promise<T> {
  const owned = and(eq(trade.id, tradeId), eq(trade.userId, userId))
  const [before] = await db.select().from(trade).where(owned)
  if (!before) throw new Error('Diesen Trade gibt es nicht.')
  let report = await runDemoFills({ userId, tradeId })
  // Recover in bounded pages. Do not apply a new plan over known unprocessed history.
  for (let page = 0; report.ausstehend.length && page < 20; page++) {
    report = await runDemoFills({ userId, tradeId, refresh: false })
  }
  if (report.ausstehend.length) {
    throw new Error('Frühere Demo-Ausführungen werden noch geprüft. Bitte gleich erneut versuchen.')
  }
  return withTradeLock(userId, tradeId, async (current, depot) => {
    // Reload inside the lock through the existing action. A cron fill between
    // reconciliation and this lock must not be overwritten by stale client input.
    const result = await callback()
    if (opts.boundary !== false && normalizePortfolioKind(depot.kind) === 'demo') {
      const warning = report.error || report.unvollstaendig.length || report.ohneKerzen.length
        ? current.demoIssue?.startsWith('Ungeprüfte Historie:') ? current.demoIssue
          : `Ungeprüfte Historie: ${current.demoIssue ?? report.error ?? 'Kursdaten fehlen vor dem manuellen Eingriff.'}`
        : current.demoIssue
      await db.update(trade).set({ demoBoundaryAt: new Date(), demoIssue: warning }).where(owned)
    }
    return result
  })
}
