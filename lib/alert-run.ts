// Etappe 14, Abschnitt 1: der Alarm-Prüflauf — sitzungsfrei.
//
// WARUM DIESE DATEI EXISTIERT
// `checkAlerts()` in `app/actions/alerts.ts` hing an der angemeldeten Sitzung und
// lief deshalb nur, solange ein Browsertab offen war. Ein Kurs-Alert, den niemand
// prüft, ist kein Alert. Hier steht derselbe Ablauf ohne Sitzung, damit ihn eine
// Cron-Route für ALLE Nutzer anstoßen kann; die Server Action ruft ihn mit ihrer
// `userId` auf. Cron und Browser treffen dadurch nachweislich dieselbe
// Entscheidung — es gibt nur noch eine Stelle, die auslöst.
//
// Die Rechenlogik bleibt, wo sie war: `lib/alerts.ts` (rein, getestet). Diese
// Datei lädt Zeilen, holt Kurse und schreibt Ergebnisse.
//
// ZWEI KURSQUELLEN, mit Absicht:
//   1. `quote_snapshot` — ein Batch-Abruf für alle Symbole, bis zu zwei Minuten
//      alt (`refreshQuotesIfStale`). Frisch, aber nur ein Schlusskurs.
//   2. Die letzte Kerze über `getCachedQuote` — bis zu 15 Minuten alt, dafür mit
//      High/Low, das eine kurze Berührung INNERHALB der Kerze erfasst.
// Ausgelöst wird, wenn EINE der beiden das Level erreicht sieht. Nur Quelle 2
// (der bisherige Stand) übersähe frische Bewegungen, nur Quelle 1 übersähe
// Berührungen zwischen zwei Abrufen.

import { db } from '@/lib/db'
import {
  alertCheckRun,
  priceAlert,
  quoteSnapshot,
  trade,
  user,
  userSettings,
} from '@/lib/db/schema'
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getCachedQuote } from '@/lib/market-data/quote'
import { refreshQuotesIfStale } from '@/lib/market-data/sync'
import { MarketDataError, type Market } from '@/lib/market-data'
import { createSymbolResolver } from '@/lib/market-data/lookup'
import {
  candleReachesLevel,
  isAlertDirection,
  isLevelReached,
  type AlertKind,
} from '@/lib/alerts'
import { buildAlertMail, resolveRecipient, type AlertMailItem } from '@/lib/notify/alert-mail'
import { readMailConfig, sendMail } from '@/lib/notify/agentmail'

type AlertRow = typeof priceAlert.$inferSelect

export interface AlertCheckReport {
  alertsOpen: number
  triggered: number
  mailsSent: number
  mailsFailed: number
  /** Ausgelöste Alert-IDs — die Server Action macht daraus die Client-Benachrichtigung. */
  triggeredIds: number[]
  error: string | null
}

/** Kurs holen, aber niemals daran scheitern — `null`, wenn er gerade nicht abrufbar ist. */
async function tryQuote(symbol: string, market: Market) {
  try {
    return await getCachedQuote(symbol, market)
  } catch (err) {
    if (err instanceof MarketDataError) return null
    return null
  }
}

/** Frische Schlusskurse aus dem Speicher — ein Lesevorgang für alle Symbole. */
async function loadSnapshots(symbols: string[]): Promise<Map<string, { price: number; quotedAt: number }>> {
  const out = new Map<string, { price: number; quotedAt: number }>()
  if (symbols.length === 0) return out
  const rows = await db
    .select({
      symbol: quoteSnapshot.symbol,
      price: quoteSnapshot.price,
      quotedAt: quoteSnapshot.quotedAt,
    })
    .from(quoteSnapshot)
    .where(inArray(quoteSnapshot.symbol, symbols))
  for (const r of rows) {
    // Mehrere Anbieter je Symbol möglich — der erste Treffer genügt, die Kurse
    // desselben Papiers unterscheiden sich nicht relevant.
    if (!out.has(r.symbol)) out.set(r.symbol, { price: r.price, quotedAt: r.quotedAt })
  }
  return out
}

/**
 * Ein Prüflauf.
 *
 * @param opts.userId  Nur die Alerts dieses Nutzers prüfen (Server Action).
 *                     Fehlt er, werden alle geprüft (Cron).
 * @param opts.trigger Für das Protokoll: 'cron' | 'client'.
 * @param opts.notify  Mail verschicken? Der Browser-Lauf setzt das auf `false` —
 *                     sonst käme zusätzlich zur Benachrichtigung im offenen Tab
 *                     eine Mail für denselben Alert.
 */
