'use server'

// Bot-Zwilling (Etappe 5) — die Datenseite.
//
// Hier wird NICHT gerechnet: die Simulation liegt vollständig in `lib/bot-twin.ts`
// (rein, getestet). Diese Datei lädt Trades und Kerzen, wählt die Auflösung,
// hält das Gratis-Limit aus und reicht alles an die reine Logik weiter.
//
// Gespeichert wird nichts von der Simulation — sie rechnet bei jedem Aufruf neu
// über den bestehenden Kerzen-Cache (`getCachedCandles`, 15 min intraday / 12 h
// täglich). Persistiert werden nur die von Hand nachgetragenen Ausgänge für die
// Trades, bei denen es schlicht keine Kursdaten mehr gibt.

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { botManualOutcome, trade, tradeEvent } from '@/lib/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { getCachedCandles } from '@/lib/market-data/cached'
import {
  MarketDataError,
  type Candle,
  type Interval,
  type Market,
} from '@/lib/market-data/types'
import {
  parseViolations,
  tradeFees,
  tradePlannedRisk,
  tradeRMultiple,
  type TradeRow,
} from '@/lib/trade-stats'
import type { TradeEventRow } from '@/lib/trade-events'
import {
  BOT_INTERVALS,
  compareBotAndTrader,
  manualOutcomeRun,
  preferredInterval,
  simulateMissedTrade,
  simulateTrade,
  type BotOutcome,
  type BotRun,
  type BotSkipReason,
  type BotTrade,
  type BotTwinEntry,
  type BotTwinStats,
  type MissedEntry,
} from '@/lib/bot-twin'

// ---------------------------------------------------------------------------
// Grundlagen
// ---------------------------------------------------------------------------

/**
 * Ein „offen" am Ende einer zu kurzen Kerzenreihe ist meist kein offener Trade,
 * sondern erschöpfte Historie. Endet die Reihe länger als diese Spanne vor
 * heute, wird mit der nächstgröberen Auflösung nachgesehen.
 */
const STALE_SEC = 3 * 24 * 3600

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

/** Postgres „undefined table" (42P01) — Migration 0015 noch nicht angewendet. */
function isMissingTable(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { code?: string; cause?: { code?: string }; message?: string }
  return (
    e.code === '42P01' ||
    e.cause?.code === '42P01' ||
    /bot_manual_outcome/.test(e.message ?? '')
  )
}

type ManualRow = { outcome: BotOutcome; exitPrice: number | null }

/**
 * Nachgetragene Ausgänge, nach Trade-Id.
 *
 * Tolerant gegenüber fehlender Migration 0015: existiert die Tabelle noch nicht,
 * bleibt die Karte leer und der Bot-Zwilling rechnet ausschließlich über Kurse —
 * genau wie vor dieser Etappe.
 */
async function loadManualOutcomes(userId: string): Promise<Map<number, ManualRow>> {
  const map = new Map<number, ManualRow>()
  try {
    const rows = await db
      .select()
      .from(botManualOutcome)
      .where(eq(botManualOutcome.userId, userId))
    for (const r of rows) {
      if (r.outcome !== 'ziel' && r.outcome !== 'stop' && r.outcome !== 'offen') continue
      map.set(r.tradeId, { outcome: r.outcome, exitPrice: r.exitPrice })
    }
  } catch (err) {
    if (!isMissingTable(err)) throw err
  }
  return map
}

/** Events aller Trades des Nutzers, nach tradeId gruppiert (für event-aware R). */
async function loadEventsByTrade(userId: string): Promise<Map<number, TradeEventRow[]>> {
  const rows = await db.select().from(tradeEvent).where(eq(tradeEvent.userId, userId))
  const map = new Map<number, TradeEventRow[]>()
  for (const e of rows) {
    const arr = map.get(e.tradeId)
    if (arr) arr.push(e)
    else map.set(e.tradeId, [e])
  }
  return map
}

const dateLabel = (d: Date | null): string =>
  d ? d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'

