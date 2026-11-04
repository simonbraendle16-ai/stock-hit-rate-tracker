import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { marketDb } from './database'
import { candleCollectRun, candleSeries } from '@/lib/db/schema'
import { intervalsForStufe, type Interval, type Market } from './types'
import { getStoredCandles } from './candle-store'
import { orderByStaleness } from './candle-merge'
import { isSpotGoldTicker } from './spot-gold'
import type { ProviderName } from './index'
import { activeTradeInstruments, hasActiveTradeDemand } from './active-trade-demand'
import { runSymbolSync } from './sync'

export const MAX_FETCHES_PER_RUN = 150
export const TIME_BUDGET_MS = 45_000
export const RUN_INTERVAL_MS = 3_600_000
export const COLLECTED_INTERVALS = intervalsForStufe('A')
export type CollectPhase = 'main' | 'limited-1' | 'limited-2'
export interface CollectReport {
  ran: boolean; skipped: string | null; seriesDue: number; seriesFetched: number
  seriesFailed: number; candlesAdded: number; candlesPruned: number; error: string | null
  seriesDeferred: number
}
const empty = (skipped: string): CollectReport => ({ ran: false, skipped,
  seriesDue: 0, seriesFetched: 0, seriesFailed: 0, seriesDeferred: 0, candlesAdded: 0, candlesPruned: 0, error: null })

function intervalsForSymbol(symbol: string) {
  return COLLECTED_INTERVALS.filter(interval => !isSpotGoldTicker(symbol) || ['5min', '1h', '1day'].includes(interval))
}

/** A different existing caller may have claimed main but not its follow-up phases.
 * Claim rejection is not proof that the remaining limited-source demand is zero. */
async function pendingLimitedSeries(instruments: Awaited<ReturnType<typeof activeTradeInstruments>>) {
  const limited = instruments.filter(i => i.provider === 'twelvedata')
  const symbols = [...new Set(limited.map(i => i.symbol).filter((s): s is string => !!s))]
  if (!symbols.length) return 0
  const stored = await marketDb.select({ symbol: candleSeries.symbol, interval: candleSeries.interval, fetchedAt: candleSeries.fetchedAt })
    .from(candleSeries).where(inArray(candleSeries.symbol, symbols))
  const fresh = new Set(stored.filter(s => s.fetchedAt && s.fetchedAt.getTime() >= Math.floor(Date.now() / RUN_INTERVAL_MS) * RUN_INTERVAL_MS)
    .map(s => `${s.symbol}|${s.interval}`))
  const pending = new Set<string>()
  for (const i of limited) if (i.symbol) for (const interval of intervalsForSymbol(i.symbol)) {
    const key = `${i.symbol}|${interval}`
    if (!fresh.has(key)) pending.add(key)
  }
  return pending.size
}

export async function lastCollectRun(): Promise<Date | null> {
  const [row] = await marketDb.select({ startedAt: candleCollectRun.startedAt }).from(candleCollectRun)
    .orderBy(desc(candleCollectRun.startedAt)).limit(1)
  return row?.startedAt ?? null
}

/** Atomic persisted gate across processes. No browser/activity dependency.
 * Even manual/force calls cannot reopen the hourly automatic budget.
 * UTC hour slots avoid skipping a full hour when a scheduler runs a few seconds early.
 * Claims survive interrupted workers; the next hour can recover safely. */
export async function claimCollectHour(phase: CollectPhase = 'main'): Promise<boolean> {
  const job = phase === 'main' ? 'active-trade-market-data' : `active-trade-market-data:${phase}`
  const result = await db.execute(sql`INSERT INTO background_job_gate(job,"ranAt")
    VALUES(${job},date_trunc('hour',now())) ON CONFLICT(job) DO UPDATE SET "ranAt"=date_trunc('hour',now())
    WHERE background_job_gate."ranAt"<date_trunc('hour',now()) RETURNING job`)
  return result.rows.length > 0
}