export async function runAlertCheck(opts: {
  userId?: string
  trigger: 'cron' | 'client'
  notify?: boolean
}): Promise<AlertCheckReport> {
  const notify = opts.notify ?? opts.trigger === 'cron'
  const report: AlertCheckReport = {
    alertsOpen: 0,
    triggered: 0,
    mailsSent: 0,
    mailsFailed: 0,
    triggeredIds: [],
    error: null,
  }

  // Der Lauf wird protokolliert, bevor irgendetwas passieren kann — auch ein
  // Absturz soll als „es wurde geprüft" sichtbar sein.
  const [run] = await db
    .insert(alertCheckRun)
    .values({ trigger: opts.trigger })
    .returning({ id: alertCheckRun.id })

  try {
    const where = opts.userId
      ? and(
          eq(priceAlert.userId, opts.userId),
          eq(priceAlert.active, true),
          isNull(priceAlert.triggeredAt),
        )
      : and(eq(priceAlert.active, true), isNull(priceAlert.triggeredAt))

    const open = await db.select().from(priceAlert).where(where)
    report.alertsOpen = open.length

    if (open.length > 0) {
      report.triggeredIds = await triggerReached(open)
      report.triggered = report.triggeredIds.length
    }

    if (notify) {
      const mail = await sendPending(opts.userId)
      report.mailsSent = mail.sent
      report.mailsFailed = mail.failed
    }
  } catch (err) {
    report.error = err instanceof Error ? err.message : String(err)
  } finally {
    await db
      .update(alertCheckRun)
      .set({
        finishedAt: new Date(),
        alertsOpen: report.alertsOpen,
        triggered: report.triggered,
        mailsSent: report.mailsSent,
        mailsFailed: report.mailsFailed,
        error: report.error,
      })
      .where(eq(alertCheckRun.id, run.id))
  }

  return report
}

/** Offene Alerts gegen die Kurse prüfen und die erreichten markieren. */
async function triggerReached(open: AlertRow[]): Promise<number[]> {
  // Kurse auffrischen — derselbe Batch-Weg wie die Watchlist, kein zweiter
  // Ladeweg. Fällt er aus, wird mit dem vorhandenen Stand weitergearbeitet.
  await refreshQuotesIfStale().catch(() => false)

  // Die Symbolauflösung hängt am Nutzer (dessen Instrumente), deshalb je Nutzer
  // ein Resolver. Ohne ihn würde ein Alert auf einen Trade mit Ticker `BTC`
  // gegen ein fremdes Papier geprüft — Etappe 11, 28,10 statt 63.533.
  const byUser = new Map<string, AlertRow[]>()
  for (const a of open) {
    const list = byUser.get(a.userId)
    if (list) list.push(a)
    else byUser.set(a.userId, [a])
  }

  // (Anbieter-Symbol|Markt) → Alerts. Ein Kursabruf je Gruppe, über alle Nutzer
  // hinweg: dasselbe Papier in zwei Konten ist eine Abfrage.
  const groups = new Map<string, AlertRow[]>()
  for (const [userId, list] of byUser) {
    const resolve = await createSymbolResolver(userId)
    for (const a of list) {
      const key = `${resolve(a.ticker, a.stockId)}|${a.market}`
      const existing = groups.get(key)
      if (existing) existing.push(a)
      else groups.set(key, [a])
    }
  }

  const symbols = [...groups.keys()].map((k) => k.split('|')[0])
  const snapshots = await loadSnapshots(symbols)

  const triggeredIds: number[] = []
  for (const [key, list] of groups) {
    const [symbol, market] = key.split('|')
    const snapshot = snapshots.get(symbol)
    const candle = await tryQuote(symbol, market as Market)
    if (!snapshot && !candle) continue // kein Kurs → beim nächsten Lauf erneut

    for (const a of list) {
      if (!isAlertDirection(a.direction)) continue
      const bySnapshot = snapshot ? isLevelReached(a.direction, a.price, snapshot.price) : false
      const byCandle = candle ? candleReachesLevel(a.direction, a.price, candle) : false
      if (bySnapshot || byCandle) triggeredIds.push(a.id)
    }
  }

  if (triggeredIds.length === 0) return []

  const updated = await db
    .update(priceAlert)
    .set({ triggeredAt: new Date() })
    .where(
      and(
        inArray(priceAlert.id, triggeredIds),
        isNull(priceAlert.triggeredAt), // Wettlauf-sicher: nur, was noch offen war
      ),
    )
    .returning({ id: priceAlert.id })

  if (updated.length) revalidatePath('/')
  return updated.map((r) => r.id)
}

/**
 * Alles verschicken, was ausgelöst und noch nicht gemeldet ist.
 *
 * Bewusst NICHT auf die soeben ausgelösten Alerts beschränkt: Ein Versand, der
 * beim letzten Lauf am Netz gescheitert ist, geht so beim nächsten von selbst
 * raus. `notifiedAt` wird erst nach erfolgreichem Versand gesetzt — ein
 * Fehlschlag verliert die Meldung nie, ein zweiter Lauf sendet sie nie doppelt.
 */