/** Trade-Zeile → schmale Eingabe der Simulation. `null`, wenn Kerndaten fehlen. */
function toBotTrade(t: TradeRow, events: TradeEventRow[], from: Date | null): BotTrade | null {
  if (!from) return null
  return {
    id: t.id,
    ticker: t.ticker,
    direction: t.direction === 'short' ? 'short' : 'long',
    entryPrice: t.entryPrice,
    stopLoss: t.stopLoss,
    takeProfit: t.takeProfit,
    quantity: t.positionSize ?? 1,
    fees: tradeFees(t),
    plannedRisk: tradePlannedRisk(t, events),
    fromSec: Math.floor(from.getTime() / 1000),
  }
}

// ---------------------------------------------------------------------------
// Kerzen: ein Abruf je Symbol und Auflösung, mit Rücksicht auf das Gratis-Limit
// ---------------------------------------------------------------------------

type Loaded = Candle[] | { error: BotSkipReason }

/**
 * Welcher Anbieter hinter einem Markt steht (siehe `lib/market-data/index.ts`).
 *
 * Wichtig für das Minutenlimit: Binance und Twelve Data haben nichts
 * miteinander zu tun. Ein erschöpftes Twelve-Data-Kontingent darf die
 * Krypto-Trades nicht mit blockieren.
 */
function providerKey(market: Market): string {
  return market === 'krypto' ? 'binance' : 'twelvedata'
}

/**
 * Lädt Kerzen genau einmal je (Symbol, Markt, Auflösung) und merkt sich das
 * Ergebnis für diesen Aufruf.
 *
 * Twelve Data Free erlaubt ~8 Anfragen pro Minute. Statt blind zu deckeln wird
 * bis zum ersten echten Limit-Fehler geladen; danach gelten die noch nicht
 * geladenen Symbole **dieses Anbieters** als „diesmal nicht abgerufen". Beim
 * nächsten Aufruf sind die bereits geholten Reihen im Kerzen-Cache und die
 * übrigen kommen dran — die Auswertung füllt sich von selbst auf, ohne je zu
 * crashen.
 */
function createCandleLoader() {
  const cache = new Map<string, Loaded>()
  const limited = new Set<string>()

  return async function load(symbol: string, market: Market, interval: Interval): Promise<Loaded> {
    const key = `${symbol}|${market}|${interval}`
    const hit = cache.get(key)
    if (hit) return hit
    const provider = providerKey(market)
    if (limited.has(provider)) return { error: 'nicht_abgerufen' }

    try {
      const candles = await getCachedCandles(symbol, market, interval)
      cache.set(key, candles)
      return candles
    } catch (err) {
      const code = err instanceof MarketDataError ? err.code : 'upstream'
      if (code === 'rate_limit') {
        // Nicht merken: beim nächsten Aufruf soll es dasselbe Symbol erneut
        // versuchen dürfen, sobald das Minutenfenster weiter ist.
        limited.add(provider)
        return { error: 'nicht_abgerufen' }
      }
      const failed: Loaded = {
        error:
          code === 'unknown_symbol'
            ? 'unbekanntes_symbol'
            : code === 'unsupported'
              ? 'nicht_unterstuetzt'
              : 'kursdaten_fehler',
      }
      cache.set(key, failed)
      return failed
    }
  }
}

type Simulator = (t: BotTrade, candles: readonly Candle[]) => BotRun

/**
 * Simuliert mit der bevorzugten Auflösung und fällt auf die nächstgröbere
 * zurück, wenn die Historie nicht bis zum Einstieg reicht — oder wenn die Reihe
 * lange vor heute endet und das Ergebnis nur deshalb „offen" ist.
 */