/** Only active trades create demand. Historical rows are never pruned here. */
export async function runCandleCollect(options: {
  trigger?: 'cron' | 'manual'; force?: boolean; maxFetches?: number; timeBudgetMs?: number
  phase?: CollectPhase
}): Promise<CollectReport> {
  const phase = options.phase ?? 'main'
  if (!['main', 'limited-1', 'limited-2'].includes(phase)) throw new Error('Ungültige Sammelphase.')
  const instruments = await activeTradeInstruments()
  if (!instruments.length) return empty('Keine aktiven Trades.')
  if (!await claimCollectHour(phase)) return {
    ...empty('Noch nicht fällig oder bereits reserviert.'), seriesDeferred: await pendingLimitedSeries(instruments),
  }
  const deadline = Date.now() + (options.timeBudgetMs ?? TIME_BUDGET_MS)
  const [run] = await marketDb.insert(candleCollectRun).values({ trigger: options.trigger ?? 'cron' })
    .returning({ id: candleCollectRun.id })
  const report: CollectReport = { ...empty(''), ran: true, skipped: null }
  try {
    if (phase === 'main' && Date.now() < deadline) {
      const current = await activeTradeInstruments()
      if (current.length) {
        const quotes = await runSymbolSync({ trigger: 'cron', onlyStockIds: current.map(i => i.id), maxResolves: 0 })
        if (quotes.error || quotes.quotesFailed) report.error = 'Kurs-Snapshots konnten nicht vollständig aktualisiert werden.'
      }
    }
    const symbols = [...new Set(instruments.map(i => i.symbol).filter((s): s is string => !!s))]
    if (!symbols.length) throw new Error('Aktiver Trade ohne bestätigtes Anbietersymbol.')
    const stored = await marketDb.select({ symbol: candleSeries.symbol, interval: candleSeries.interval,
      fetchedAt: candleSeries.fetchedAt, candleCount: candleSeries.candleCount }).from(candleSeries)
      .where(inArray(candleSeries.symbol, symbols))
    const state = new Map(stored.map(s => [`${s.symbol}|${s.interval}`, s]))
    const series = new Map<string, {symbol: string; market: Market; provider: ProviderName; interval: Interval; fetchedAt: Date | null}>()
    for (const i of instruments) {
      if (!i.symbol) continue
      for (const interval of intervalsForSymbol(i.symbol)) {
        const key = `${i.symbol}|${interval}`, previous = state.get(key)
        if (previous?.fetchedAt && previous.fetchedAt.getTime() >= Math.floor(Date.now() / RUN_INTERVAL_MS) * RUN_INTERVAL_MS) continue
        series.set(key, { symbol: i.symbol, market: i.market as Market,
          provider: (i.provider ?? 'yahoo') as ProviderName, interval, fetchedAt: previous?.fetchedAt ?? null })
      }
    }
    const ordered = orderByStaleness([...series.values()])
    const limited = ordered.filter(s => s.provider === 'twelvedata')
    // One limited-source request per phase; the same hourly workflow spaces phases
    // by 65 seconds. All calls still use the existing shared reservation budgets.
    const selected = phase === 'main'
      ? ordered.filter(s => s.provider !== 'twelvedata' || s === limited[0])
      : limited.slice(0, 1)
    report.seriesDue = phase === 'main' ? ordered.length : limited.length
    report.seriesDeferred = Math.max(0, limited.length - 1)
    for (const s of selected.slice(0, Math.max(1, options.maxFetches ?? MAX_FETCHES_PER_RUN))) {
      if (Date.now() >= deadline) break
      // Recheck after closure, preserving demand from another active owner/trade.
      if (!await hasActiveTradeDemand(s.symbol, s.provider)) continue
      try {
        await getStoredCandles(s.symbol, s.market, s.interval, { limit: 1, forceRefresh: true,
          requireFresh: true, automatic: true, automaticRole: 'archive', provider: s.provider })
        report.seriesFetched++
        const [after] = await marketDb.select({ candleCount: candleSeries.candleCount }).from(candleSeries)
          .where(and(eq(candleSeries.symbol, s.symbol), eq(candleSeries.interval, s.interval)))
        report.candlesAdded += Math.max(0, (after?.candleCount ?? 0) - (state.get(`${s.symbol}|${s.interval}`)?.candleCount ?? 0))
      } catch { report.seriesFailed++ }
    }
    if (Date.now() >= deadline) report.error = 'Zeitbudget erreicht; verbleibender Bedarf wird beim nächsten Stundenlauf geprüft.'
  } catch (error) {
    report.error = error instanceof Error ? error.message : 'Sammellauf fehlgeschlagen.'
  }
  await marketDb.update(candleCollectRun).set({ finishedAt: new Date(), seriesDue: report.seriesDue,
    seriesFetched: report.seriesFetched, seriesFailed: report.seriesFailed, candlesAdded: report.candlesAdded,
    error: report.error }).where(eq(candleCollectRun.id, run.id))
  return report
}
