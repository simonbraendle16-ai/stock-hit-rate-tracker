'use server'

import { actualTime, withEventContext } from '@/lib/trade-history'

import { requireFrozenFxRate, portfolioCurrency } from '@/lib/money-currency'

import { normalizePlanContext, planGaps, requireCompletePlan, planningSnapshot, type PlanContext } from '@/lib/plan-context'
import { createTradeForUser } from '@/lib/create-trade-service'
import { hasRecentLoss, resolveManagementReview, type ManagementReview } from '@/lib/management-review'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { activateTradeForUser, updateTradePlanForUser, closeTradeForUser, partialCloseForUser, addToPositionForUser, executeTargetForUser } from '@/lib/trade-position-service'
import { withManualTrade } from '@/lib/manual-trade'
import { priceAlert, trade, tradeEvent, tradeTarget, assessment, stock } from '@/lib/db/schema'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { type PreTradeAnswer } from '@/lib/pre-trade-questions'
import {
  normalizeMoodCheck,
  serializeMoodTags,
  parseMoodTags,
  moodScoreLabel,
  type MoodCheckInput,
} from '@/lib/emotions'
import type { Market } from '@/lib/market-data/types'
import { computeRiskReward, computeShares } from '@/lib/trade-math'
import {
  contractTradeFelder,
  gebundeneMargin,
  specFromStock,
  type ContractTradeFelder,
} from '@/lib/contract-trade'
import { berechneDeckung, maxKontrakte, parseFxRates, pruefeDeckung } from '@/lib/margin'
import {
  computeDisciplineStats,
  computeEquityStats,
  computeMoodStats,
  computeSetupStats,
  computeTimeStats,
  medianRiskFraction,
  netCashflow,
  parseViolations,
  ratedRMultiples,
  tradeNetPnl,
  type DisciplineStats,
  type EquityPoint,
  type EquityStats,
  type MoodStats,
  type RuleViolation,
  type SetupStats,
  type TimeStats,
  type TradeRow,
  type TradeEventsByTrade,
  type CashflowRow,
} from '@/lib/trade-stats'
import { parseSetupTags, rankSetupTags, serializeSetupTags } from '@/lib/setups'
import {
  isQuickTrade,
  normalizeTradeKind,
  requiresMoodCheck,
  requiresPreTradeGate,
  type TradeKind,
} from '@/lib/trade-kind'
import { simulateFuture, type MonteCarloStats } from '@/lib/monte-carlo'
import {
  settlePosition,
  type TradeEventRow,
} from '@/lib/trade-events'
import {
  blendedRiskReward,
  effectiveTargets,
  buildTargetPlan,
  normalizeTargets,
  plannedQty,
  type TargetPlanInput,
  type TradeTargetRow,
} from '@/lib/trade-targets'
import { getSettings } from '@/app/actions/settings'
import { createPlanAlerts } from '@/app/actions/alerts'
import type { AlertKind } from '@/lib/alerts'
import {
  ensurePortfolios,
  kindOf,
  loadOwnedPortfolio,
  loadScopeContext,
  loadScopedCashflows,
  tradeScopeWhere,
} from '@/lib/portfolio-context'
import { scopePortfolioIds, type PortfolioRow } from '@/lib/portfolio-scope'

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
  quoteCurrency?: string | null
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
  // Anzahl Kontrakte (Teil 3). Gesetzt nur bei Instrumenten mit gültiger
  // Kontrakt-Spezifikation; dann bestimmt SIE die Positionsgröße, und
  // `investedAmount` wird zum Einschuss statt zum Kapitaleinsatz. Ohne Angabe
  // bleibt alles beim bisherigen Weg über Einsatz und Hebel.
  contracts?: number | null
  // Geplante Ordergebühren; beim Abschluss eingefroren.
  feeEntry?: number | null
  feeExit?: number | null
  // Verkaufsanteil beim Take-Profit in Prozent (Teilverkauf-Projektion).
  takeProfitPct?: number | null
  // Teilziele (Etappe 13): mehrere Ausstiegsstufen statt eines einzelnen Ziels.
  // Optional — ohne Angabe bleibt es beim Feld `takeProfit` wie bisher.
  //
  // Ist die Liste gesetzt, ist SIE der Plan: `takeProfit`/`takeProfitPct` werden
  // aus der ersten Stufe abgeleitet und nicht mehr aus der Eingabe übernommen.
  // Geprüft und sortiert wird ausschließlich in `lib/trade-targets.ts`.
  targets?: TargetPlanInput[] | null
  strategy?: string | null
  // Setup-Tags (Etappe 7b): die auswertbare Schublade neben dem Freitext.
  // Gesäubert wird in `lib/setups.ts` — der Client darf hier alles schicken.
  setupTags?: string[] | null
  broker?: string | null
  notes?: string | null
  // Elliott (voll integriert)
  elliottWaveCount?: string | null
  waveDegree?: string | null
  elliottInvalidation?: number | null
  // Das Depot, in das gebucht wird (Etappe 12). Ohne Angabe nimmt der Server die
  // aktive Auswahl — aber nur, wenn das ein einzelnes Depot ist.
  //
  // Die Handelsart (`tradedWithMoney`) wird daraus ABGELEITET und ist deshalb
  // absichtlich kein Eingabefeld mehr: Sie war eine Vorbelegung, die man
  // übersieht, und genau daran ist ein Papier-Trade in der echten Bilanz gelandet.
  portfolioId?: number | null
  // Vorabantworten: Planvoraussetzungen und Reflexion
  preTradeAnswers?: PreTradeAnswer[]
  planContext?: PlanContext | null
  // Erfassungsweg: 'langfristig' (voller Weg) oder 'schnell' (ohne Fragen-Gate).
  // Regeln in `lib/trade-kind.ts`; Unbekanntes fällt auf den vollen Weg zurück.
  tradeKind?: TradeKind
}


