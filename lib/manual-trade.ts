import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { trade } from '@/lib/db/schema'
import { runDemoFills } from '@/lib/demo-run'
import { withTradeLock } from '@/lib/trade-lock'
import { normalizePortfolioKind } from '@/lib/portfolio-scope'
import { TradeInputError } from '@/lib/trade-input-error'

// Cursor/diagnostic writes bump the row version too, but do not change its plan.
function substantiveState(row: typeof trade.$inferSelect) {
  const { version, demoCheckedAt, demoIssue, ...state } = row
  return JSON.stringify(state)
}

/** Reconciliation commits independently, even if the following manual input is invalid. */
export async function withManualTrade<T>(
  userId: string, tradeId: number, callback: (currentVersion?: number) => Promise<T>,
  opts: { boundary?: boolean; expectedVersion?: number } = {},
): Promise<T> {
  const owned = and(eq(trade.id, tradeId), eq(trade.userId, userId))
  const [before] = await db.select().from(trade).where(owned)
  if (!before) throw new TradeInputError('Diesen Trade gibt es nicht.')
  if (opts.expectedVersion !== undefined && before.version !== opts.expectedVersion) {
    throw new TradeInputError('Trade wurde inzwischen geändert. Bitte erneut laden; deine Eingaben bleiben im Dialog erhalten.')
  }
  const beforeState = substantiveState(before)
  let report = await runDemoFills({ userId, tradeId })
  let fills = report.zeilen?.length ?? 0
  // Recover in bounded pages. Do not apply a new plan over known unprocessed history.
  for (let page = 0; report.ausstehend.length && page < 20; page++) {
    report = await runDemoFills({ userId, tradeId, refresh: false })
    fills += report.zeilen?.length ?? 0
  }
  if (report.ausstehend.length) {
    throw new TradeInputError('Frühere Demo-Ausführungen werden noch geprüft. Bitte gleich erneut versuchen.')
  }
  return withTradeLock(userId, tradeId, async (current, depot) => {
    // Reload inside the lock through the existing action. A cron fill between
    // reconciliation and this lock must not be overwritten by stale client input.
    if (opts.expectedVersion !== undefined &&
        (fills > 0 || substantiveState(current) !== beforeState)) {
      throw new TradeInputError('Trade wurde inzwischen geändert oder automatisch ausgeführt. Bitte erneut laden; deine Eingaben bleiben im Dialog erhalten.')
    }
    const result = await callback(current.version)
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
