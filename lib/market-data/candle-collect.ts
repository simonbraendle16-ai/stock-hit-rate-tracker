import { AutomaticCandleDeferred, AutomaticCandlePlan } from '@/lib/automatic-candle-plan'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { marketDb } from './database'
import { candleCollectRun, candleSeries, quoteSnapshot } from '@/lib/db/schema'
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
  seriesReused: number
  quotesDeferred: number
  providerFetched: number
  complete: boolean
  outcome: 'complete' | 'deferred' | 'claimed' | 'failed'
}
const empty = (skipped: string): CollectReport => ({ ran: false, skipped,
  seriesReused: 0, quotesDeferred: 0, providerFetched: 0, complete: true, outcome: 'complete',
  seriesDue: 0, seriesFetched: 0, seriesFailed: 0, seriesDeferred: 0, candlesAdded: 0, candlesPruned: 0, error: null })

function intervalsForSymbol(symbol: string) {
  return COLLECTED_INTERVALS.filter(interval => !isSpotGoldTicker(symbol) || ['5min', '1h', '1day'].includes(interval))
}

/** A different existing caller may have claimed main but not its follow-up phases.
 * Claim rejection is not proof that the remaining limited-source demand is zero. */
async function pendingCollectionSeries(instruments: Awaited<ReturnType<typeof activeTradeInstruments>>) {
  const limited = instruments.map(i =>
    i.symbol && isSpotGoldTicker(i.symbol) ? { ...i, symbol: 'XAUUSD' } : i)
  const symbols = [...new Set(limited.map(i => i.symbol).filter((s): s is string => !!s))]
  if (!symbols.length) return 0
  const stored = await marketDb.select({ symbol: candleSeries.symbol, interval: candleSeries.interval, fetchedAt: candleSeries.fetchedAt, lastError: candleSeries.lastError })
    .from(candleSeries).where(inArray(candleSeries.symbol, symbols))
  const fresh = new Set(stored.filter(s => !s.lastError && s.fetchedAt && s.fetchedAt.getTime() >= Math.floor(Date.now() / RUN_INTERVAL_MS) * RUN_INTERVAL_MS)
    .map(s => `${s.symbol}|${s.interval}`))
  const pending = new Set<string>()
  for (const i of limited) if (i.symbol) for (const interval of intervalsForSymbol(i.symbol)) {
    const key = `${i.symbol}|${interval}`
    if (!fresh.has(key)) pending.add(key)
  }
  return pending.size
}

/** A candle can be committed to B while its personal quote write in A fails.
 * A rejected main claim must still expose that missing snapshot to follow-ups. */