/**
 * Das Depot, in das ein neuer Trade gebucht wird.
 *
 * Mit ausdrücklicher Angabe: genau dieses, nach Prüfung der Eigentümerschaft.
 * Ohne Angabe: die aktive Auswahl — sofern sie ein einzelnes Depot ist. Das
 * Echtgeld-Aggregat ist bewusst KEIN Ziel; in eine Zusammenfassung kann man nicht
 * buchen, und stillschweigend „irgendein Echtgeld-Depot" zu wählen wäre wieder
 * eine Vorbelegung, die man übersieht. Deshalb wird hier nachgefragt statt geraten.
 */
async function resolveZielDepot(
  userId: string,
  portfolioId: number | null | undefined,
): Promise<PortfolioRow> {
  if (portfolioId != null) return loadOwnedPortfolio(userId, portfolioId)

  const { active } = await loadScopeContext(userId)
  if (active) return active

  throw new Error(
    'Bitte wähle das Depot, in das dieser Trade gebucht werden soll — in die Zusammenfassung „Alle Echtgeld-Depots" kann nicht gebucht werden.',
  )
}

/**
 * Die Deckung eines Depots: Kontostand minus bereits gebundener Einschuss.
 *
 * Kontostand = Startkapital + Ein-/Auszahlungen + realisierte P&L. Verluste
 * zählen also mit — nach zehn Verlusten ist eben nicht mehr alles frei, und
 * eine App, die das verschweigt, hilft beim Überziehen.
 *
 * `exceptTradeId` schließt einen Trade aus der Bindung aus. Beim Aktivieren
 * wird der eigene Trade sonst doppelt gezählt: einmal als bereits gebunden,
 * einmal als das, was gerade geprüft wird.
 */
async function ladeDeckung(userId: string, portfolioId: number, exceptTradeId?: number) {
  const depot = await loadOwnedPortfolio(userId, portfolioId)
  const rows = await db
    .select({
      id: trade.id,
      status: trade.status,
      investedAmount: trade.investedAmount,
      // Muss mit: `gebundeneMargin` zählt nur Kontrakt-Trades. Ohne diese
      // Spalte wäre die Bindung stumm immer 0.
      contracts: trade.contracts,
    })
    .from(trade)
    .where(and(eq(trade.userId, userId), eq(trade.portfolioId, portfolioId)))

  // Realisierte P&L des Depots — event-aware, exakt wie in der Bilanz.
  const abgeschlossen = await db
    .select()
    .from(trade)
    .where(
      and(
        eq(trade.userId, userId),
        eq(trade.portfolioId, portfolioId),
        eq(trade.status, 'abgeschlossen'),
      ),
    )
  const eventsByTrade = await loadEventsByTrade(userId)
  let realisiertePnl = 0
  for (const t of abgeschlossen) {
    const pnl = tradeNetPnl(t, eventsByTrade.get(t.id) ?? [])
    if (pnl === null) throw new Error('Deckung nicht prüfbar: Bestands-P&L oder Währungsabrechnung unvollständig.')
    realisiertePnl += pnl
  }

  const flows = await loadScopedCashflows(userId, [portfolioId])
  const offene = rows.filter((r) => r.id !== exceptTradeId)
  if (offene.some(r => r.contracts != null && ['aktiv', 'geplant'].includes(r.status) && r.investedAmount == null)) throw new Error('Gebundener Kontrakteinschuss unbekannt.')

  return {
    depot,
    rates: parseFxRates(depot.fxRates),
    deckung: berechneDeckung({
      startCapital: depot.startCapital,
      netCashflow: netCashflow(flows),
      realisiertePnl,
      gebundeneMargin: gebundeneMargin(offene),
    }),
  }
}

/**
 * Deckung prüfen und bei Unterdeckung abbrechen — mit einer Begründung, die die
 * Zahlen nennt und sagt, wie viele Kontrakte gegangen wären.
 *
 * Eine stille Überziehung wäre das Gegenteil von „das Risiko steht vor dem
 * Einstieg fest": Sie verschiebt die Entscheidung in den Moment, in dem der
 * Broker die Position zwangsweise schließt.
 */
async function verlangeDeckung(args: {
  snapshotRate?: number
  userId: string
  portfolioId: number
  felder: ContractTradeFelder
  ticker: string
  exceptTradeId?: number
}): Promise<{ einschussKonto: number | null; hinweis: string | null }> {
  const { deckung, depot, rates } = await ladeDeckung(
    args.userId,
    args.portfolioId,
    args.exceptTradeId,
  )
  const settings = await getSettings()
  const kontowaehrung = portfolioCurrency(depot, settings.currency)
  const checkedRates = args.snapshotRate == null ? rates : { ...rates, [args.felder.contractCurrency]: args.snapshotRate }

  const pruefung = pruefeDeckung({
    einschuss: args.felder.contractInitialMargin,
    waehrung: args.felder.contractCurrency,
    kontowaehrung,
    rates: checkedRates,
    deckung,
    label: `${args.ticker} · ${args.felder.contracts} Kontrakte`,
  })
  if (pruefung.ok) {
    // `hinweis` heißt: nicht prüfbar (Fremdwährung ohne hinterlegten Kurs).
    // Dann gibt es auch keinen Einschuss in Kontowährung — die Spalte bleibt
    // leer statt zu raten.
    //
    // Der Hinweis wird WEITERGEREICHT, nicht verschluckt. Ein Trade, der
    // ungeprüft durchgeht, muss das sagen: Sonst sieht er aus wie einer, der
    // die Prüfung bestanden hat. Und weil `investedAmount` leer bleibt, fällt
    // er auch aus der gebundenen Margin — die Lücke wäre also doppelt still.
    if (pruefung.hinweis) return { einschussKonto: null, hinweis: pruefung.hinweis }
    return { einschussKonto: pruefung.benoetigt, hinweis: null }
  }

  const moeglich = maxKontrakte({
    einschussJeKontrakt: args.felder.contractInitialMargin / args.felder.contracts,
    waehrung: args.felder.contractCurrency,
    kontowaehrung,
    rates: checkedRates,
    frei: deckung.frei,
  })
  const zusatz =
    moeglich == null
      ? ''
      : moeglich === 0
        ? ` Im Depot „${depot.name}" geht derzeit kein einziger Kontrakt.`
        : ` Im Depot „${depot.name}" gehen derzeit ${moeglich} Kontrakte.`
  throw new Error(pruefung.grund + zusatz)
}

