import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { alertCheckRun, alertMailDelivery, priceAlert, quoteSnapshot, trade, user, userSettings } from '@/lib/db/schema'
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getCachedQuote } from '@/lib/market-data/quote'
import { refreshQuotesIfStale } from '@/lib/market-data/sync'
import type { Market } from '@/lib/market-data'
import { createAlertSourceResolver } from './alert-symbols'
import { candleReachesLevel, isAlertDirection, isLevelReached, type AlertKind } from '@/lib/alerts'
import { buildAlertMail, resolveRecipient, type AlertMailItem } from '@/lib/notify/alert-mail'
import { readMailConfig, sendMail } from '@/lib/notify/agentmail'
import { acquireAlertLease, checkpointAlertLease, releaseAlertLease } from './alert-lease'
import { boundedRead, usableAlertPrice } from './alert-health'
import { confirmedRegularFeedPause } from './alert-feed-pause'

const BATCH_SIZE = 25
const WORK_MS = 20_000 // reserve five seconds for final DB writes
export interface AlertCheckReport {
  alertsOpen: number; triggered: number; mailsSent: number; mailsFailed: number
  triggeredIds: number[]; quotesMissing: number; quotesPaused: number; complete: boolean; busy: boolean; remaining: boolean; error: string | null
}

async function loadSnapshot(source: { symbol: string; provider: string }) {
  const [row] = await db.select({ price: quoteSnapshot.price, quotedAt: quoteSnapshot.quotedAt,
    fetchedAt: quoteSnapshot.fetchedAt, marketState: quoteSnapshot.marketState,
    quoteType: quoteSnapshot.quoteType, exchange: quoteSnapshot.exchange, lastError: quoteSnapshot.lastError })
    .from(quoteSnapshot).where(and(eq(quoteSnapshot.symbol, source.symbol), eq(quoteSnapshot.provider, source.provider))).limit(1)
  return row ?? null
}