async function sendPending(userId?: string): Promise<{ sent: number; failed: number }> {
  const config = readMailConfig()
  if (!config) return { sent: 0, failed: 0 } // nicht eingerichtet — sichtbar in den Einstellungen

  const baseWhere = and(
    eq(priceAlert.active, true),
    isNotNull(priceAlert.triggeredAt),
    isNull(priceAlert.notifiedAt),
  )
  const where = userId ? and(baseWhere, eq(priceAlert.userId, userId)) : baseWhere

  // Der Plan zum Alert kommt gleich mit — ohne ihn stünde in der Mail eine Zahl
  // ohne Zusammenhang.
  const pending = await db
    .select({
      id: priceAlert.id,
      userId: priceAlert.userId,
      ticker: priceAlert.ticker,
      market: priceAlert.market,
      stockId: priceAlert.stockId,
      price: priceAlert.price,
      direction: priceAlert.direction,
      kind: priceAlert.kind,
      tradeId: priceAlert.tradeId,
      entry: trade.entryPrice,
      stop: trade.stopLoss,
      target: trade.takeProfit,
    })
    .from(priceAlert)
    .leftJoin(trade, eq(trade.id, priceAlert.tradeId))
    .where(where)

  if (pending.length === 0) return { sent: 0, failed: 0 }

  const baseUrl = appBaseUrl()
  let sent = 0
  let failed = 0

  // Je Nutzer eine Mail: drei gleichzeitig erreichte Level in drei Nachrichten
  // erzeugen Hektik — genau das, was hier nicht entstehen soll.
  const byUser = new Map<string, typeof pending>()
  for (const p of pending) {
    const list = byUser.get(p.userId)
    if (list) list.push(p)
    else byUser.set(p.userId, [p])
  }

  for (const [uid, rows] of byUser) {
    const recipient = await recipientFor(uid)
    if (!recipient) {
      // Abgeschaltet oder keine Adresse: Der Alert bleibt in der App sichtbar,
      // aber er soll nicht bei jedem Lauf erneut als Versandversuch auftauchen.
      await markNotified(rows.map((r) => r.id))
      continue
    }

    // Kurs für die Mail über das AUFGELÖSTE Anbieter-Symbol holen, nie über den
    // Rohticker (Etappe 11): `BTC` ist bei Yahoo ein anderes Papier, und ein
    // falscher Kurs in einer Alarm-Mail wäre schlimmer als gar keiner.
    const resolve = await createSymbolResolver(uid)
    const symbolFor = new Map(rows.map((r) => [r.id, resolve(r.ticker, r.stockId)]))
    const snapshots = await loadSnapshots([...new Set(symbolFor.values())])

    const items: AlertMailItem[] = rows.map((r) => {
      const snap = snapshots.get(symbolFor.get(r.id) ?? '')
      return {
        ticker: r.ticker,
        kind: r.kind as AlertKind,
        direction: isAlertDirection(r.direction) ? r.direction : 'above',
        level: r.price,
        price: snap?.price ?? null,
        quotedAtSec: snap?.quotedAt ?? null,
        tradeId: r.tradeId,
        entry: r.entry ?? null,
        stop: r.stop ?? null,
        target: r.target ?? null,
      }
    })

    const mail = buildAlertMail({ items, baseUrl })
    if (!mail) continue

    const result = await sendMail({ to: recipient, ...mail }, config)
    if (result.ok) {
      await markNotified(rows.map((r) => r.id))
      sent += 1
    } else {
      failed += 1
      // `notifiedAt` bleibt leer — der nächste Lauf versucht es erneut.
      console.error(`[alert-run] Versand an ${uid} gescheitert: ${result.error}`)
    }
  }

  return { sent, failed }
}

async function markNotified(ids: number[]): Promise<void> {
  if (ids.length === 0) return
  await db.update(priceAlert).set({ notifiedAt: new Date() }).where(inArray(priceAlert.id, ids))
}

/** Adresse des Nutzers — oder `null`, wenn er keine Mail will bzw. keine hat. */
async function recipientFor(userId: string): Promise<string | null> {
  const [row] = await db
    .select({
      notifyEmail: userSettings.notifyEmail,
      notifyByEmail: userSettings.notifyByEmail,
      accountEmail: user.email,
    })
    .from(user)
    .leftJoin(userSettings, eq(userSettings.userId, user.id))
    .where(eq(user.id, userId))

  if (!row) return null
  // Ohne Einstellungszeile gilt der Vorgabewert (an) — sonst bekäme ein Nutzer,
  // der die Einstellungen nie geöffnet hat, stillschweigend nichts.
  if (row.notifyByEmail === false) return null
  return resolveRecipient(row.notifyEmail, row.accountEmail)
}

/**
 * Basis-URL für die Links in der Mail. Auf Vercel steht sie in der Umgebung; im
 * Zweifel `localhost`, damit ein Testlauf keinen unbrauchbaren Link erzeugt.
 */
function appBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim()
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`
  return 'http://localhost:3000'
}

/** Wann zuletzt geprüft wurde — für die Zeile in den Einstellungen. */
export async function lastAlertCheck(): Promise<{
  startedAt: Date
  trigger: string
  error: string | null
} | null> {
  const [row] = await db
    .select({
      startedAt: alertCheckRun.startedAt,
      trigger: alertCheckRun.trigger,
      error: alertCheckRun.error,
    })
    .from(alertCheckRun)
    .orderBy(desc(alertCheckRun.startedAt))
    .limit(1)
  return row ?? null
}