/**
 * Die Kontrakt-Spalten eines Trades — oder `null`, wenn es keiner ist.
 *
 * Zwei Bedingungen müssen zusammenkommen: Der Nutzer hat Kontrakte angegeben,
 * UND das Instrument hat eine gültige Spezifikation. Fehlt eins von beidem,
 * bleibt es beim bisherigen Weg über Kapitaleinsatz und Stückzahl. Ein halb
 * bekannter Kontrakt wird bewusst nicht gerechnet — er wäre ein stiller
 * Falschwert mit dem 50-fachen Multiplikator.
 *
 * Aufgelöst wird über die `stockId` und nur ersatzweise über den Ticker: Ein
 * Trade hängt an seinem Instrument, und nur dort steht die Handeingabe.
 */
async function ladeKontraktFelder(args: {
  userId: string
  stockId: number | null
  ticker: string
  market: string
  contracts?: number | null
  entryPrice: number
  stopLoss: number
  leverage: number
}): Promise<ContractTradeFelder | null> {
  const n = args.contracts
  if (n == null || !Number.isFinite(n) || n <= 0) return null

  let row: Parameters<typeof specFromStock>[0] = null
  if (args.stockId != null) {
    const [s] = await db
      .select()
      .from(stock)
      .where(and(eq(stock.id, args.stockId), eq(stock.userId, args.userId)))
    if (s) row = s
  }
  // Ohne verknüpftes Instrument bleibt die Vorgabe über die Kontrakt-Wurzel —
  // eine Handeingabe gibt es dann naturgemäß nicht.
  if (!row) row = { ticker: args.ticker, market: args.market }

  const spec = specFromStock(row)
  if (!spec) return null

  return contractTradeFelder({
    spec,
    contracts: n,
    entryPrice: args.entryPrice,
    stopLoss: args.stopLoss,
    leverage: args.leverage,
  })
}

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

/**
 * Emotions-Check-in prüfen — oder den Vorgang abbrechen.
 *
 * Der Check-in ist Pflicht (Etappe 4). Wäre er überspringbar, würde er genau
 * dann übersprungen, wenn man aufgewühlt ist — also in exakt den Fällen, die
 * die Auswertung sichtbar machen soll. Eine lückenhafte Erhebung wäre nicht
 * nur unvollständig, sie wäre systematisch schöngefärbt.
 *
 * Ein Skalenwert genügt; Tags und Notiz bleiben freiwillig.
 */
function requireMood(input: MoodCheckInput | null | undefined, phase: 'entry' | 'exit') {
  const mood = normalizeMoodCheck(input)
  if (!mood) {
    throw new Error(
      phase === 'entry'
        ? 'Emotions-Check-in fehlt: Bitte beschreibe, wie du dich vor dem Einstieg fühlst; die Skala ist freiwillig.'
        : 'Emotions-Check-in fehlt: Bitte beschreibe, wie du dich beim Ausstieg fühlst; die Skala ist freiwillig.',
    )
  }
  return mood
}

/**
 * Check-in je nach Erfassungsweg: Pflicht beim langfristigen Trade, freiwillig
 * beim schnellen (`lib/trade-kind.ts`). Wird beim schnellen Weg trotzdem einer
 * erfasst, zählt er ganz normal in die Auswertung — nur erzwungen wird er nicht.
 *
 * Die Begründung für die Ausnahme steht in `lib/trade-kind.ts`: eine hastig
 * weggeklickte Skala ist schlechter als gar keine, weil sie die Auswertung mit
 * Zufallswerten füllt statt sie ehrlich leer zu lassen.
 */