/** Resume a bounded pass. Only a whole successful automatic pass is healthy. */
export async function runAlertCheck(opts: { userId?: string; trigger: 'cron' | 'client'; notify?: boolean }): Promise<AlertCheckReport> {
  const report: AlertCheckReport = { alertsOpen: 0, triggered: 0, mailsSent: 0, mailsFailed: 0, triggeredIds: [], quotesMissing: 0, quotesPaused: 0, complete: false, busy: false, remaining: false, error: null }
  const lease = await acquireAlertLease()
  if (!lease) return { ...report, busy: true, remaining: true }
  const deadline = Date.now() + WORK_MS
  let runId: number | null = null
  let cursor = opts.trigger === 'cron' ? lease.cursor : 0
  let failed = opts.trigger === 'cron' ? lease.cycleFailed : false
  try {
    const [run] = await db.insert(alertCheckRun).values({ trigger: opts.trigger }).returning({ id: alertCheckRun.id })
    runId = run.id
    await boundedRead(refreshQuotesIfStale(), Math.min(4_000, deadline - Date.now())).catch(() => false)
    const open = await db.select().from(priceAlert).where(and(eq(priceAlert.active, true), isNull(priceAlert.triggeredAt),
      gt(priceAlert.id, cursor), opts.userId ? eq(priceAlert.userId, opts.userId) : undefined)).orderBy(asc(priceAlert.id)).limit(BATCH_SIZE)
    report.alertsOpen = open.length
    const resolvers = new Map<string, Awaited<ReturnType<typeof createAlertSourceResolver>>>()
    const snapshots = new Map<string, Awaited<ReturnType<typeof loadSnapshot>>>()
    const candles = new Map<string, Awaited<ReturnType<typeof getCachedQuote>> | null>()
    for (const a of open) {
      if (Date.now() >= deadline - 5_000) { report.remaining = true; break }
      if (!resolvers.has(a.userId)) resolvers.set(a.userId, await boundedRead(createAlertSourceResolver(a.userId), Math.min(2_000, deadline - Date.now())))
      const source = resolvers.get(a.userId)!(a.ticker, a.stockId, a.market)
      if (!source) {
        report.quotesMissing++; failed = true; cursor = a.id
        if (opts.trigger === 'cron') await checkpointAlertLease(lease.token, cursor, failed)
        continue
      }
      const symbol = source.symbol, key = `${source.provider}|${symbol}|${a.market}`
      if (!snapshots.has(key)) snapshots.set(key, await loadSnapshot(source))
      const rawSnapshot = snapshots.get(key)
      const snapshot = rawSnapshot && !rawSnapshot.lastError && usableAlertPrice(rawSnapshot.price, rawSnapshot.quotedAt) ? rawSnapshot : null
      if (!snapshot && rawSnapshot && confirmedRegularFeedPause(rawSnapshot, a.market)) {
        report.quotesPaused++; cursor = a.id
        if (opts.trigger === 'cron') await checkpointAlertLease(lease.token, cursor, failed)
        continue
      }
      if (!candles.has(key)) {
        const c = await boundedRead(getCachedQuote(symbol, a.market as Market), Math.min(2_000, deadline - Date.now())).catch(() => null)
        // Source time is the start of the hourly candle, not the fetch time.
        candles.set(key, c && usableAlertPrice(c.price, c.time, Date.now(), 75 * 60_000)
          && Number.isFinite(c.high) && Number.isFinite(c.low) && c.low > 0 && c.high >= c.low ? c : null)
      }
      const candle = candles.get(key)
      if ((!snapshot && !candle) || !isAlertDirection(a.direction)) { report.quotesMissing++; failed = true }
      else if ((snapshot && isLevelReached(a.direction, a.price, snapshot.price)) || (candle && candleReachesLevel(a.direction, a.price, candle))) {
        const updated = await db.update(priceAlert).set({ triggeredAt: new Date() }).where(and(eq(priceAlert.id, a.id), isNull(priceAlert.triggeredAt), eq(priceAlert.active, true))).returning({ id: priceAlert.id })
        report.triggeredIds.push(...updated.map(row => row.id))
      }
      cursor = a.id
      if (opts.trigger === 'cron') await checkpointAlertLease(lease.token, cursor, failed)
    }
    const [next] = await db.select({ id: priceAlert.id }).from(priceAlert).where(and(eq(priceAlert.active, true), isNull(priceAlert.triggeredAt), gt(priceAlert.id, cursor), opts.userId ? eq(priceAlert.userId, opts.userId) : undefined)).limit(1)
    report.remaining ||= !!next
    if ((opts.notify ?? opts.trigger === 'cron') && Date.now() < deadline - 2_000) {
      const mail = await sendPending(opts.userId, deadline)
      report.mailsSent = mail.sent; report.mailsFailed = mail.failed; report.remaining ||= mail.remaining
    } else if (opts.notify ?? opts.trigger === 'cron') report.remaining = true
    report.triggered = report.triggeredIds.length
    report.complete = !report.remaining && !failed && !report.mailsFailed
    if (failed) report.error = 'Mindestens ein Alarm konnte wegen fehlender, veralteter oder ungültiger Kursdaten nicht vollständig geprüft werden.'
    // An unavailable mailer must not stop future quote checks at the end of the cursor.
    if (opts.trigger === 'cron' && !next) await checkpointAlertLease(lease.token, 0, false)
    if (report.triggered) { try { revalidatePath('/') } catch { /* already persisted */ } }
  } catch {
    report.error = 'Alarmprüfung nicht vollständig abgeschlossen. Gespeicherter Fortschritt wird beim nächsten Lauf fortgesetzt.'
    report.complete = false
  } finally {
    try {
      if (runId != null) await db.update(alertCheckRun).set({ finishedAt: new Date(), alertsOpen: report.alertsOpen,
        triggered: report.triggeredIds.length, mailsSent: report.mailsSent, mailsFailed: report.mailsFailed,
        error: report.error, complete: report.complete, quotesMissing: report.quotesMissing, quotesPaused: report.quotesPaused }).where(eq(alertCheckRun.id, runId))
    } finally { await releaseAlertLease(lease.token) }
  }
  report.triggered = report.triggeredIds.length
  return report
}

