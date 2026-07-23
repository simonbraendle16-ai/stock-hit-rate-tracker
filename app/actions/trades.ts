'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { trade, assessment, stock } from '@/lib/db/schema'
import { and, asc, desc, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { PRE_TRADE_QUESTIONS, type PreTradeAnswer } from '@/lib/pre-trade-questions'
import { computeRiskReward, computeShares } from '@/lib/trade-math'
import {
  computeDisciplineStats,
  computeEquityStats,
  hasPnl,
  parseViolations,
  tradeFees,
  tradeGrossPnl,
  tradePnl,
  tradeRisk,
  type DisciplineStats,
  type EquityPoint,
  type EquityStats,
  type RuleViolation,
  type TradeRow,
} from '@/lib/trade-stats'
import { getSettings } from '@/app/actions/settings'
import { listCashflows } from '@/app/actions/cashflows'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Rechenlogik und die zugehörigen Typen leben in `lib/trade-stats.ts` (testbar,
// ohne DB/Auth) und werden von dort importiert. Kein Re-Export hier: Turbopack
// behandelt jeden Export einer 'use server'-Datei als Server Action — auch
// reine Typ-Re-Exports, was den Build bricht.

export type TradeInput = {
  ticker: string
  market?: string
  direction: 'long' | 'short'
  entryPrice: number
  stopLoss: number
  takeProfit?: number | null
  positionSize?: number | null
  // Kapitaleinsatz in Kontowährung (Echtgeld). Stückzahl (positionSize) wird
  // daraus abgeleitet — bei Hebel aus Einsatz × Hebel.
  investedAmount?: number | null
  // Hebel, 1 = ungehebelt.
  leverage?: number | null
  // Geplante Ordergebühren; beim Abschluss eingefroren.
  feeEntry?: number | null
  feeExit?: number | null
  // Verkaufsanteil beim Take-Profit in Prozent (Teilverkauf-Projektion).
  takeProfitPct?: number | null
  strategy?: string | null
  broker?: string | null
  notes?: string | null
  // Elliott (voll integriert)
  elliottWaveCount?: string | null
  waveDegree?: string | null
  elliottInvalidation?: number | null
  // mit echtem Geld vs. Demo/Papertrade
  tradedWithMoney?: boolean
  // die 4 Douglas-Antworten (Gate = alle 'ja')
  preTradeAnswers?: PreTradeAnswer[]
}

const COOLDOWN_MIN = 60 // Revenge-Guard window

/** Hebel auf einen sinnvollen Bereich begrenzen; 1 = ungehebelt. */
function normalizeLeverage(v: number | null | undefined): number {
  if (v == null || !Number.isFinite(v) || v <= 0) return 1
  return Math.min(v, 500)
}

/** Gebühr übernehmen, sonst den Standard aus den Einstellungen. Nie negativ. */
function normalizeFee(v: number | null | undefined, fallback: number): number {
  if (v == null || !Number.isFinite(v) || v < 0) return fallback
  return v
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Create a planned trade. Enforces the Douglas "4 Fragen" gate: a trade is only
 * fully planned (preTradeAnswered) when wave count, entry, stop and a
 * target/invalidation are all present.
 */
export async function createTrade(input: TradeInput): Promise<{ id: number }> {
  const userId = await getUserId()
  const ticker = input.ticker.trim().toUpperCase()
  if (!ticker) throw new Error('Ticker ist erforderlich.')
  if (!input.entryPrice || !input.stopLoss) {
    throw new Error('Einstieg und Stop-Loss sind erforderlich.')
  }

  // Plausibilität: Ein Stop-Loss liegt bei Long unter, bei Short über dem Einstieg.
  // Ein Take-Profit liegt bei Long über, bei Short unter dem Einstieg. Sonst wären
  // die Risiko-/Gewinn-Projektionen falsch vorzeichig.
  if (input.direction === 'long' && input.stopLoss >= input.entryPrice) {
    throw new Error('Bei Long muss der Stop-Loss unter dem Einstieg liegen.')
  }
  if (input.direction === 'short' && input.stopLoss <= input.entryPrice) {
    throw new Error('Bei Short muss der Stop-Loss über dem Einstieg liegen.')
  }
  if (input.takeProfit != null) {
    if (input.direction === 'long' && input.takeProfit <= input.entryPrice) {
      throw new Error('Bei Long muss der Take-Profit über dem Einstieg liegen.')
    }
    if (input.direction === 'short' && input.takeProfit >= input.entryPrice) {
      throw new Error('Bei Short muss der Take-Profit unter dem Einstieg liegen.')
    }
  }

  // Optional link to an instrument in the watchlist (shared hit-rate key).
  let stockId: number | null = null
  const [existing] = await db
    .select({ id: stock.id })
    .from(stock)
    .where(and(eq(stock.userId, userId), eq(stock.ticker, ticker)))
  if (existing) stockId = existing.id

  // Gate: nur wenn ALLE Douglas-Fragen mit 'ja' beantwortet sind.
  const answers = input.preTradeAnswers ?? []
  const preTradeAnswered =
    answers.length === PRE_TRADE_QUESTIONS.length &&
    answers.every((a) => a.answer === 'ja')

  // live CRV
  const riskRewardRatio = computeRiskReward(
    input.entryPrice,
    input.stopLoss,
    input.takeProfit ?? null,
  )

  // Bei Echtgeld: Stückzahl aus Kapitaleinsatz und Hebel ableiten (Basis der
  // P&L-Rechnung). Der Hebel steckt danach in positionSize und wirkt dadurch
  // automatisch in Risiko, Guard und Statistik mit.
  const withMoney = input.tradedWithMoney ?? true
  const investedAmount =
    withMoney && input.investedAmount != null ? input.investedAmount : null
  const leverage = normalizeLeverage(input.leverage)
  const positionSize =
    investedAmount != null
      ? computeShares(investedAmount, input.entryPrice, leverage)
      : (input.positionSize ?? null)
  const takeProfitPct = input.takeProfitPct != null ? input.takeProfitPct : 100

  // Geplante Gebühren: Vorgabe aus den Einstellungen, im Formular überschreibbar.
  // Bei Demo-Trades fallen keine an.
  const settings = await getSettings()
  const feeEntry = withMoney ? normalizeFee(input.feeEntry, settings.defaultFeeEntry) : 0
  const feeExit = withMoney ? normalizeFee(input.feeExit, settings.defaultFeeExit) : 0

  const [row] = await db
    .insert(trade)
    .values({
      userId,
      stockId,
      ticker,
      market: input.market ?? 'aktien',
      direction: input.direction,
      entryPrice: input.entryPrice,
      stopLoss: input.stopLoss,
      takeProfit: input.takeProfit ?? null,
      positionSize,
      investedAmount,
      leverage,
      feeEntry,
      feeExit,
      takeProfitPct,
      strategy: input.strategy?.trim() || null,
      broker: input.broker?.trim() || null,
      riskRewardRatio,
      notes: input.notes?.trim() || null,
      status: 'geplant',
      elliottWaveCount: input.elliottWaveCount?.trim() || null,
      waveDegree: input.waveDegree?.trim() || null,
      elliottInvalidation: input.elliottInvalidation ?? null,
      preTradeAnswered,
      preTradeAnswers: answers.length ? JSON.stringify(answers) : null,
      tradedWithMoney: input.tradedWithMoney ?? true,
    })
    .returning({ id: trade.id })

  revalidatePath('/')
  revalidatePath('/trades')
  return { id: row.id }
}

async function loadOwnedTrade(userId: string, id: number): Promise<TradeRow> {
  const [t] = await db
    .select()
    .from(trade)
    .where(and(eq(trade.id, id), eq(trade.userId, userId)))
  if (!t) throw new Error('Trade nicht gefunden.')
  return t
}

/**
 * Activate a planned trade. Requires the 4-questions gate to be satisfied.
 * Returns a Revenge-Guard warning if a loss was closed within the cooldown.
 */
export async function activateTrade(id: number): Promise<{ revengeWarning: boolean }> {
  const userId = await getUserId()
  const t = await loadOwnedTrade(userId, id)
  if (t.status !== 'geplant') throw new Error('Nur geplante Trades können aktiviert werden.')
  if (!t.preTradeAnswered) {
    throw new Error('Erst die 4 Douglas-Fragen beantworten (Wellenzählung, Einstieg, Stop, Ziel/Invalidation).')
  }

  // Revenge-Guard: any loss closed within the cooldown window?
  const [lastLoss] = await db
    .select({ closedAt: trade.closedAt })
    .from(trade)
    .where(and(eq(trade.userId, userId), eq(trade.result, 'verlust')))
    .orderBy(desc(trade.closedAt))
    .limit(1)

  let revengeWarning = false
  const violations = parseViolations(t.ruleViolations)
  if (lastLoss?.closedAt) {
    const mins = (Date.now() - new Date(lastLoss.closedAt).getTime()) / 60000
    if (mins < COOLDOWN_MIN) {
      revengeWarning = true
      if (!violations.includes('revenge')) violations.push('revenge')
    }
  }

  await db
    .update(trade)
    .set({ status: 'aktiv', openedAt: new Date(), ruleViolations: JSON.stringify(violations) })
    .where(and(eq(trade.id, id), eq(trade.userId, userId)))

  revalidatePath('/')
  revalidatePath('/trades')
  return { revengeWarning }
}

/**
 * Edit plan fields. Allowed freely while `geplant`. Once `aktiv`, changing the
 * stop or invalidation is a Douglas rule violation — it is logged, not silently
 * accepted. Pass `force` to override (and take the discipline hit).
 */
export async function updateTradePlan(
  id: number,
  patch: Partial<TradeInput>,
  force = false,
): Promise<void> {
  const userId = await getUserId()
  const t = await loadOwnedTrade(userId, id)

  if (t.status === 'abgeschlossen' || t.status === 'abgebrochen') {
    throw new Error('Abgeschlossene Trades können nicht mehr geändert werden.')
  }

  const violations = parseViolations(t.ruleViolations)
  if (t.status === 'aktiv') {
    const movesStop = patch.stopLoss != null && patch.stopLoss !== t.stopLoss
    const movesInval =
      patch.elliottInvalidation != null && patch.elliottInvalidation !== t.elliottInvalidation
    if ((movesStop || movesInval) && !force) {
      throw new Error(
        'Plan-Lock: Stop/Invalidation eines aktiven Trades nicht verschieben (Douglas). ' +
          'Mit force=true wird es als Regelbruch protokolliert.',
      )
    }
    if (movesStop && !violations.includes('stop_moved')) violations.push('stop_moved')
    if (movesInval && !violations.includes('invalidation_ignored')) {
      violations.push('invalidation_ignored')
    }
  }

  // Kapitaleinsatz, Einstieg oder Hebel geändert → Stückzahl neu ableiten (Echtgeld).
  const nextEntry = patch.entryPrice ?? t.entryPrice
  const nextInvested =
    patch.investedAmount !== undefined ? patch.investedAmount : t.investedAmount
  const nextLeverage =
    patch.leverage !== undefined ? normalizeLeverage(patch.leverage) : (t.leverage ?? 1)
  const derivedSize =
    nextInvested != null ? computeShares(nextInvested, nextEntry, nextLeverage) : undefined

  await db
    .update(trade)
    .set({
      ...(patch.entryPrice != null ? { entryPrice: patch.entryPrice } : {}),
      ...(patch.stopLoss != null ? { stopLoss: patch.stopLoss } : {}),
      ...(patch.takeProfit !== undefined ? { takeProfit: patch.takeProfit } : {}),
      ...(patch.investedAmount !== undefined ? { investedAmount: patch.investedAmount } : {}),
      ...(patch.leverage !== undefined ? { leverage: nextLeverage } : {}),
      ...(patch.feeEntry !== undefined ? { feeEntry: normalizeFee(patch.feeEntry, 0) } : {}),
      ...(patch.feeExit !== undefined ? { feeExit: normalizeFee(patch.feeExit, 0) } : {}),
      ...(patch.takeProfitPct !== undefined ? { takeProfitPct: patch.takeProfitPct } : {}),
      ...(derivedSize !== undefined
        ? { positionSize: derivedSize }
        : patch.positionSize !== undefined
          ? { positionSize: patch.positionSize }
          : {}),
      ...(patch.strategy !== undefined ? { strategy: patch.strategy?.trim() || null } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes?.trim() || null } : {}),
      ...(patch.elliottWaveCount !== undefined
        ? { elliottWaveCount: patch.elliottWaveCount?.trim() || null }
        : {}),
      ...(patch.elliottInvalidation !== undefined
        ? { elliottInvalidation: patch.elliottInvalidation }
        : {}),
      ...(patch.tradedWithMoney !== undefined
        ? { tradedWithMoney: patch.tradedWithMoney }
        : {}),
      ruleViolations: JSON.stringify(violations),
    })
    .where(and(eq(trade.id, id), eq(trade.userId, userId)))

  revalidatePath('/')
  revalidatePath('/trades')
}

/**
 * Close a trade. A loss must be explicitly accepted (Douglas: "Meine Zählung
 * war für diesen Trade falsch. Der nächste Trade zählt.").
 */
export async function closeTrade(
  id: number,
  data: {
    result: 'gewinn' | 'verlust' | 'breakeven'
    actualExitPrice?: number | null
    followedPlan: boolean
    lossAccepted?: boolean
    tradedWithMoney?: boolean
    // Letzte Gelegenheit, die tatsächlich gezahlten Gebühren zu korrigieren —
    // danach sind sie eingefroren.
    feeEntry?: number | null
    feeExit?: number | null
  },
): Promise<void> {
  const userId = await getUserId()
  const t = await loadOwnedTrade(userId, id)
  if (t.status === 'abgeschlossen' || t.status === 'abgebrochen') {
    throw new Error('Trade ist bereits abgeschlossen.')
  }
  if (data.result === 'verlust' && !data.lossAccepted) {
    throw new Error('Verlust bitte bewusst akzeptieren, bevor der Trade geschlossen wird.')
  }
  // Ohne Ausstiegskurs lässt sich der P&L nicht berechnen. Früher wurde an
  // dieser Stelle stillschweigend ein Betrag unterstellt — jetzt wird gefragt.
  if (data.result !== 'breakeven' && data.actualExitPrice == null) {
    throw new Error(
      'Bitte den tatsächlichen Ausstiegskurs eintragen — ohne ihn lässt sich Gewinn oder Verlust nicht berechnen.',
    )
  }

  const withMoney = data.tradedWithMoney ?? t.tradedWithMoney

  await db
    .update(trade)
    .set({
      status: 'abgeschlossen',
      result: data.result,
      actualExitPrice: data.actualExitPrice ?? null,
      followedPlan: data.followedPlan,
      lossAccepted: data.result === 'verlust' ? true : t.lossAccepted,
      ...(data.tradedWithMoney !== undefined
        ? { tradedWithMoney: data.tradedWithMoney }
        : {}),
      // Gebühren hier festschreiben: ab jetzt verändert keine spätere
      // Einstellungsänderung mehr die Bilanz dieses Trades.
      feeEntry: withMoney ? normalizeFee(data.feeEntry, t.feeEntry ?? 0) : 0,
      feeExit: withMoney ? normalizeFee(data.feeExit, t.feeExit ?? 0) : 0,
      closedAt: new Date(),
    })
    .where(and(eq(trade.id, id), eq(trade.userId, userId)))

  revalidatePath('/')
  revalidatePath('/trades')
  revalidatePath('/tracking')
}

/**
 * Mark a planned setup as "kein Handel": the entry/target zone was never reached
 * (or was set wrong), so no trade happened. Terminal state — neutral for win-rate,
 * expectancy, P&L and the hit-rate curve (none of those count it). Feeds the
 * separate Zonen-Trefferquote via getZoneStats().
 */
export async function markNoTrade(id: number, note?: string | null): Promise<void> {
  const userId = await getUserId()
  const t = await loadOwnedTrade(userId, id)
  if (t.status !== 'geplant') {
    throw new Error('Nur geplante Setups können als „kein Handel" markiert werden.')
  }
  await db
    .update(trade)
    .set({
      status: 'kein_handel',
      noTradeNote: note?.trim() || null,
      closedAt: new Date(),
    })
    .where(and(eq(trade.id, id), eq(trade.userId, userId)))

  revalidatePath('/')
  revalidatePath('/trades')
  revalidatePath('/tracking')
}

export async function abortTrade(id: number): Promise<void> {
  const userId = await getUserId()
  await loadOwnedTrade(userId, id)
  await db
    .update(trade)
    .set({ status: 'abgebrochen', closedAt: new Date() })
    .where(and(eq(trade.id, id), eq(trade.userId, userId)))
  revalidatePath('/')
  revalidatePath('/trades')
}

export async function deleteTrade(id: number): Promise<void> {
  const userId = await getUserId()
  await db.delete(trade).where(and(eq(trade.id, id), eq(trade.userId, userId)))
  revalidatePath('/')
  revalidatePath('/trades')
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listTrades(): Promise<TradeRow[]> {
  const userId = await getUserId()
  return db
    .select()
    .from(trade)
    .where(eq(trade.userId, userId))
    .orderBy(desc(trade.createdAt))
}

/** All trades linked to a given instrument (by stockId), newest first. */
export async function getInstrumentTrades(stockId: number): Promise<TradeRow[]> {
  const userId = await getUserId()
  return db
    .select()
    .from(trade)
    .where(and(eq(trade.userId, userId), eq(trade.stockId, stockId)))
    .orderBy(desc(trade.createdAt))
}

export async function getTrade(id: number): Promise<TradeRow | null> {
  const userId = await getUserId()
  const [t] = await db
    .select()
    .from(trade)
    .where(and(eq(trade.id, id), eq(trade.userId, userId)))
  return t ?? null
}

/**
 * Douglas discipline + expectancy stats over all completed trades.
 * Startkapital kommt aus den User-Einstellungen (optionaler Override für Tests).
 */
export async function getDisciplineStats(startCapitalOverride?: number): Promise<DisciplineStats> {
  const userId = await getUserId()
  const startCapital =
    startCapitalOverride ?? (await getSettings()).startCapital
  const rows = await db
    .select()
    .from(trade)
    .where(and(eq(trade.userId, userId), eq(trade.status, 'abgeschlossen')))
    .orderBy(asc(trade.closedAt), asc(trade.id))

  return computeDisciplineStats(rows, startCapital, await listCashflows())
}

export type GroupStats = {
  completed: number
  wins: number
  losses: number
  hitRate: number // 0-100 über entschiedene Trades (gewinn|verlust)
  avgPnL: number // Ø P&L je entschiedenem Trade
  totalPnL: number
}

export type MoneyVsPaper = { money: GroupStats; paper: GroupStats }

/**
 * Trefferquote und Ø Gewinn je Trade, getrennt nach echtem Geld vs. Demo.
 * Grundlage für die beiden Auswertungs-Charts.
 */
export async function getMoneyVsPaperStats(): Promise<MoneyVsPaper> {
  const userId = await getUserId()
  const rows = await db
    .select()
    .from(trade)
    .where(and(eq(trade.userId, userId), eq(trade.status, 'abgeschlossen')))

  const group = (list: TradeRow[]): GroupStats => {
    const wins = list.filter((t) => t.result === 'gewinn').length
    const losses = list.filter((t) => t.result === 'verlust').length
    const decisive = wins + losses
    // Trades ohne Ausstiegskurs haben keinen berechenbaren P&L und zählen nicht mit.
    const totalPnL = list.filter(hasPnl).reduce((acc, t) => acc + (tradePnl(t) ?? 0), 0)
    return {
      completed: list.length,
      wins,
      losses,
      hitRate: decisive ? (wins / decisive) * 100 : 0,
      avgPnL: decisive ? totalPnL / decisive : 0,
      totalPnL,
    }
  }

  return {
    money: group(rows.filter((t) => t.tradedWithMoney)),
    paper: group(rows.filter((t) => !t.tradedWithMoney)),
  }
}

export type ZoneStats = {
  reached: number // Zonen, die angelaufen sind (Trade ausgelöst / Analyse aufgegangen)
  notReached: number // „kein Handel" / „Zone nicht angelaufen"
  total: number
  rate: number // 0-100: wie oft laufen die geplanten Zonen tatsächlich an
}

/**
 * Zonen-Trefferquote über Trades UND Analysen: wie oft läuft eine geplante
 * Einstiegs-/Zielzone tatsächlich an?
 * - Trade: `reached` = irgendwann aktiviert (openedAt gesetzt), `notReached` = Status „kein_handel".
 * - Analyse: `reached` = aufgelöst (richtig/falsch), `notReached` = „Zone nicht angelaufen".
 * Unabhängig von Gewinn/Verlust bzw. richtig/falsch.
 */
export async function getZoneStats(): Promise<ZoneStats> {
  const userId = await getUserId()
  const tradeRows = await db
    .select({ openedAt: trade.openedAt, status: trade.status })
    .from(trade)
    .where(eq(trade.userId, userId))
  const analysisRows = await db
    .select({ zoneNotReached: assessment.zoneNotReached })
    .from(assessment)
    .where(eq(assessment.userId, userId))

  const reached =
    tradeRows.filter((t) => t.openedAt != null).length +
    analysisRows.filter((a) => !a.zoneNotReached).length
  const notReached =
    tradeRows.filter((t) => t.status === 'kein_handel').length +
    analysisRows.filter((a) => a.zoneNotReached).length
  const total = reached + notReached
  return {
    reached,
    notReached,
    total,
    rate: total ? (reached / total) * 100 : 0,
  }
}

export type UnifiedPoint = {
  date: string
  label: string
  hitRate: number // cumulative 0-100
  correct: number
  wrong: number
}

/**
 * Unified hit-rate timeline: combines pure analyses (assessment) and the
 * outcomes of closed trades (gewinn = correct, verlust = wrong) into ONE
 * cumulative curve — the "zusammen wo sinnvoll" part of the hybrid model.
 */
export async function getUnifiedHitRateTimeline(): Promise<UnifiedPoint[]> {
  const userId = await getUserId()

  const analyses = await db
    .select()
    .from(assessment)
    .where(eq(assessment.userId, userId))

  const trades = await db
    .select()
    .from(trade)
    .where(and(eq(trade.userId, userId), eq(trade.status, 'abgeschlossen')))

  type Ev = { at: number; correct: boolean }
  const events: Ev[] = []
  for (const a of analyses) {
    if (a.zoneNotReached) continue // neutral, zählt nicht in die Hit-Rate-Kurve
    events.push({ at: new Date(a.assessmentDate).getTime(), correct: a.isCorrect })
  }
  for (const t of trades) {
    if (t.result === 'gewinn' || t.result === 'verlust') {
      const at = t.closedAt ? new Date(t.closedAt).getTime() : new Date(t.createdAt).getTime()
      events.push({ at, correct: t.result === 'gewinn' })
    }
  }
  events.sort((a, b) => a.at - b.at)

  const points: UnifiedPoint[] = []
  let correct = 0
  let wrong = 0
  for (const e of events) {
    if (e.correct) correct++
    else wrong++
    const total = correct + wrong
    const d = new Date(e.at)
    points.push({
      date: d.toISOString(),
      label: d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }),
      hitRate: (correct / total) * 100,
      correct,
      wrong,
    })
  }
  return points
}

/**
 * Equity-Kurve, Max-Drawdown und Verlust-Serien — NUR Echtgeld-Trades,
 * chronologisch nach Abschluss. Ein- und Auszahlungen erscheinen als eigene
 * Punkte und zählen nicht in den Drawdown (eine Auszahlung ist kein Verlust).
 */
export async function getEquityStats(): Promise<EquityStats> {
  const userId = await getUserId()
  const startCapital = (await getSettings()).startCapital

  const rows = await db
    .select()
    .from(trade)
    .where(and(eq(trade.userId, userId), eq(trade.status, 'abgeschlossen')))
    .orderBy(asc(trade.closedAt), asc(trade.id))

  return computeEquityStats(rows, startCapital, await listCashflows())
}

// ---------------------------------------------------------------------------
// CSV-Export
// ---------------------------------------------------------------------------

/** Trade-Journal als CSV (Semikolon-getrennt, für Excel/DE-Locale). */
export async function exportTradesCsv(): Promise<string> {
  const userId = await getUserId()
  const rows = await db
    .select()
    .from(trade)
    .where(eq(trade.userId, userId))
    .orderBy(asc(trade.createdAt), asc(trade.id))

  const headerCols = [
    'id', 'ticker', 'markt', 'richtung', 'status', 'echtgeld',
    'einstieg', 'stop', 'ziel', 'stueckzahl', 'kapitaleinsatz',
    'hebel', 'gebuehr_kauf', 'gebuehr_verkauf',
    'ergebnis', 'ausstieg', 'netto_pnl', 'plan_befolgt', 'regelbrueche',
    'wellengrad', 'wellenzaehlung', 'erstellt', 'geschlossen',
  ]

  const esc = (v: unknown): string => {
    const s = v == null ? '' : String(v)
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const lines = [headerCols.join(';')]
  for (const t of rows) {
    lines.push(
      [
        t.id,
        t.ticker,
        t.market,
        t.direction,
        t.status,
        t.tradedWithMoney ? 'ja' : 'nein',
        t.entryPrice,
        t.stopLoss,
        t.takeProfit ?? '',
        t.positionSize ?? '',
        t.investedAmount ?? '',
        t.leverage ?? 1,
        t.feeEntry ?? '',
        t.feeExit ?? '',
        t.result ?? '',
        t.actualExitPrice ?? '',
        // Leer, wenn kein Ausstiegskurs erfasst ist — kein erfundener Betrag.
        t.status === 'abgeschlossen' ? (tradePnl(t)?.toFixed(2) ?? '') : '',
        t.followedPlan == null ? '' : t.followedPlan ? 'ja' : 'nein',
        parseViolations(t.ruleViolations).join('|'),
        t.waveDegree ?? '',
        t.elliottWaveCount ?? '',
        t.createdAt ? new Date(t.createdAt).toISOString() : '',
        t.closedAt ? new Date(t.closedAt).toISOString() : '',
      ]
        .map(esc)
        .join(';'),
    )
  }
  return lines.join('\n')
}