async function pendingGoldSnapshots(instruments: Awaited<ReturnType<typeof activeTradeInstruments>>) {
  if (!instruments.some(i => i.symbol && isSpotGoldTicker(i.symbol))) return 0
  const [quote] = await db.select({ fetchedAt: quoteSnapshot.fetchedAt, lastError: quoteSnapshot.lastError })
    .from(quoteSnapshot).where(and(eq(quoteSnapshot.provider, 'twelvedata'), eq(quoteSnapshot.symbol, 'XAUUSD'))).limit(1)
  return quote && !quote.lastError && quote.fetchedAt.getTime() >= Math.floor(Date.now() / RUN_INTERVAL_MS) * RUN_INTERVAL_MS ? 0 : 1
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
  const plan = new AutomaticCandlePlan()
  const phase = options.phase ?? 'main'
  if (!['main', 'limited-1', 'limited-2'].includes(phase)) throw new Error('Ungültige Sammelphase.')
  const instruments = (await activeTradeInstruments()).map(i =>
    i.symbol && isSpotGoldTicker(i.symbol) && i.provider === 'twelvedata'
      ? { ...i, symbol: 'XAUUSD', market: 'rohstoffe' } : i)
  if (!instruments.length) return empty('Keine aktiven Trades.')
  if (!await claimCollectHour(phase)) return {
    ...empty('Noch nicht fällig oder bereits reserviert.'), outcome: 'claimed', complete: false, seriesDeferred: await pendingCollectionSeries(instruments),
    quotesDeferred: await pendingGoldSnapshots(instruments),
  }
  const deadline = Date.now() + (options.timeBudgetMs ?? TIME_BUDGET_MS)
  const [run] = await marketDb.insert(candleCollectRun).values({ trigger: options.trigger ?? 'cron' })
    .returning({ id: candleCollectRun.id })
  const report: CollectReport = { ...empty(''), ran: true, skipped: null }
  try {
    if (Date.now() < deadline) {
      const current = (await activeTradeInstruments()).filter(i => phase === 'main' || i.symbol && isSpotGoldTicker(i.symbol))
      if (current.length) {
        const quotes = await runSymbolSync({ trigger: 'cron', onlyStockIds: current.map(i => i.id), maxResolves: 0, automaticPlan: plan })
        report.quotesDeferred = quotes.quotesDeferred ?? 0
        if (quotes.error || quotes.quotesFailed) report.error = 'Kurs-Snapshots konnten nicht vollständig aktualisiert werden.'
      }
    }
    const symbols = [...new Set(instruments.map(i => i.symbol).filter((s): s is string => !!s))]
    if (!symbols.length) throw new Error('Aktiver Trade ohne bestätigtes Anbietersymbol.')
    const stored = await marketDb.select({ symbol: candleSeries.symbol, interval: candleSeries.interval,
      lastError: candleSeries.lastError, fetchedAt: candleSeries.fetchedAt, candleCount: candleSeries.candleCount }).from(candleSeries)
      .where(inArray(candleSeries.symbol, symbols))
    const state = new Map(stored.map(s => [`${s.symbol}|${s.interval}`, s]))
    const series = new Map<string, {symbol: string; market: Market; provider: ProviderName; interval: Interval; fetchedAt: Date | null}>()
    for (const i of instruments) {
      if (!i.symbol) continue
      for (const interval of intervalsForSymbol(i.symbol)) {
        const key = `${i.symbol}|${interval}`, previous = state.get(key)
        if (!previous?.lastError && previous?.fetchedAt && previous.fetchedAt.getTime() >= Math.floor(Date.now() / RUN_INTERVAL_MS) * RUN_INTERVAL_MS) continue
        series.set(key, { symbol: i.symbol, market: i.market as Market,
          provider: (i.provider ?? 'yahoo') as ProviderName, interval, fetchedAt: previous?.fetchedAt ?? null })
      }
    }
    const ordered = orderByStaleness([...series.values()])
    const limited = ordered.filter(s => s.provider === 'twelvedata')
    // One limited-source request per phase; the same hourly workflow spaces phases
    // by 65 seconds. All calls still use the existing shared reservation budgets.
    const eligibleLimited = plan.limitedUsed ? [] : limited.slice(0, 1)
    // Follow-ups can also recover ordinary rows left by a bounded/interrupted main.
    // Hourly reservations still prevent a second provider fetch for completed rows.
    const selected = ordered.filter(s => s.provider !== 'twelvedata' || eligibleLimited.includes(s))
    report.seriesDue = ordered.length
    report.seriesDeferred = Math.max(0, limited.length - eligibleLimited.length)
    const permitted = selected.slice(0, Math.max(1, options.maxFetches ?? MAX_FETCHES_PER_RUN))
    report.seriesDeferred += selected.length - permitted.length
    for (let index = 0; index < permitted.length; index++) {
      const s = permitted[index]
      if (Date.now() >= deadline) { report.seriesDeferred += permitted.length - index; break }
      // Recheck after closure, preserving demand from another active owner/trade.
      if (!await hasActiveTradeDemand(s.symbol, s.provider) &&
        !(s.symbol === 'XAUUSD' && s.provider === 'twelvedata' && await hasActiveTradeDemand('XAU/USD', s.provider))) continue
      try {
        await getStoredCandles(s.symbol, s.market, s.interval, { limit: 1, forceRefresh: true,
          requireFresh: true, automatic: true, automaticRole: 'archive', provider: s.provider, automaticPlan: plan })
        report.seriesFetched++
        const [after] = await marketDb.select({ candleCount: candleSeries.candleCount }).from(candleSeries)
          .where(and(eq(candleSeries.symbol, s.symbol), eq(candleSeries.interval, s.interval)))
        report.candlesAdded += Math.max(0, (after?.candleCount ?? 0) - (state.get(`${s.symbol}|${s.interval}`)?.candleCount ?? 0))
      } catch (error) {
        if (error instanceof AutomaticCandleDeferred) report.seriesDeferred++
        else report.seriesFailed++
      }
    }
    if (Date.now() >= deadline) report.error = 'Zeitbudget erreicht; verbleibender Bedarf wird beim nächsten Stundenlauf geprüft.'
  } catch (error) {
    report.error = error instanceof Error ? error.message : 'Sammellauf fehlgeschlagen.'
  }
  report.seriesReused = plan.reused
  report.providerFetched = plan.fetched
  report.complete = !report.error && report.seriesFailed === 0 && report.seriesDeferred === 0 && report.quotesDeferred === 0
  report.outcome = report.error || report.seriesFailed ? 'failed' : report.complete ? 'complete' : 'deferred'
  await marketDb.update(candleCollectRun).set({ finishedAt: new Date(), seriesDue: report.seriesDue,
    seriesFetched: report.seriesFetched, seriesFailed: report.seriesFailed, candlesAdded: report.candlesAdded,
    error: report.error }).where(eq(candleCollectRun.id, run.id))
  return report
}