/** Fixed payload + stable provider key survive a send/commit timeout. */
async function sendPending(userId: string | undefined, deadline: number): Promise<{ sent: number; failed: number; remaining: boolean }> {
  const config = readMailConfig()
  const pending = await db.select({ id: priceAlert.id, userId: priceAlert.userId, ticker: priceAlert.ticker,
    market: priceAlert.market, stockId: priceAlert.stockId, price: priceAlert.price, direction: priceAlert.direction,
    kind: priceAlert.kind, tradeId: priceAlert.tradeId, entry: trade.entryPrice, stop: trade.stopLoss, target: trade.takeProfit })
    .from(priceAlert).leftJoin(trade, eq(trade.id, priceAlert.tradeId)).where(and(eq(priceAlert.active, true), isNotNull(priceAlert.triggeredAt), isNull(priceAlert.notifiedAt), userId ? eq(priceAlert.userId, userId) : undefined))
    .orderBy(asc(priceAlert.id)).limit(100)
  const deliveries = await db.select().from(alertMailDelivery).where(and(isNull(alertMailDelivery.sentAt), userId ? eq(alertMailDelivery.userId, userId) : undefined)).orderBy(asc(alertMailDelivery.createdAt)).limit(10)
  const queuedOwners = await db.select({ userId: alertMailDelivery.userId }).from(alertMailDelivery).where(isNull(alertMailDelivery.sentAt))
  const pendingUsers = new Set(queuedOwners.map(d => d.userId))
  const byUser = new Map<string, typeof pending>()
  for (const p of pending) {
    if (pendingUsers.has(p.userId)) continue
    const group = byUser.get(p.userId) ?? []; group.push(p); byUser.set(p.userId, group)
  }
  for (const [uid, rows] of byUser) {
    if (Date.now() >= deadline - 2_000) break
    const recipient = await recipientFor(uid)
    if (!recipient) { await markNotified(rows.map(r => r.id)); continue }
    const resolve = await createAlertSourceResolver(uid)
    const snapshots = new Map<string, Awaited<ReturnType<typeof loadSnapshot>>>()
    for (const row of rows) {
      const source = resolve(row.ticker, row.stockId, row.market)
      if (!source) continue
      const key = `${source.provider}|${source.symbol}`
      if (!snapshots.has(key)) snapshots.set(key, await loadSnapshot(source))
    }
    const items: AlertMailItem[] = rows.map(r => {
      const source = resolve(r.ticker, r.stockId, r.market)
      const raw = source ? snapshots.get(`${source.provider}|${source.symbol}`) : null
      const snap = raw && !raw.lastError && usableAlertPrice(raw.price, raw.quotedAt) ? raw : null
      return { ticker: r.ticker, kind: r.kind as AlertKind, direction: isAlertDirection(r.direction) ? r.direction : 'above',
        level: r.price, price: snap?.price ?? null, quotedAtSec: snap?.quotedAt ?? null, tradeId: r.tradeId, entry: r.entry, stop: r.stop, target: r.target }
    })
    const mail = buildAlertMail({ items, baseUrl: appBaseUrl() })
    if (!mail) continue
    const [delivery] = await db.insert(alertMailDelivery).values({ id: randomUUID(), userId: uid, alertIds: rows.map(r => r.id), recipient, subject: mail.subject, body: mail.text }).returning()
    deliveries.push(delivery)
  }
  let sent = 0, failed = 0
  for (const d of deliveries) {
    if (Date.now() >= deadline - 1_000) break
    const recipient = await recipientFor(d.userId)
    if (!recipient) {
      await db.transaction(async tx => {
        await tx.update(alertMailDelivery).set({ sentAt: new Date(), error: 'Versand vom Nutzer ausgeschaltet.' }).where(eq(alertMailDelivery.id, d.id))
        await tx.update(priceAlert).set({ notifiedAt: new Date() }).where(inArray(priceAlert.id, d.alertIds))
      }); continue
    }
    const active = await db.select({ id: priceAlert.id }).from(priceAlert).where(and(inArray(priceAlert.id, d.alertIds), eq(priceAlert.active, true)))
    if (recipient !== d.recipient || active.length !== d.alertIds.length) {
      // Cancel this frozen envelope; still-active alerts will form a fresh envelope next pass.
      await db.update(alertMailDelivery).set({ sentAt: new Date(), error: 'Empfänger oder aktive Alarme geändert; alte Zustellung verworfen.' }).where(eq(alertMailDelivery.id, d.id))
      continue
    }
    if (!config) { failed++; continue }
    // AgentMail send keys expire after 24h. Do not resend ambiguous older deliveries.
    if (Date.now() - d.createdAt.getTime() >= 23 * 3_600_000) {
      await db.update(alertMailDelivery).set({ error: 'Zustellung nach Ablauf des sicheren Wiederholungsfensters manuell prüfen.' }).where(eq(alertMailDelivery.id, d.id))
      failed++; continue
    }
    const result = await sendMail({ to: d.recipient, subject: d.subject, text: d.body }, config, { idempotencyKey: `tracker-alert-${d.id}`, timeoutMs: Math.min(5_000, deadline - Date.now()) })
    if (result.ok) {
      await db.transaction(async tx => {
        await tx.update(alertMailDelivery).set({ sentAt: new Date(), error: null }).where(eq(alertMailDelivery.id, d.id))
        await tx.update(priceAlert).set({ notifiedAt: new Date() }).where(inArray(priceAlert.id, d.alertIds))
      }); sent++
    } else {
      await db.update(alertMailDelivery).set({ error: 'Versand fehlgeschlagen; Wiederholung mit derselben Zustellkennung.' }).where(eq(alertMailDelivery.id, d.id)); failed++
    }
  }
  const [remaining] = await db.select({ id: priceAlert.id }).from(priceAlert).where(and(eq(priceAlert.active, true), isNotNull(priceAlert.triggeredAt), isNull(priceAlert.notifiedAt), userId ? eq(priceAlert.userId, userId) : undefined)).limit(1)
  return { sent, failed, remaining: !!remaining }
}