async function runWithFallback(
  bot: BotTrade,
  market: Market,
  preferred: Interval,
  simulate: Simulator,
  load: ReturnType<typeof createCandleLoader>,
  nowSec: number,
): Promise<{ run: BotRun; resolution: Interval | null }> {
  const start = Math.max(0, BOT_INTERVALS.indexOf(preferred))
  const chain = BOT_INTERVALS.slice(start)

  let fallback: { run: BotRun; resolution: Interval | null } = {
    run: { simulated: false, reason: 'keine_kerzen' },
    resolution: null,
  }

  for (let i = 0; i < chain.length; i++) {
    const interval = chain[i]
    const loaded = await load(bot.ticker, market, interval)
    if (!Array.isArray(loaded)) {
      // Ein Abrufproblem ist kein Grund, gröber zu werden — es beträfe dasselbe
      // Symbol erneut. Gemerkt und weiter zur nächsten Auflösung nur, falls die
      // gröbere zufällig schon im Cache liegt.
      fallback = { run: { simulated: false, reason: loaded.error }, resolution: null }
      continue
    }

    const run = simulate(bot, loaded)
    const isLast = i === chain.length - 1

    if (run.simulated) {
      const exhausted = run.outcome === 'offen' && run.exitSec < nowSec - STALE_SEC
      if (!exhausted || isLast) return { run, resolution: interval }
      // Reihe endet lange vor heute → gröber nachsehen, aber das Ergebnis
      // behalten, falls die gröbere Auflösung nichts Besseres liefert.
      fallback = { run, resolution: interval }
      continue
    }

    // Nur eine zu kurze Historie rechtfertigt den Wechsel auf gröbere Kerzen.
    if (run.reason !== 'historie_zu_kurz' && run.reason !== 'keine_kerzen') {
      return { run, resolution: interval }
    }
    fallback = { run, resolution: interval }
  }

  return fallback
}

// ---------------------------------------------------------------------------
// Die Auswertung
// ---------------------------------------------------------------------------

/**
 * Der Vergleich „mechanischer Plan gegen tatsächliches Handeln" für /tracking.
 *
 * Abgeschlossene Trades bilden die Hauptdifferenz. Geplante, nie eingegangene
 * Trades (Status `kein_handel`) werden getrennt ausgewertet — sie beantworten
 * „was hätte ich verpasst", gehören aber nicht in dieselbe Zahl: das sind zwei
 * verschiedene Fehlerarten.
 */
export async function getBotTwinStats(): Promise<BotTwinStats> {
  const userId = await getUserId()

  const rows = await db
    .select()
    .from(trade)
    .where(eq(trade.userId, userId))
    .orderBy(asc(trade.closedAt), asc(trade.id))

  const closed = rows.filter((t) => t.status === 'abgeschlossen')
  const missed = rows.filter((t) => t.status === 'kein_handel')

  const [eventsByTrade, manual] = await Promise.all([
    loadEventsByTrade(userId),
    loadManualOutcomes(userId),
  ])

  const load = createCandleLoader()
  const nowSec = Math.floor(Date.now() / 1000)
  const market = (t: TradeRow): Market => (t.market as Market) ?? 'aktien'

  // --- abgeschlossene Trades -------------------------------------------------
  const entries: BotTwinEntry[] = []
  for (const t of closed) {
    const events = eventsByTrade.get(t.id) ?? []
    const bot = toBotTrade(t, events, t.openedAt)
    const label = dateLabel(t.closedAt ?? t.createdAt)
    const realR = tradeRMultiple(t, events)
    const editable = { hasTarget: t.takeProfit != null, manual: manual.get(t.id) ?? null }

    if (!bot) {
      entries.push({
        tradeId: t.id,
        ticker: t.ticker,
        label,
        realR,
        violations: parseViolations(t.ruleViolations),
        run: { simulated: false, reason: 'kein_zeitpunkt' },
        source: 'kurse',
        resolution: null,
        ...editable,
      })
      continue
    }

    const spanHours =
      t.openedAt && t.closedAt
        ? (t.closedAt.getTime() - t.openedAt.getTime()) / 3_600_000
        : 0

    const { run, resolution } = await runWithFallback(
      bot,
      market(t),
      preferredInterval(spanHours),
      simulateTrade,
      load,
      nowSec,
    )

    // Nachtrag füllt nur echte Lücken — eine Handeingabe überstimmt keine Messung.
    const fallbackManual = !run.simulated ? editable.manual : null
    entries.push({
      tradeId: t.id,
      ticker: t.ticker,
      label,
      realR,
      violations: parseViolations(t.ruleViolations),
      run: fallbackManual
        ? manualOutcomeRun(bot, fallbackManual.outcome, fallbackManual.exitPrice)
        : run,
      source: fallbackManual ? 'nachgetragen' : 'kurse',
      resolution: fallbackManual ? null : resolution,
      ...editable,
    })
  }

  // --- geplant, nie eingegangen ---------------------------------------------
  const missedEntries: MissedEntry[] = []
  for (const t of missed) {
    const events = eventsByTrade.get(t.id) ?? []
    const bot = toBotTrade(t, events, t.createdAt)
    const label = dateLabel(t.createdAt)
    const editable = { hasTarget: t.takeProfit != null, manual: manual.get(t.id) ?? null }

    if (!bot) {
      missedEntries.push({
        tradeId: t.id,
        ticker: t.ticker,
        label,
        run: { simulated: false, reason: 'kein_zeitpunkt' },
        source: 'kurse',
        resolution: null,
        ...editable,
      })
      continue
    }

    // Wie lange der Trade gelaufen WÄRE, ist unbekannt — deshalb die
    // reichweitenstärkste Auflösung als Ausgangspunkt.
    const { run, resolution } = await runWithFallback(
      bot,
      market(t),
      '1day',
      simulateMissedTrade,
      load,
      nowSec,
    )

    const fallbackManual = !run.simulated ? editable.manual : null
    missedEntries.push({
      tradeId: t.id,
      ticker: t.ticker,
      label,
      run: fallbackManual
        ? manualOutcomeRun(bot, fallbackManual.outcome, fallbackManual.exitPrice)
        : run,
      source: fallbackManual ? 'nachgetragen' : 'kurse',
      resolution: fallbackManual ? null : resolution,
      ...editable,
    })
  }

  return compareBotAndTrader(entries, missedEntries, closed.length)
}