function moodForKind(
  kind: string | null | undefined,
  input: MoodCheckInput | null | undefined,
  phase: 'entry' | 'exit',
) {
  if (requiresMoodCheck(kind)) return requireMood(input, phase)
  return normalizeMoodCheck(input)
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Der Zielplan eines Trades: geprüfte Stufen plus die daraus ABGELEITETEN Felder
 * der Trade-Zeile.
 *
 * Sind Teilziele angegeben, sind sie der Plan — `takeProfit` und `takeProfitPct`
 * werden dann aus der ersten Stufe geschrieben und nicht mehr aus der Eingabe
 * übernommen (dieselbe Haltung wie bei `tradedWithMoney` seit Etappe 12: eine
 * Quelle, alles andere ist ihre Schreibweise). Das Chance-Risiko-Verhältnis ist
 * in diesem Fall der nach Anteilen gewichtete Wert — die erste Stufe allein wäre
 * eine zu kleine, die letzte eine zu große Aussage über denselben Plan.
 *
 * Ohne Teilziele bleibt alles exakt wie vorher: ein Ziel, ein R:R, keine Zeilen
 * in `trade_target`.
 */
function resolveTargetPlan(input: {
  entryPrice: number
  stopLoss: number
  direction: string
  /** PFLICHT seit Migration 0032 — die Spalte ist NOT NULL. */
  takeProfit: number
  takeProfitPct?: number | null
  targets?: TargetPlanInput[] | null
}): {
  targets: TargetPlanInput[]
  takeProfit: number
  takeProfitPct: number
  riskRewardRatio: number | null
} {
  // Das Kursziel ist die ÄUSSERSTE Stufe, die Teilziele liegen davor, und der
  // nicht verteilte Rest gehört dem Kursziel. Alles in einer reinen Funktion —
  // siehe `buildTargetPlan` für den Grund, warum `takeProfit` nicht mehr die
  // nächstliegende Stufe trägt.
  const gestaffelt = buildTargetPlan({
    entry: input.entryPrice,
    stopLoss: input.stopLoss,
    direction: input.direction,
    kursziel: input.takeProfit,
    teilziele: input.targets ?? [],
  })
  const letzte = gestaffelt[gestaffelt.length - 1]

  return {
    // Eine einzige Stufe ist kein Staffel-Plan, sondern ein gewöhnlicher Trade:
    // Dann bleiben die Zeilen in `trade_target` leer und `effectiveTargets`
    // liest `takeProfit` wie bisher als die eine Stufe. So ändert sich für den
    // einfachen Fall nichts — weder in den Daten noch in der Anzeige.
    targets: gestaffelt.length > 1 ? gestaffelt : [],
    takeProfit: letzte.price,
    takeProfitPct: letzte.sharePct,
    riskRewardRatio:
      gestaffelt.length > 1
        ? blendedRiskReward({
            entry: input.entryPrice,
            stopLoss: input.stopLoss,
            targets: gestaffelt,
          })
        : computeRiskReward(input.entryPrice, input.stopLoss, letzte.price),
  }
}

/** Zeilen für `trade_target` aus dem geprüften Plan. Reihenfolge = Plan-Reihenfolge. */
function targetRows(
  tradeId: number,
  userId: string,
  targets: TargetPlanInput[],
): (typeof tradeTarget.$inferInsert)[] {
  return targets.map((t, i) => ({
    tradeId,
    userId,
    sortOrder: i,
    price: t.price,
    sharePct: t.sharePct,
    note: t.note ?? null,
  }))
}

/** Alle Stufen eines Trades, in Reihenfolge (owner-gefiltert). */
async function loadTradeTargets(userId: string, tradeId: number): Promise<TradeTargetRow[]> {
  return db
    .select()
    .from(tradeTarget)
    .where(and(eq(tradeTarget.tradeId, tradeId), eq(tradeTarget.userId, userId)))
    .orderBy(asc(tradeTarget.sortOrder), asc(tradeTarget.id))
}

/**
 * Create a planned trade. The shared pre-trade gate checks confirmed planning
 * prerequisites without requiring emotional neutrality or certainty. A
 * target/invalidation are all present.
 */
export async function createTrade(
  input: TradeInput,
): Promise<{ id: number; deckungsHinweis: string | null; planReady: boolean }> {
  const result = await createTradeForUser(await getUserId(), input)
  try { await createPlanAlerts(result.id, { kinds: ['einstieg'] }) } catch { /* Alert ist Beiwerk. */ }
  revalidatePath('/')
  revalidatePath('/trades')
  return result
}

async function loadOwnedTrade(userId: string, id: number): Promise<TradeRow> {
  const [t] = await db
    .select()
    .from(trade)
    .where(and(eq(trade.id, id), eq(trade.userId, userId)))
  if (!t) throw new Error('Trade nicht gefunden.')
  return t
}

// ---------------------------------------------------------------------------
// Event-Log (Etappe 6)
// ---------------------------------------------------------------------------

/** Alle Events eines Trades, chronologisch (owner-gefiltert). */
async function loadTradeEvents(userId: string, tradeId: number): Promise<TradeEventRow[]> {
  return db
    .select()
    .from(tradeEvent)
    .where(and(eq(tradeEvent.tradeId, tradeId), eq(tradeEvent.userId, userId)))
    .orderBy(asc(tradeEvent.at), asc(tradeEvent.id))
}

/** Events aller Trades eines Nutzers, nach tradeId gruppiert — für die
 *  event-aware Statistik (computeDisciplineStats/-Equity/-Mood). */
async function loadEventsByTrade(userId: string): Promise<TradeEventsByTrade> {
  const rows = await db.select().from(tradeEvent).where(eq(tradeEvent.userId, userId))
  const map: TradeEventsByTrade = new Map()
  for (const e of rows) {
    const arr = map.get(e.tradeId)
    if (arr) arr.push(e)
    else map.set(e.tradeId, [e])
  }
  return map
}

/** Werte für das eröffnende Event, aus der Trade-Zeile abgeleitet. Wird beim
 *  Aktivieren geschrieben und — falls es fehlt (Trade vor Etappe 6 aktiviert) —
 *  von den Etappe-6-Aktionen nachgezogen, damit Settlement und Timeline
 *  vollständig sind. Der Einstiegskurs im Event ist der URSPRÜNGLICHE Plan-Einstieg;
 *  ein späterer Nachkauf verschiebt nur den Row-Durchschnitt, nicht dieses Event. */
function openedEventValues(t: TradeRow, userId: string, over: Partial<TradeEventInsert> = {}) {
  return {
    tradeId: t.id,
    userId,
    type: 'eroeffnet' as const,
    at: t.openedAt ?? new Date(),
    quantity: t.positionSize ?? null,
    price: t.entryPrice ?? null,
    fee: t.tradedWithMoney ? (t.feeEntry ?? 0) : 0,
    payload: null,
    note: null,
    ...over,
  }
}

type TradeEventInsert = typeof tradeEvent.$inferInsert

/** Positiver Zahlenwert erzwingen (Menge/Kurs) — sonst sprechender Abbruch. */
function requirePositive(v: number | null | undefined, msg: string): number {
  if (v == null || !Number.isFinite(v) || v <= 0) throw new Error(msg)
  return v
}

/**
 * Activate a planned trade. Requires the 4-questions gate to be satisfied and
 * the Emotions-Check-in (Etappe 4) — der Zustand wird im Moment des Einstiegs
 * festgehalten, nicht rückwirkend erinnert.
 * Returns a Revenge-Guard warning if a loss was closed within the cooldown.
 */
export async function listTradeTargets(id: number): Promise<TradeTargetRow[]> {
  const userId = await getUserId()
  await loadOwnedTrade(userId, id) // Autorisierung
  return loadTradeTargets(userId, id)
}

/**
 * Die Stufen MEHRERER Trades in einem Zug — für Ansichten, die viele Pläne
 * nebeneinander zeigen (Chart-Overlay, Plan-Leiste). Eine Abfrage je Trade wäre
 * dort eine Abfrage je Chartlinie.
 */
export async function listTargetsForTrades(tradeIds: number[]): Promise<TradeTargetRow[]> {
  const userId = await getUserId()
  if (tradeIds.length === 0) return []
  return db
    .select()
    .from(tradeTarget)
    .where(and(eq(tradeTarget.userId, userId), inArray(tradeTarget.tradeId, tradeIds)))
    .orderBy(asc(tradeTarget.tradeId), asc(tradeTarget.sortOrder))
}

/**
 * Die Anfangsposition eines Trades — Bezugsgröße für die Anteile der Stufen.
 *
 * Bewusst die Menge des eröffnenden Ereignisses und nicht die aktuelle: Der
 * Staffelplan wurde auf der Anfangsposition gemacht, nur so ergeben 50/30/20
 * zusammen wieder die ganze Position. Ein späterer Nachkauf verschiebt die
 * Stufen nicht — er vergrößert den Rest, der über die letzte Stufe hinausläuft.
 */
function basisQuantity(t: TradeRow, events: TradeEventRow[]): number {
  const opened = events.find((e) => e.type === 'eroeffnet')
  return opened?.quantity ?? t.positionSize ?? 0
}

/**
 * Eine geplante Zielstufe ausführen (Etappe 13) — der Teilverkauf, der schon vor
 * dem Einstieg beschlossen war. Er läuft über denselben Weg wie `partialClose`
 * (ein `teilverkauf`-Event), trägt aber zusätzlich seine Stufe ab, damit der Plan
 * sichtbar abgearbeitet wird statt im Log zu verschwinden.
 *
 * Die LETZTE Stufe, die die Position vollständig schließen würde, läuft bewusst
 * NICHT hier durch: Am vollständigen Ausstieg hängen die Douglas-Guards
 * (bewusste Verlustannahme, Emotions-Check-in, Plan-Treue). Sie gehört über
 * `closeTrade` — die Oberfläche öffnet dafür den Abschluss-Dialog mit dem Kurs
 * dieser Stufe und reicht `targetId` mit.
 */
export async function listEventsForTrades(tradeIds: number[]): Promise<TradeEventRow[]> {
  const userId = await getUserId()
  if (tradeIds.length === 0) return []
  return db
    .select()
    .from(tradeEvent)
    .where(and(eq(tradeEvent.userId, userId), inArray(tradeEvent.tradeId, tradeIds)))
    .orderBy(asc(tradeEvent.tradeId), asc(tradeEvent.at), asc(tradeEvent.id))
}

/** Alle Events eines Trades für die Timeline (owner-gefiltert, chronologisch). */
export async function listTradeEvents(id: number): Promise<TradeEventRow[]> {
  const userId = await getUserId()
  await loadOwnedTrade(userId, id) // Autorisierung
  return loadTradeEvents(userId, id)
}

/**
 * Mark a planned setup as "kein Handel": the entry/target zone was never reached
 * (or was set wrong), so no trade happened. Terminal state — neutral for win-rate,
 * expectancy, P&L and the hit-rate curve (none of those count it). Feeds the
 * separate Zonen-Trefferquote via getZoneStats().
 */
async function markNoTradeImpl(id: number, note?: string | null): Promise<void> {
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

async function abortTradeImpl(id: number): Promise<void> {
  const userId = await getUserId()
  const t = await loadOwnedTrade(userId, id)
  if (!['geplant', 'aktiv'].includes(t.status)) throw new Error('Trade ist bereits beendet.')
  const closedAt = new Date()
  const wasActive = t.status === 'aktiv'

  await db.transaction(async (tx) => {
    await tx
      .update(trade)
      .set({ status: 'abgebrochen', closedAt })
      .where(and(eq(trade.id, id), eq(trade.userId, userId)))

    // Ein abgebrochener AKTIVER Trade schließt seine offene Position ohne
    // Ausstiegskurs — als Abschluss-Event für die Chronik. Ein geplanter Trade
    // hatte nie eine Position und braucht kein Event.
    if (wasActive) {
      const events = await loadTradeEvents(userId, id)
      const remaining = events.length ? settlePosition(t, events).openQty : (t.positionSize ?? 0)
      await tx.insert(tradeEvent).values({
        tradeId: id,
        userId,
        type: 'geschlossen',
        at: closedAt,
        quantity: remaining,
        price: null,
        note: 'Abgebrochen',
      })
    }
  })
  revalidatePath('/')
  revalidatePath('/trades')
}

async function deleteTradeImpl(id: number): Promise<void> {
  const userId = await getUserId()
  await db.transaction(async (tx) => {
    // Events und Stufen zuerst entfernen — sonst blieben verwaiste Zeilen stehen.
    await tx.delete(tradeEvent).where(and(eq(tradeEvent.tradeId, id), eq(tradeEvent.userId, userId)))
    await tx.delete(tradeTarget).where(and(eq(tradeTarget.tradeId, id), eq(tradeTarget.userId, userId)))
    await tx.delete(trade).where(and(eq(trade.id, id), eq(trade.userId, userId)))
  })
  revalidatePath('/')
  revalidatePath('/trades')
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Der gemeinsame Ladeweg JEDER Kennzahl (Etappe 12).
 *
 * Vorher stand in acht Loadern dieselbe Abfrage — und alle acht zogen jeden
 * abgeschlossenen Trade des Nutzers, egal ob echtes Geld oder Übung. Nur die
 * Geldsummen filterten danach noch; Trefferquote, Erwartungswert, Disziplin,
 * Monte-Carlo, Setups, Zeit und Zustand nicht. Dass es acht Kopien gab, war
 * nicht der Auslöser des Fehlers, aber der Grund, warum er so lange unbemerkt
 * blieb: Man hätte ihn achtmal bemerken müssen.
 *
 * Deshalb gibt es ihn jetzt einmal. Wer eine neue Auswertung baut, holt Zeilen
 * hier — Startkapital und Zahlungen kommen aus derselben Auswahl wie die Trades,
 * sonst würde eine Rendite gegen fremdes Kapital gemessen.
 */
type ScopedStats = {
  rows: TradeRow[]
  eventsByTrade: TradeEventsByTrade
  cashflows: CashflowRow[]
  startCapital: number
}

async function loadScopedStats(
  userId: string,
  opts: { onlyCompleted?: boolean; startCapitalOverride?: number } = {},
): Promise<ScopedStats> {
  const { portfolioIds, startCapital } = await loadScopeContext(userId)
  const scope = tradeScopeWhere(userId, portfolioIds)

  const rows = await db
    .select()
    .from(trade)
    .where(opts.onlyCompleted ? and(scope, eq(trade.status, 'abgeschlossen')) : scope)
    .orderBy(asc(trade.closedAt), asc(trade.id))

  return {
    rows,
    eventsByTrade: await loadEventsByTrade(userId),
    cashflows: await loadScopedCashflows(userId, portfolioIds),
    startCapital: Number.isFinite(startCapital) ? opts.startCapitalOverride ?? startCapital : NaN,
  }
}

export async function listTrades(): Promise<TradeRow[]> {
  const userId = await getUserId()
  const { portfolioIds } = await loadScopeContext(userId)
  return db
    .select()
    .from(trade)
    .where(tradeScopeWhere(userId, portfolioIds))
    .orderBy(desc(trade.createdAt))
}

/**
 * All trades linked to a given instrument (by stockId), newest first.
 *
 * Gefiltert wird auch hier auf die aktive Auswahl: Die Instrumentenkarte trennt
 * Echtgeld und Demo zwar in getrennte Spalten, aber ein Demo-Trade aus einem
 * Depot, das gerade nicht angeschaut wird, gehört nicht in die Karte.
 */
export async function getInstrumentTrades(stockId: number): Promise<TradeRow[]> {
  const userId = await getUserId()
  const { portfolioIds } = await loadScopeContext(userId)
  return db
    .select()
    .from(trade)
    .where(and(tradeScopeWhere(userId, portfolioIds), eq(trade.stockId, stockId)))
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
 * Douglas discipline + expectancy stats über die abgeschlossenen Trades
 * DER AKTIVEN AUSWAHL.
 *
 * Startkapital kommt aus dem Depot (optionaler Override für Tests). Bis Etappe 12
 * mischten Disziplin-Score, Trefferquote, Erwartungswert und Plan-Streak hier
 * Echtgeld und Übung — nur die Geldsummen filterten.
 */
export async function getDisciplineStats(startCapitalOverride?: number): Promise<DisciplineStats> {
  const userId = await getUserId()
  const { rows, startCapital, cashflows, eventsByTrade } = await loadScopedStats(userId, {
    onlyCompleted: true,
    startCapitalOverride,
  })
  return computeDisciplineStats(rows, startCapital, cashflows, eventsByTrade)
}

export type GroupStats = {
  completed: number
  wins: number
  losses: number
  hitRate: number // 0-100 über entschiedene Trades (gewinn|verlust)
  avgPnL: number // Ø P&L je entschiedenem Trade
  totalPnL: number
}

/** Eine Zeile des Depot-Vergleichs. */
export type PortfolioGroup = {
  currency: string
  portfolioId: number
  name: string
  /** 'echtgeld' | 'demo' — steuert die PAPIERGELD-Kennzeichnung. */
  kind: string
  archived: boolean
  stats: GroupStats
}

/**
 * Trefferquote und Ø Gewinn je Trade — eine Zeile JE DEPOT.
 *
 * Nachfolger von `getMoneyVsPaperStats`. Der alte Zuschnitt „Echtgeld vs. Demo"
 * war die einzige Trennung, die es gab, und deshalb zwangsläufig zweispaltig.
 * Mit echten Depots ist die interessante Frage eine andere: Wie schlägt sich
 * Broker A gegen Broker B, und wie das Übungsdepot gegen beide?
 *
 * **Dieser Block ignoriert die aktive Auswahl bewusst** — er ist der eine Ort,
 * der über die Depots hinwegschaut, denn Vergleichen ist sein Zweck. Das ist
 * kein Rückfall in den alten Fehler: Jede Zeile trägt ihren Namen und ihre Art,
 * es wird nichts zu einer einzigen Zahl vermischt.
 */
export async function getPortfolioComparison(): Promise<PortfolioGroup[]> {
  const userId = await getUserId()
  const portfolios = await ensurePortfolios(userId)
  const settings = await getSettings()

  const rows = await db
    .select()
    .from(trade)
    .where(and(eq(trade.userId, userId), eq(trade.status, 'abgeschlossen')))
  const eventsByTrade = await loadEventsByTrade(userId)
  const evs = (t: TradeRow) => eventsByTrade.get(t.id) ?? []

  const group = (list: TradeRow[]): GroupStats => {
    const wins = list.filter((t) => t.result === 'gewinn').length
    const losses = list.filter((t) => t.result === 'verlust').length
    const decisive = wins + losses
    // Trades ohne Ausstiegskurs haben keinen berechenbaren P&L und zählen nicht mit.
    // Event-aware: Teilverkäufe/Nachkäufe fließen über tradeNetPnl korrekt ein.
    const complete = list.every(t => tradeNetPnl(t, evs(t)) !== null)
    const totalPnL = complete ? list
      .filter((t) => tradeNetPnl(t, evs(t)) !== null)
      .reduce((acc, t) => acc + (tradeNetPnl(t, evs(t)) ?? 0), 0) : NaN
    return {
      completed: list.length,
      wins,
      losses,
      hitRate: decisive ? (wins / decisive) * 100 : 0,
      avgPnL: decisive ? totalPnL / decisive : 0,
      totalPnL,
    }
  }

  return portfolios.map((p) => ({
    portfolioId: p.id,
    currency: portfolioCurrency(p, settings.currency),
    name: p.name,
    kind: p.kind,
    archived: p.archivedAt != null,
    stats: group(rows.filter((t) => t.portfolioId === p.id)),
  }))
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
  const { portfolioIds } = await loadScopeContext(userId)
  // Prognosen (`assessment`) bleiben kontoweit — sie hängen an keinem Depot, weil
  // in ihnen kein Geld steckt. Die Trade-Seite folgt der Auswahl.
  const tradeRows = await db
    .select({ openedAt: trade.openedAt, status: trade.status })
    .from(trade)
    .where(tradeScopeWhere(userId, portfolioIds))
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

  // Nur die Trades der aktiven Auswahl: Diese Kurve mischt bereits Prognosen und
  // Trades — sie darf nicht zusätzlich Übung und Ernst mischen.
  const { portfolioIds } = await loadScopeContext(userId)
  const trades = await db
    .select()
    .from(trade)
    .where(and(tradeScopeWhere(userId, portfolioIds), eq(trade.status, 'abgeschlossen')))

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
 * Equity-Kurve, Max-Drawdown und Verlust-Serien der aktiven Auswahl,
 * chronologisch nach Abschluss. Ein- und Auszahlungen erscheinen als eigene
 * Punkte und zählen nicht in den Drawdown (eine Auszahlung ist kein Verlust).
 *
 * Im Demo-Depot rechnet dieselbe Kurve gegen das PAPIER-Startkapital — deshalb
 * hat die Übung jetzt eine eigene Bilanz statt gar keiner. Dass es Papiergeld
 * ist, sagt die Kennzeichnung in der Oberfläche, nicht eine andere Rechnung.
 */
export async function getEquityStats(): Promise<EquityStats> {
  const userId = await getUserId()
  const { rows, startCapital, cashflows, eventsByTrade } = await loadScopedStats(userId, {
    onlyCompleted: true,
  })
  return computeEquityStats(rows, startCapital, cashflows, eventsByTrade)
}

/**
 * Zustand vs. Ergebnis (Etappe 4) — über alle abgeschlossenen Trades.
 *
 * Die Rechnung selbst liegt in `computeMoodStats` (rein, getestet); hier werden
 * nur die Zeilen geladen. Trades ohne Check-in bleiben enthalten, damit die
 * Abdeckungsangabe stimmt — sie landen in keiner Zustands-Gruppe.
 */
export async function getMoodStats(): Promise<MoodStats> {
  const userId = await getUserId()
  const { rows, eventsByTrade } = await loadScopedStats(userId, { onlyCompleted: true })
  return computeMoodStats(rows, eventsByTrade)
}

/**
 * Monte-Carlo-Simulation der nächsten Trades (Etappe 7a).
 *
 * Grundlage ist ausschließlich die **eigene** R-Verteilung der abgeschlossenen
 * Trades — dieselbe Auswahl, aus der auch der Erwartungswert entsteht. Die
 * Rechnung selbst liegt in `lib/monte-carlo.ts` (rein, seed-fest, getestet);
 * hier werden nur die Zeilen geladen und die drei Eingangsgrößen bestimmt:
 * R-Verteilung, typisches Risiko je Trade (für die Prozentangabe) und die
 * längste tatsächlich erlebte Verlust-Serie (für die Einordnung).
 */
export async function getMonteCarloStats(): Promise<MonteCarloStats> {
  const userId = await getUserId()
  const { rows, startCapital, cashflows, eventsByTrade } = await loadScopedStats(userId, {
    onlyCompleted: true,
  })
  const invested = startCapital + netCashflow(cashflows)

  return simulateFuture({
    rMultiples: ratedRMultiples(rows, eventsByTrade),
    riskFraction: medianRiskFraction(rows, invested, eventsByTrade),
    // Die erlebte Serie kommt aus derselben Quelle wie die Anzeige daneben.
    observedLossStreak: computeEquityStats(rows, startCapital, cashflows, eventsByTrade)
      .worstLossStreak,
  })
}

/**
 * Setup-Vergleich (Etappe 7b) — über alle abgeschlossenen Trades.
 *
 * Die Rechnung liegt in `computeSetupStats` (rein, getestet); hier werden nur
 * die Zeilen geladen. Trades ohne Tags bleiben enthalten: sie bilden die Zeile
 * „ohne Angabe" und die Abdeckungsangabe — ein fehlendes Tag darf nicht stumm
 * verschwinden, sonst sähe die Auswertung vollständiger aus, als sie ist.
 */
export async function getSetupStats(): Promise<SetupStats> {
  const userId = await getUserId()
  const { rows, eventsByTrade } = await loadScopedStats(userId, { onlyCompleted: true })
  return computeSetupStats(rows, eventsByTrade)
}

/**
 * Zeit-Auswertung (Etappe 7d) — über alle abgeschlossenen Trades.
 *
 * Gerechnet wird in `computeTimeStats` (rein, getestet); hier werden nur die
 * Zeilen geladen. Trades ohne Einstiegszeit bleiben enthalten: sie zählen in die
 * Abdeckungsangabe, aber in keine Zelle — sonst sähe das Gitter dichter aus, als
 * es belegt ist.
 */
export async function getTimeStats(): Promise<TimeStats> {
  const userId = await getUserId()
  const { rows, eventsByTrade } = await loadScopedStats(userId, { onlyCompleted: true })
  return computeTimeStats(rows, eventsByTrade)
}

/**
 * Die bereits vergebenen Setup-Tags des Nutzers, häufigste zuerst — die
 * Vorschlagsliste der Eingabe-Maske.
 *
 * Absichtlich über **alle** Trades (nicht nur abgeschlossene): der persönliche
 * Katalog soll ab dem ersten geplanten Trade vollständig sein. Nur so klickt
 * man beim zweiten Mal dasselbe Tag an, statt einen Tippfehler-Zwilling
 * anzulegen — das ist der eigentliche Grund, warum aus Freitext Tags wurden.
 */
export async function listSetupTagOptions(): Promise<string[]> {
  const userId = await getUserId()
  // Bewusst KONTOWEIT und nicht je Depot: Das ist der persönliche Wortschatz des
  // Nutzers, keine Kennzahl. Ein „Breakout" heißt im Übungsdepot genauso wie im
  // echten, und eine je Depot getrennte Vorschlagsliste würde genau die
  // Tippfehler-Zwillinge erzeugen, gegen die die Tags erfunden wurden.
  const rows = await db
    .select({ setupTags: trade.setupTags })
    .from(trade)
    .where(eq(trade.userId, userId))

  return rankSetupTags(rows.map((r) => r.setupTags)).map((t) => t.label)
}

/**
 * Setup-Tags eines Trades setzen — auch bei bereits abgeschlossenen Trades.
 *
 * Bewusst NICHT über `updateTradePlan`: der lehnt abgeschlossene Trades ab, und
 * das zu Recht — am Plan eines gelaufenen Trades wird nichts mehr gedreht. Ein
 * Tag ist aber kein Planbestandteil, sondern eine Einordnung: es verändert
 * weder Risiko noch Ergebnis noch eine Geldkennzahl, sondern nur die Zeile, in
 * der der Trade in der Auswertung erscheint. Ohne diesen Weg bliebe die
 * gesamte Historie unauswertbar und der Setup-Vergleich müsste bei null
 * anfangen — genau deshalb ist der alte Freitext als Vorlage erhalten
 * geblieben.
 */
export async function updateTradeSetupTags(id: number, tags: string[]): Promise<void> {
  const userId = await getUserId()
  await loadOwnedTrade(userId, id) // wirft, wenn der Trade nicht dem Nutzer gehört

  await db
    .update(trade)
    .set({ setupTags: serializeSetupTags(tags) })
    .where(and(eq(trade.id, id), eq(trade.userId, userId)))

  revalidatePath('/trades')
  revalidatePath(`/trades/${id}`)
  revalidatePath('/tracking')
}

// ---------------------------------------------------------------------------
// CSV-Export
// ---------------------------------------------------------------------------

/**
 * Trade-Journal als CSV (Semikolon-getrennt, für Excel/DE-Locale).
 *
 * Exportiert wird die AKTIVE AUSWAHL — wer das Demo-Depot ansieht, bekommt das
 * Demo-Depot. Die Spalte `depot` steht neben `echtgeld`: Letztere bleibt für die
 * Vergleichbarkeit mit älteren Exporten erhalten, die Depot-Spalte sagt, woraus
 * sie sich ergibt.
 */
export async function exportTradesCsv(): Promise<string> {
  const userId = await getUserId()
  const { portfolioIds, portfolios } = await loadScopeContext(userId)
  const rows = await db
    .select()
    .from(trade)
    .where(tradeScopeWhere(userId, portfolioIds))
    .orderBy(asc(trade.createdAt), asc(trade.id))
  const eventsByTrade = await loadEventsByTrade(userId)
  const depotName = new Map(portfolios.map((p) => [p.id, p.name]))

  const headerCols = [
    'id', 'ticker', 'markt', 'richtung', 'status', 'depot', 'echtgeld',
    'einstieg', 'stop', 'ziel', 'stueckzahl', 'kapitaleinsatz',
    'hebel', 'gebuehr_kauf', 'gebuehr_verkauf',
    'ergebnis', 'ausstieg', 'netto_pnl', 'plan_befolgt', 'regelbrueche',
    'wellengrad', 'wellenzaehlung',
    // Setup-Tags (Etappe 7b) — die Gruppierung des Setup-Vergleichs; mit '|'
    // verkettet wie die Emotions-Tags, damit beide Spalten gleich zu lesen sind.
    'setups',
    // Emotions-Check-in (Etappe 4) — damit die Auswertung auch außerhalb der
    // App nachvollziehbar ist und nicht nur als fertige Quote erscheint.
    'zustand_einstieg', 'tags_einstieg', 'notiz_einstieg',
    'zustand_ausstieg', 'tags_ausstieg', 'notiz_ausstieg',
    'erstellt', 'geschlossen',
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
        depotName.get(t.portfolioId) ?? '',
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
        // Event-aware: bei Teilverkäufen/Nachkäufen der realisierte Gesamt-Netto.
        t.status === 'abgeschlossen'
          ? (tradeNetPnl(t, eventsByTrade.get(t.id) ?? [])?.toFixed(2) ?? '')
          : '',
        t.followedPlan == null ? '' : t.followedPlan ? 'ja' : 'nein',
        parseViolations(t.ruleViolations).join('|'),
        t.waveDegree ?? '',
        t.elliottWaveCount ?? '',
        parseSetupTags(t.setupTags).join('|'),
        moodScoreLabel(t.moodEntry) ?? '',
        parseMoodTags(t.moodEntryTags).join('|'),
        t.moodEntryNote ?? '',
        moodScoreLabel(t.moodExit) ?? '',
        parseMoodTags(t.moodExitTags).join('|'),
        t.moodExitNote ?? '',
        t.createdAt ? new Date(t.createdAt).toISOString() : '',
        t.closedAt ? new Date(t.closedAt).toISOString() : '',
      ]
        .map(esc)
        .join(';'),
    )
  }
  return lines.join('\n')
}

// Shared ordering and transaction lock for manual position/plan changes.
export async function activateTrade(...args: Parameters<typeof activateTradeForUser> extends [string, ...infer A] ? A : never) {
  const userId = await getUserId()
  return withManualTrade(userId, args[0], () => activateTradeForUser(userId, ...args))
}

export async function updateTradePlan(...args: Parameters<typeof updateTradePlanForUser> extends [string, ...infer A] ? A : never) {
  const userId = await getUserId()
  return withManualTrade(userId, args[0], () => updateTradePlanForUser(userId, ...args))
}

export async function closeTrade(...args: Parameters<typeof closeTradeForUser> extends [string, ...infer A] ? A : never) {
  const userId = await getUserId()
  return withManualTrade(userId, args[0], () => withEventContext(args[1].at ? actualTime(args[1].at) : new Date(), {kind: 'user_statement', capturedAt: new Date().toISOString(), confirmedByUser: true}, undefined, () => closeTradeForUser(userId, ...args)))
}

export async function partialClose(...args: Parameters<typeof partialCloseForUser> extends [string, ...infer A] ? A : never) {
  const userId = await getUserId()
  return withManualTrade(userId, args[0], () => partialCloseForUser(userId, ...args))
}

export async function addToPosition(...args: Parameters<typeof addToPositionForUser> extends [string, ...infer A] ? A : never) {
  const userId = await getUserId()
  return withManualTrade(userId, args[0], () => addToPositionForUser(userId, ...args))
}

export async function executeTarget(...args: Parameters<typeof executeTargetForUser> extends [string, ...infer A] ? A : never) {
  const userId = await getUserId()
  return withManualTrade(userId, args[0], () => executeTargetForUser(userId, ...args))
}

export async function markNoTrade(...args: Parameters<typeof markNoTradeImpl>) {
  return withManualTrade(await getUserId(), args[0], () => markNoTradeImpl(...args))
}

export async function abortTrade(...args: Parameters<typeof abortTradeImpl>) {
  return withManualTrade(await getUserId(), args[0], () => abortTradeImpl(...args))
}

export async function deleteTrade(...args: Parameters<typeof deleteTradeImpl>) {
  return withManualTrade(await getUserId(), args[0], () => deleteTradeImpl(...args), { boundary: false })
}