async function markNotified(ids: number[]) {
  if (ids.length) await db.update(priceAlert).set({ notifiedAt: new Date() }).where(inArray(priceAlert.id, ids))
}
async function recipientFor(userId: string): Promise<string | null> {
  const [row] = await db.select({ notifyEmail: userSettings.notifyEmail, notifyByEmail: userSettings.notifyByEmail, accountEmail: user.email })
    .from(user).leftJoin(userSettings, eq(userSettings.userId, user.id)).where(eq(user.id, userId))
  return !row || row.notifyByEmail === false ? null : resolveRecipient(row.notifyEmail, row.accountEmail)
}
function appBaseUrl() {
  return (process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000')).replace(/\/+$/, '')
}

export async function lastAlertCheck(successOnly = false) {
  const [row] = await db.select().from(alertCheckRun).where(and(eq(alertCheckRun.trigger, 'cron'), successOnly
    ? and(eq(alertCheckRun.complete, true), isNotNull(alertCheckRun.finishedAt), isNull(alertCheckRun.error), eq(alertCheckRun.mailsFailed, 0), eq(alertCheckRun.quotesMissing, 0)) : undefined))
    .orderBy(desc(successOnly ? alertCheckRun.finishedAt : alertCheckRun.startedAt)).limit(1)
  return row ?? null
}