// ---------------------------------------------------------------------------
// Nachtrag von Hand
// ---------------------------------------------------------------------------

/**
 * Für einen Trade eintragen, was aus ihm geworden wäre — gedacht für die Fälle,
 * in denen es keine Kursdaten mehr gibt.
 *
 * Bei `ziel`/`stop` wird kein Kurs übernommen: er ergibt sich aus dem Plan. Nur
 * ein offener Ausgang braucht einen eigenen Kurs. In der Auswertung erscheint
 * jeder Nachtrag sichtbar als solcher.
 */
export async function setBotOutcome(
  tradeId: number,
  data: { outcome: BotOutcome; exitPrice?: number | null; note?: string | null },
): Promise<void> {
  const userId = await getUserId()

  const [t] = await db
    .select()
    .from(trade)
    .where(and(eq(trade.id, tradeId), eq(trade.userId, userId)))
    .limit(1)
  if (!t) throw new Error('Trade nicht gefunden.')

  const outcome = data.outcome
  if (outcome !== 'ziel' && outcome !== 'stop' && outcome !== 'offen') {
    throw new Error('Ungültiger Ausgang — erlaubt sind Ziel, Stop oder offen.')
  }
  if (outcome === 'ziel' && t.takeProfit == null) {
    throw new Error('Dieser Trade hat kein Ziel im Plan — „Ziel erreicht" ist hier nicht möglich.')
  }

  let exitPrice: number | null = null
  if (outcome === 'offen') {
    const p = Number(data.exitPrice)
    if (!Number.isFinite(p) || p <= 0) {
      throw new Error('Für einen offenen Ausgang bitte den Kurs eintragen, zu dem bewertet wird.')
    }
    exitPrice = p
  }

  const note = data.note?.trim() || null
  const now = new Date()

  try {
    await db
      .insert(botManualOutcome)
      .values({ tradeId, userId, outcome, exitPrice, note, updatedAt: now })
      .onConflictDoUpdate({
        target: [botManualOutcome.tradeId, botManualOutcome.userId],
        set: { outcome, exitPrice, note, updatedAt: now },
      })
  } catch (err) {
    if (isMissingTable(err)) {
      throw new Error(
        'Die Tabelle für Nachträge fehlt noch — bitte Migration 0015 anwenden ' +
          '(node scripts/apply-migration.mjs drizzle/0015_bot_twin.sql).',
      )
    }
    throw err
  }

  revalidatePath('/tracking')
}

/** Einen Nachtrag wieder entfernen. */
export async function clearBotOutcome(tradeId: number): Promise<void> {
  const userId = await getUserId()
  try {
    await db
      .delete(botManualOutcome)
      .where(and(eq(botManualOutcome.tradeId, tradeId), eq(botManualOutcome.userId, userId)))
  } catch (err) {
    if (!isMissingTable(err)) throw err
  }
  revalidatePath('/tracking')
}
