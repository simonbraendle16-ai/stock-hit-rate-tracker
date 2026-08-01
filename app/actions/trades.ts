'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { priceAlert, trade, tradeEvent, tradeTarget, assessment, stock } from '@/lib/db/schema'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { PRE_TRADE_QUESTIONS, type PreTradeAnswer } from '@/lib/pre-trade-questions'
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
  hasPartialSale,
  isRiskReducingStop,
  type TradeEventRow,
} from '@/lib/trade-events'
import {
  blendedRiskReward,
  effectiveTargets,
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
  // die 4 Douglas-Antworten (Gate = alle 'ja')
  preTradeAnswers?: PreTradeAnswer[]
  // Erfassungsweg: 'langfristig' (voller Weg) oder 'schnell' (ohne Fragen-Gate).
  // Regeln in `lib/trade-kind.ts`; Unbekanntes fällt auf den vollen Weg zurück.
  tradeKind?: TradeKind
}

const COOLDOWN_MIN = 60 // Revenge-Guard window

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
        ? 'Emotions-Check-in fehlt: Bitte auf der Skala 1–5 eintragen, wie ruhig du vor dem Einstieg bist.'
        : 'Emotions-Check-in fehlt: Bitte auf der Skala 1–5 eintragen, wie du aus dem Trade gehst.',
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
  takeProfit?: number | null
  takeProfitPct?: number | null
  targets?: TargetPlanInput[] | null
}): {
  targets: TargetPlanInput[]
  takeProfit: number | null
  takeProfitPct: number
  riskRewardRatio: number | null
} {
  const gestaffelt = normalizeTargets({
    entry: input.entryPrice,
    stopLoss: input.stopLoss,
    direction: input.direction,
    targets: input.targets ?? [],
  })

  if (gestaffelt.length > 0) {
    return {
      targets: gestaffelt,
      takeProfit: gestaffelt[0].price,
      takeProfitPct: gestaffelt[0].sharePct,
      riskRewardRatio: blendedRiskReward({
        entry: input.entryPrice,
        stopLoss: input.stopLoss,
        targets: gestaffelt,
      }),
    }
  }

  return {
    targets: [],
    takeProfit: input.takeProfit ?? null,
    takeProfitPct: input.takeProfitPct != null ? input.takeProfitPct : 100,
    riskRewardRatio: computeRiskReward(
      input.entryPrice,
      input.stopLoss,
      input.takeProfit ?? null,
    ),
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

  // Teilziele (Etappe 13): geprüft, sortiert und in die abgeleiteten Felder
  // übersetzt — VOR jedem Schreibzugriff, damit ein unmöglicher Staffelplan gar
  // nicht erst zu einem halben Trade führt.
  const zielPlan = resolveTargetPlan(input)

  // Optional link to an instrument in the watchlist (shared hit-rate key).
  //
  // Zuerst wie bisher über exakte Tickergleichheit — der Normalfall, ohne
  // Netzzugriff. Findet das nichts, greift die Zuordnung über das aufgelöste
  // Anbieter-Symbol (`lib/link-trades.ts`): So landet ein als `BTC` erfasster
  // Trade auch dann am Instrument `BTCUSD`, wenn die Kürzel abweichen. Ohne das
  // bliebe der Trade ohne `stockId` — und damit ohne Chart, ohne Kerzen, ohne
  // Bot-Zwilling und unsichtbar in jeder Instrumentensicht.
  let stockId: number | null = null
  const [existing] = await db
    .select({ id: stock.id })
    .from(stock)
    .where(and(eq(stock.userId, userId), eq(stock.ticker, ticker)))
  if (existing) {
    stockId = existing.id
  } else {
    try {
      const { findInstrumentFor } = await import('@/lib/link-trades')
      const instruments = await db
        .select({ id: stock.id, ticker: stock.ticker, providerSymbol: stock.providerSymbol })
        .from(stock)
        .where(eq(stock.userId, userId))
      const found = await findInstrumentFor(
        ticker,
        (input.market ?? 'aktien') as Market,
        instruments,
      )
      stockId = found.stockId
    } catch {
      // Auflösung nicht möglich (Anbieter weg) → Trade wird trotzdem angelegt.
      // Der Hintergrundlauf holt die Verknüpfung nach.
    }
  }

  // Erfassungsweg zuerst: er entscheidet, ob das Gate überhaupt gilt.
  const tradeKind = normalizeTradeKind(input.tradeKind)

  // Gate: nur wenn ALLE Douglas-Fragen mit 'ja' beantwortet sind.
  //
  // Beim schnellen Trade bleibt das Feld bewusst `false` — es wird nicht
  // stillschweigend auf `true` gesetzt, denn die Fragen wurden ja nicht
  // beantwortet. Dass der Trade trotzdem aktivierbar ist, entscheidet allein
  // `requiresPreTradeGate(tradeKind)` beim Aktivieren. So bleibt in den Daten
  // sichtbar, was tatsächlich passiert ist.
  const answers = input.preTradeAnswers ?? []
  const preTradeAnswered =
    answers.length === PRE_TRADE_QUESTIONS.length &&
    answers.every((a) => a.answer === 'ja')

  // Live-CRV — bei Teilzielen der nach Anteilen gewichtete Wert (siehe
  // `resolveTargetPlan`), sonst wie bisher das Verhältnis zum einen Ziel.
  const riskRewardRatio = zielPlan.riskRewardRatio

  // Stückzahl aus Einsatz und Hebel ableiten (Basis der P&L-Rechnung). Der Hebel
  // steckt danach in positionSize und wirkt dadurch automatisch in Risiko, Guard
  // und Statistik mit.
  //
  // Der Einsatz wird AUCH bei Demo gespeichert: Wer auf Papier mit Hebel übt,
  // übt nur dann etwas Übertragbares, wenn Positionsgröße und Hebel dieselben
  // sind wie später mit echtem Geld. Es bleibt Übungsgeld — jede Geldkennzahl
  // (Bilanz, Equity, Drawdown, Risiko-Guard) filtert weiterhin auf
  // `tradedWithMoney`, und Gebühren fallen auf Papier keine an. Das
  // R-Vielfache ist von der Stückzahl unabhängig (Gewinn und Risiko skalieren
  // gleich), Disziplin- und Erwartungswert-Kennzahlen ändern sich dadurch nicht.
  // Das Depot bestimmt die Handelsart — nicht der Browser (Etappe 12).
  //
  // Vorher stand hier `input.tradedWithMoney ?? true`: ein Formularwert mit
  // Vorbelegung „Echtgeld". Ein vergessener Klick, und ein Papier-Trade zählte
  // als echt. Genau das ist passiert, und es hat die ganze Auswertung verdorben.
  // Ab jetzt ist die Handelsart die Schreibweise von `portfolio.kind`; ein
  // Papier-Trade in einem Echtgeld-Depot ist strukturell unmöglich.
  //
  // `loadOwnedPortfolio` wirft bei fremdem oder unbekanntem Depot: Eine
  // `portfolioId` aus dem Browser ist eine Behauptung, keine Tatsache.
  const zielDepot = await resolveZielDepot(userId, input.portfolioId)
  const withMoney = kindOf(zielDepot) === 'echtgeld'

  const investedAmount = input.investedAmount ?? null
  const leverage = normalizeLeverage(input.leverage)
  const positionSize =
    investedAmount != null
      ? computeShares(investedAmount, input.entryPrice, leverage)
      : (input.positionSize ?? null)
  const takeProfitPct = zielPlan.takeProfitPct

  // Geplante Gebühren: Vorbelegung aus dem DEPOT (verschiedene Broker kosten
  // verschieden), im Formular überschreibbar. Bei Demo fallen keine an.
  const feeEntry = withMoney ? normalizeFee(input.feeEntry, zielDepot.defaultFeeEntry) : 0
  const feeExit = withMoney ? normalizeFee(input.feeExit, zielDepot.defaultFeeExit) : 0

  const [row] = await db.transaction(async (tx) => {
    const [angelegt] = await tx
      .insert(trade)
      .values({
        userId,
        portfolioId: zielDepot.id,
        stockId,
        ticker,
        market: input.market ?? 'aktien',
        tradeKind,
        direction: input.direction,
        entryPrice: input.entryPrice,
        stopLoss: input.stopLoss,
        // Abgeleitet: bei Teilzielen der Kurs der ersten Stufe (siehe `resolveTargetPlan`).
        takeProfit: zielPlan.takeProfit,
        positionSize,
        investedAmount,
        leverage,
        feeEntry,
        feeExit,
        takeProfitPct,
        strategy: input.strategy?.trim() || null,
        setupTags: serializeSetupTags(input.setupTags),
        broker: input.broker?.trim() || null,
        riskRewardRatio,
        notes: input.notes?.trim() || null,
        status: 'geplant',
        elliottWaveCount: input.elliottWaveCount?.trim() || null,
        waveDegree: input.waveDegree?.trim() || null,
        elliottInvalidation: input.elliottInvalidation ?? null,
        preTradeAnswered,
        preTradeAnswers: answers.length ? JSON.stringify(answers) : null,
        // Abgeleitet aus dem Depot, siehe oben. Einer von genau zwei Orten, an
        // denen diese Spalte geschrieben wird (der andere ist `moveTrade`).
        tradedWithMoney: withMoney,
      })
      .returning({ id: trade.id })

    // Die Stufen gehören in dieselbe Transaktion wie der Trade: ein Trade, dessen
    // Staffelplan nur halb geschrieben wurde, wäre ein Plan, den niemand gefasst hat.
    if (zielPlan.targets.length > 0) {
      await tx.insert(tradeTarget).values(targetRows(angelegt.id, userId, zielPlan.targets))
    }
    return [angelegt]
  })

  // Etappe 14: Der Wecker auf den EINSTIEG entsteht sofort mit dem Plan — nicht
  // erst beim Aktivieren, wie bis Etappe 13. Das war der eigentliche Fehler:
  // Genau in der Zeit, in der man auf den Einstieg wartet, meldete sich nichts.
  //
  // Stop und Ziel kommen erst beim Aktivieren dazu; sie gehören zu einer
  // Position, die es noch nicht gibt.
  //
  // Fehlertolerant: Ein Wecker ist Beiwerk, ein angelegter Trade ist die
  // Hauptsache. Ist der Kurs gerade nicht abrufbar, bleibt der Trade bestehen —
  // nachrüsten lässt er sich jederzeit über „Wecker für alle offenen Pläne".
  try {
    await createPlanAlerts(row.id, { kinds: ['einstieg'] })
  } catch {
    // bewusst still — siehe oben
  }

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
export async function activateTrade(
  id: number,
  mood: MoodCheckInput,
  // Etappe 3: auf Wunsch beim Aktivieren Kurs-Alerts aus dem Plan ableiten
  // (Stop/Ziel/Einstieg). Bewusst optional — der Kernvorgang bleibt unverändert.
  opts?: { createPlanAlerts?: boolean },
): Promise<{ revengeWarning: boolean; alertsCreated: number }> {
  const userId = await getUserId()
  const t = await loadOwnedTrade(userId, id)
  if (t.status !== 'geplant') throw new Error('Nur geplante Trades können aktiviert werden.')
  // Das Fragen-Gate gilt nur auf dem vollen Weg. Ein schneller Trade überspringt
  // es bewusst (siehe `lib/trade-kind.ts`) — er bleibt aber als solcher
  // gekennzeichnet, damit später niemand Disziplin unterstellt, wo keine
  // geprüft wurde.
  if (requiresPreTradeGate(t.tradeKind) && !t.preTradeAnswered) {
    throw new Error('Erst die 4 Douglas-Fragen beantworten (Wellenzählung, Einstieg, Stop, Ziel/Invalidation).')
  }
  const checkIn = moodForKind(t.tradeKind, mood, 'entry')

  // Revenge-Guard: any loss closed within the cooldown window?
  //
  // Seit Etappe 12 nur Verluste im SELBEN Depot. Sonst hinge einem echten Trade
  // der Regelbruch `revenge` an, weil eine Stunde vorher ein Übungstrade im
  // Demo-Depot ins Minus lief — eine Übung würde die echte Disziplin-Bilanz
  // belasten, also genau der Fehler, den diese Etappe behebt. Umgekehrt gilt es
  // genauso: Ein realer Verlust markiert keinen Papier-Trade.
  const [lastLoss] = await db
    .select({ closedAt: trade.closedAt })
    .from(trade)
    .where(
      and(
        eq(trade.userId, userId),
        eq(trade.portfolioId, t.portfolioId),
        eq(trade.result, 'verlust'),
      ),
    )
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

  const openedAt = new Date()
  await db.transaction(async (tx) => {
    await tx
      .update(trade)
      .set({
        status: 'aktiv',
        openedAt,
        ruleViolations: JSON.stringify(violations),
        // Ohne Check-in (schneller Trade) bleiben die Felder leer, statt eine
        // Momentaufnahme zu erfinden — dieselbe Haltung wie beim Altbestand.
        ...(checkIn
          ? {
              moodEntry: checkIn.score,
              moodEntryTags: serializeMoodTags(checkIn.tags),
              moodEntryNote: checkIn.note,
            }
          : {}),
      })
      .where(and(eq(trade.id, id), eq(trade.userId, userId)))

    // Eröffnendes Event für die Chronik + als Anker fürs Settlement (Etappe 6).
    await tx.insert(tradeEvent).values(
      openedEventValues({ ...t, openedAt, positionSize: t.positionSize }, userId, {
        at: openedAt,
        note: 'Eröffnet',
      }),
    )
  })

  // Kurs-Alerts sind Beiwerk: ihre Erzeugung darf die Aktivierung nie scheitern
  // lassen (Kurs nicht abrufbar o. Ä.). Deshalb hier gekapselt und geschluckt.
  //
  // Etappe 14: Jetzt kommen STOP und ZIELE dazu — der Einstiegs-Wecker steht
  // schon seit dem Anlegen. `opts.createPlanAlerts` ist nur noch eine
  // Übersteuerung für diesen einen Vorgang; ob dauerhaft geweckt wird,
  // entscheidet `trade.alertsEnabled` (geprüft in `createPlanAlerts`).
  let alertsCreated = 0
  if (opts?.createPlanAlerts !== false) {
    try {
      const { created } = await createPlanAlerts(id, { kinds: ['stop', 'ziel'] })
      alertsCreated = created
    } catch {
      alertsCreated = 0
    }
  }

  revalidatePath('/')
  revalidatePath('/trades')
  revalidatePath('/tracking')
  return { revengeWarning, alertsCreated }
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

  // --- Teilziele (Etappe 13) ------------------------------------------------
  //
  // Ausgeführte Stufen sind unveränderlich: Sie sind bereits als Teilverkauf
  // abgerechnet, und ein Plan darf keine Geschichte umschreiben. Sie wandern
  // deshalb unverändert in den neuen Plan zurück und werden mitgeprüft — sonst
  // ließe sich über eine Planänderung mehr als 100 % der Position verplanen.
  const bestehendeZiele = await loadTradeTargets(userId, id)
  const ausgefuehrt = bestehendeZiele.filter((z) => z.executedAt != null)
  const nextDirection = t.direction
  const zielEntry = patch.entryPrice ?? t.entryPrice
  const zielStop = patch.stopLoss ?? t.stopLoss

  let neuerZielPlan: TargetPlanInput[] | null = null // null = Stufen bleiben, wie sie sind
  if (patch.targets !== undefined) {
    neuerZielPlan = normalizeTargets({
      entry: zielEntry,
      stopLoss: zielStop,
      direction: nextDirection,
      targets: [
        ...ausgefuehrt.map((z) => ({ price: z.price, sharePct: z.sharePct, note: z.note })),
        ...(patch.targets ?? []).filter(
          (n) => !ausgefuehrt.some((z) => Math.abs(z.price - n.price) < 1e-9),
        ),
      ],
    })
  } else if (bestehendeZiele.length > 0 && patch.takeProfit !== undefined) {
    // `takeProfit` ist an einem gestaffelten Trade die Schreibweise der ersten
    // Stufe, kein eigenes Feld. Es allein zu setzen würde die beiden Wahrheiten
    // auseinanderlaufen lassen — deshalb hier lieber laut abbrechen.
    throw new Error(
      'Dieser Trade hat Teilziele — der Take-Profit wird aus ihnen abgeleitet. ' +
        'Bitte die Stufen selbst ändern.',
    )
  } else if (bestehendeZiele.length > 0 && (patch.entryPrice != null || patch.stopLoss != null)) {
    // Einstieg oder Stop verschoben: Die Stufen bleiben stehen, aber das
    // gewichtete R:R gilt jetzt gegen ein anderes Risiko und wird nachgezogen.
    neuerZielPlan = bestehendeZiele.map((z) => ({
      price: z.price,
      sharePct: z.sharePct,
      note: z.note,
    }))
  }

  // Die abgeleiteten Felder der Trade-Zeile — nur wenn es Stufen gibt.
  const zielAbleitung =
    neuerZielPlan && neuerZielPlan.length > 0
      ? {
          takeProfit: neuerZielPlan[0].price,
          takeProfitPct: neuerZielPlan[0].sharePct,
          riskRewardRatio: blendedRiskReward({
            entry: zielEntry,
            stopLoss: zielStop,
            targets: neuerZielPlan,
          }),
        }
      : null

  const violations = parseViolations(t.ruleViolations)
  const levelEvents: TradeEventInsert[] = []
  if (t.status === 'aktiv') {
    const events = await loadTradeEvents(userId, id)
    const partialDone = hasPartialSale(events)
    const movesStop = patch.stopLoss != null && patch.stopLoss !== t.stopLoss
    const movesInval =
      patch.elliottInvalidation != null && patch.elliottInvalidation !== t.elliottInvalidation
    // Ein Ziel ist verschoben, wenn das Feld selbst wandert ODER wenn die
    // Staffel neu geplant wurde (dann ist die erste Stufe das neue Ziel).
    const zielVorher = t.takeProfit
    const zielNachher = zielAbleitung ? zielAbleitung.takeProfit : patch.takeProfit
    const staffelGeaendert =
      patch.targets !== undefined &&
      JSON.stringify((neuerZielPlan ?? []).map((z) => [z.price, z.sharePct])) !==
        JSON.stringify(bestehendeZiele.map((z) => [z.price, z.sharePct]))
    const movesTarget =
      (zielNachher != null && zielNachher !== zielVorher) || staffelGeaendert

    // Nach einem Teilverkauf ist risiko-REDUZIERENDES Stop-Nachziehen (Long höher /
    // Short tiefer, auch in den Profit) erlaubt und KEIN Regelbruch — der
    // Kern-Workflow „bei 1 R die Hälfte verkaufen, Stop auf Einstand ziehen".
    // Vor dem ersten Teilverkauf bleibt der Plan-Lock streng, das Aufweiten
    // (Risiko rauf) bleibt immer ein Regelbruch. Die Invalidation bleibt streng.
    const trailingAllowed =
      movesStop && partialDone && isRiskReducingStop(t.direction, t.stopLoss, patch.stopLoss!)
    const stopIsViolation = movesStop && !trailingAllowed

    if ((stopIsViolation || movesInval) && !force) {
      throw new Error(
        'Plan-Lock: Stop/Invalidation eines aktiven Trades nicht verschieben (Douglas). ' +
          'Mit force=true wird es als Regelbruch protokolliert.' +
          (movesStop && partialDone
            ? ' Ein risiko-reduzierendes Nachziehen nach einem Teilverkauf ist dagegen ohne force erlaubt.'
            : ''),
      )
    }
    if (stopIsViolation && !violations.includes('stop_moved')) violations.push('stop_moved')
    if (movesInval && !violations.includes('invalidation_ignored')) {
      violations.push('invalidation_ignored')
    }

    // Level-Änderungen für die Chronik festhalten (payload trägt alt→neu).
    if (movesStop) {
      levelEvents.push({
        tradeId: id,
        userId,
        type: 'stop_verschoben',
        at: new Date(),
        payload: JSON.stringify({ from: t.stopLoss, to: patch.stopLoss, violation: stopIsViolation }),
        note: trailingAllowed ? 'Stop nachgezogen (nach Teilverkauf)' : null,
      })
    }
    if (movesTarget) {
      levelEvents.push({
        tradeId: id,
        userId,
        type: 'ziel_geaendert',
        at: new Date(),
        payload: JSON.stringify({ from: zielVorher, to: zielNachher }),
        note: staffelGeaendert
          ? `Teilziele neu geplant (${(neuerZielPlan ?? []).length} Stufen)`
          : null,
      })
    }
    if (movesInval) {
      levelEvents.push({
        tradeId: id,
        userId,
        type: 'invalidation_ignoriert',
        at: new Date(),
        payload: JSON.stringify({ from: t.elliottInvalidation, to: patch.elliottInvalidation }),
      })
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

  await db.transaction(async (tx) => {
    await tx
      .update(trade)
      .set({
        ...(patch.entryPrice != null ? { entryPrice: patch.entryPrice } : {}),
        ...(patch.stopLoss != null ? { stopLoss: patch.stopLoss } : {}),
        // Mit Stufen kommen Ziel, Anteil und R:R aus dem Staffelplan; ohne
        // Stufen bleibt das Einzelfeld die Quelle wie bisher.
        ...(zielAbleitung
          ? {
              takeProfit: zielAbleitung.takeProfit,
              takeProfitPct: zielAbleitung.takeProfitPct,
              riskRewardRatio: zielAbleitung.riskRewardRatio,
            }
          : patch.takeProfit !== undefined
            ? { takeProfit: patch.takeProfit }
            : {}),
        ...(patch.investedAmount !== undefined ? { investedAmount: patch.investedAmount } : {}),
        ...(patch.leverage !== undefined ? { leverage: nextLeverage } : {}),
        ...(patch.feeEntry !== undefined ? { feeEntry: normalizeFee(patch.feeEntry, 0) } : {}),
        ...(patch.feeExit !== undefined ? { feeExit: normalizeFee(patch.feeExit, 0) } : {}),
        ...(!zielAbleitung && patch.takeProfitPct !== undefined
          ? { takeProfitPct: patch.takeProfitPct }
          : {}),
        // Ohne Stufen wird das R:R hier nachgezogen, sobald sich einer seiner
        // drei Bestandteile bewegt. Vorher blieb der beim Anlegen gespeicherte
        // Wert stehen — nach einer Planänderung stand damit eine Zahl in der
        // Karte, die zum Plan nicht mehr passte.
        ...(!zielAbleitung &&
        (patch.entryPrice != null || patch.stopLoss != null || patch.takeProfit !== undefined)
          ? {
              riskRewardRatio: computeRiskReward(
                zielEntry,
                zielStop,
                patch.takeProfit !== undefined ? patch.takeProfit : t.takeProfit,
              ),
            }
          : {}),
        ...(derivedSize !== undefined
          ? { positionSize: derivedSize }
          : patch.positionSize !== undefined
            ? { positionSize: patch.positionSize }
            : {}),
        ...(patch.strategy !== undefined ? { strategy: patch.strategy?.trim() || null } : {}),
        ...(patch.setupTags !== undefined
          ? { setupTags: serializeSetupTags(patch.setupTags) }
          : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes?.trim() || null } : {}),
        ...(patch.elliottWaveCount !== undefined
          ? { elliottWaveCount: patch.elliottWaveCount?.trim() || null }
          : {}),
        ...(patch.elliottInvalidation !== undefined
          ? { elliottInvalidation: patch.elliottInvalidation }
          : {}),
        // Die Handelsart wird hier NICHT mehr gesetzt (Etappe 12): Sie gehört zum
        // Depot, nicht zum Plan. Wer sie ändern will, bucht den Trade um
        // (`moveTrade`) — dann ist sichtbar, welche zwei Bilanzen sich bewegen,
        // statt dass eine Planänderung stillschweigend die Bilanz verschiebt.
        ruleViolations: JSON.stringify(violations),
      })
      .where(and(eq(trade.id, id), eq(trade.userId, userId)))

    // Stufen neu schreiben: die ausgeführten bleiben stehen (nur ihre Position in
    // der Reihenfolge wird nachgezogen), die offenen werden ersetzt. Gelöscht wird
    // ausschließlich Ungenutztes — eine abgerechnete Stufe verschwindet nie.
    if (neuerZielPlan) {
      for (const z of bestehendeZiele) {
        if (z.executedAt != null) continue
        await tx.delete(tradeTarget).where(
          and(eq(tradeTarget.id, z.id), eq(tradeTarget.userId, userId)),
        )
      }
      const neu: (typeof tradeTarget.$inferInsert)[] = []
      for (const [i, z] of neuerZielPlan.entries()) {
        const alt = ausgefuehrt.find((a) => Math.abs(a.price - z.price) < 1e-9)
        if (alt) {
          await tx
            .update(tradeTarget)
            .set({ sortOrder: i })
            .where(and(eq(tradeTarget.id, alt.id), eq(tradeTarget.userId, userId)))
        } else {
          neu.push({
            tradeId: id,
            userId,
            sortOrder: i,
            price: z.price,
            sharePct: z.sharePct,
            note: z.note ?? null,
          })
        }
      }
      if (neu.length) await tx.insert(tradeTarget).values(neu)
    }

    if (levelEvents.length) await tx.insert(tradeEvent).values(levelEvents)
  })

  // Etappe 14: Ein verschobenes Level macht seinen Wecker falsch — er würde eine
  // Marke melden, die nicht mehr im Plan steht. Deshalb: alte, noch nicht
  // ausgelöste Plan-Wecker der betroffenen Art entfernen und neu setzen.
  //
  // Nur nicht ausgelöste: Ein Wecker, der schon geklingelt hat, ist Geschichte
  // und wird nicht rückwirkend umgeschrieben.
  await syncPlanAlertsAfterEdit(userId, id, {
    entryChanged: patch.entryPrice != null && patch.entryPrice !== t.entryPrice,
    exitChanged:
      (patch.stopLoss != null && patch.stopLoss !== t.stopLoss) ||
      patch.takeProfit !== undefined ||
      patch.targets !== undefined,
  })

  revalidatePath('/')
  revalidatePath('/trades')
}

/**
 * Plan-Wecker nach einer Planänderung nachziehen (Etappe 14).
 *
 * Fehler beim Kursabruf werden geschluckt: Ein nicht neu gesetzter Wecker ist
 * ärgerlich, eine fehlgeschlagene Planänderung wäre schlimmer.
 */
async function syncPlanAlertsAfterEdit(
  userId: string,
  tradeId: number,
  changed: { entryChanged: boolean; exitChanged: boolean },
): Promise<void> {
  const kinds: AlertKind[] = []
  if (changed.entryChanged) kinds.push('einstieg')
  if (changed.exitChanged) kinds.push('stop', 'ziel')
  if (kinds.length === 0) return

  const [t] = await db
    .select({ status: trade.status, alertsEnabled: trade.alertsEnabled })
    .from(trade)
    .where(and(eq(trade.id, tradeId), eq(trade.userId, userId)))
  if (!t?.alertsEnabled) return

  await db
    .delete(priceAlert)
    .where(
      and(
        eq(priceAlert.userId, userId),
        eq(priceAlert.tradeId, tradeId),
        isNull(priceAlert.triggeredAt),
        inArray(priceAlert.kind, kinds),
      ),
    )

  // Nur die Arten neu setzen, die zum Stand des Trades passen: Ein geplanter
  // Trade bekommt keinen Stop-Wecker, auch wenn gerade der Stop geändert wurde.
  const passend = t.status === 'geplant' ? ['einstieg'] : ['stop', 'ziel']
  const zuSetzen = kinds.filter((k) => passend.includes(k))
  if (zuSetzen.length === 0) return

  try {
    await createPlanAlerts(tradeId, { kinds: zuSetzen })
  } catch {
    // siehe oben — der Plan ist bereits gespeichert
  }
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
    // Letzte Gelegenheit, die tatsächlich gezahlten Gebühren zu korrigieren —
    // danach sind sie eingefroren.
    feeEntry?: number | null
    feeExit?: number | null
    // Emotions-Check-in beim Ausstieg (Etappe 4) — Pflicht.
    mood: MoodCheckInput
    // Teilziel (Etappe 13), das mit diesem Abschluss abgetragen wird: die letzte
    // Stufe schließt die Position, und der vollständige Ausstieg gehört hierher,
    // damit die Guards greifen. Optional — ein Abschluss von Hand hat keine Stufe.
    targetId?: number | null
  },
): Promise<void> {
  const userId = await getUserId()
  const t = await loadOwnedTrade(userId, id)
  if (t.status === 'abgeschlossen' || t.status === 'abgebrochen') {
    throw new Error('Trade ist bereits abgeschlossen.')
  }
  const checkOut = moodForKind(t.tradeKind, data.mood, 'exit')
  // Die bewusste Verlustannahme gilt in BEIDEN Wegen. Sie ist kein
  // Formular-Ballast, sondern der Douglas-Kern beim Ausstieg — ein schneller
  // Trade darf sie so wenig überspringen wie den Stop.
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

  // Die Handelsart steht am Depot und wird beim Abschluss NICHT mehr geändert
  // (Etappe 12). Vorher konnte der Abschluss-Dialog sie umschalten — damit wäre
  // ein Trade nach dem Abrechnen in die andere Bilanz gesprungen, ohne dass es
  // irgendwo sichtbar war. Umbuchen geht ausschließlich über `moveTrade`.
  const withMoney = t.tradedWithMoney
  const frozenFeeEntry = withMoney ? normalizeFee(data.feeEntry, t.feeEntry ?? 0) : 0
  const frozenFeeExit = withMoney ? normalizeFee(data.feeExit, t.feeExit ?? 0) : 0

  // Etappe 6: der Abschluss schließt die noch OFFENE Restmenge. Sie ergibt sich
  // aus dem Event-Log (nach Teilverkäufen/Nachkäufen); ohne Events ist es die
  // volle Position.
  const events = await loadTradeEvents(userId, id)
  const settle = settlePosition(t, events)
  const openedEvent = events.find((e) => e.type === 'eroeffnet')
  const remaining = events.length ? settle.openQty : (t.positionSize ?? 0)
  const closedAt = new Date()

  await db.transaction(async (tx) => {
    await tx
      .update(trade)
      .set({
        status: 'abgeschlossen',
        result: data.result,
        actualExitPrice: data.actualExitPrice ?? null,
        followedPlan: data.followedPlan,
        lossAccepted: data.result === 'verlust' ? true : t.lossAccepted,
        // Gebühren hier festschreiben: ab jetzt verändert keine spätere
        // Einstellungsänderung mehr die Bilanz dieses Trades.
        feeEntry: frozenFeeEntry,
        feeExit: frozenFeeExit,
        ...(checkOut
          ? {
              moodExit: checkOut.score,
              moodExitTags: serializeMoodTags(checkOut.tags),
              moodExitNote: checkOut.note,
            }
          : {}),
        closedAt,
      })
      .where(and(eq(trade.id, id), eq(trade.userId, userId)))

    // Das eröffnende Event trägt die (jetzt eingefrorene) Einstiegsgebühr des
    // URSPRÜNGLICHEN Einstiegs — die Quelle für die Netto-Rechnung von
    // Event-Trades. Fehlt es (Trade vor Etappe 6 aktiviert), wird es nachgezogen.
    if (openedEvent) {
      await tx
        .update(tradeEvent)
        .set({ fee: frozenFeeEntry })
        .where(and(eq(tradeEvent.id, openedEvent.id), eq(tradeEvent.userId, userId)))
    } else {
      await tx
        .insert(tradeEvent)
        .values(openedEventValues(t, userId, { fee: frozenFeeEntry, note: 'Eröffnet' }))
    }

    // Abschluss-Event: schließt die Restmenge zum tatsächlichen Ausstiegskurs.
    const [abschluss] = await tx
      .insert(tradeEvent)
      .values({
        tradeId: id,
        userId,
        type: 'geschlossen',
        at: closedAt,
        quantity: remaining,
        price: data.actualExitPrice ?? null,
        fee: frozenFeeExit,
        note: `Geschlossen (${data.result})`,
      })
      .returning({ id: tradeEvent.id })

    // Wurde der Abschluss über eine geplante Stufe ausgelöst, wird sie hier
    // abgetragen — mit dem TATSÄCHLICHEN Ausstiegskurs, nicht mit dem geplanten.
    // Die übrigen offenen Stufen bleiben offen: Sie wurden nicht erreicht, und
    // das soll im Plan sichtbar bleiben, statt nachträglich geglättet zu werden.
    if (data.targetId != null) {
      await tx
        .update(tradeTarget)
        .set({
          executedAt: closedAt,
          executedPrice: data.actualExitPrice ?? null,
          executedQty: remaining,
          eventId: abschluss.id,
        })
        .where(
          and(
            eq(tradeTarget.id, data.targetId),
            eq(tradeTarget.tradeId, id),
            eq(tradeTarget.userId, userId),
          ),
        )
    }
  })

  revalidatePath('/')
  revalidatePath('/trades')
  revalidatePath('/tracking')
}

/**
 * Teilverkauf (Etappe 6): einen Teil der offenen Position schließen. Der Trade
 * bleibt `aktiv` — der letzte Rest wird über `closeTrade` geschlossen (dort
 * greifen die Douglas-Guards: Verlust bewusst annehmen, Emotions-Check-in,
 * Ausstiegskurs). Deshalb muss beim Teilverkauf zwingend eine Restmenge offen
 * bleiben (`quantity < openQty`).
 */
export async function partialClose(
  id: number,
  data: { quantity: number; price: number; fee?: number | null; note?: string | null },
): Promise<void> {
  const userId = await getUserId()
  const t = await loadOwnedTrade(userId, id)
  if (t.status !== 'aktiv') {
    throw new Error('Teilverkauf nur an einem aktiven Trade möglich.')
  }
  const quantity = requirePositive(data.quantity, 'Bitte eine Stückzahl > 0 für den Teilverkauf eintragen.')
  const price = requirePositive(data.price, 'Bitte den Ausführungskurs des Teilverkaufs eintragen.')

  const events = await loadTradeEvents(userId, id)
  const settle = settlePosition(t, events)
  if (quantity >= settle.openQty) {
    throw new Error(
      `Beim Teilverkauf muss eine Restmenge offen bleiben (offen: ${settle.openQty}). ` +
        'Den letzten Rest über „Position schließen".',
    )
  }

  const toInsert: TradeEventInsert[] = []
  if (!events.some((e) => e.type === 'eroeffnet')) {
    toInsert.push(openedEventValues(t, userId, { note: 'Eröffnet' }))
  }
  toInsert.push({
    tradeId: id,
    userId,
    type: 'teilverkauf',
    at: new Date(),
    quantity,
    price,
    fee: t.tradedWithMoney ? normalizeFee(data.fee, 0) : 0,
    note: data.note?.trim() || null,
  })
  await db.insert(tradeEvent).values(toInsert)

  revalidatePath('/')
  revalidatePath('/trades')
  revalidatePath('/tracking')
}

/**
 * Nachkauf/Pyramidisieren (Etappe 6): die offene Position vergrößern. Der
 * gewichtete Durchschnittseinstieg und die Gesamtstückzahl werden auf der
 * Trade-Zeile fortgeschrieben (für Risiko-/Live-Anzeige); das ursprüngliche 1R
 * bleibt über das eröffnende Event erhalten. Bewusst KEIN Regelbruch — geplantes
 * Pyramidisieren ist Douglas-konform; es erhöht aber das Risiko über den
 * ursprünglichen Einsatz hinaus, was in der R-Anzeige sichtbar wird.
 */
export async function addToPosition(
  id: number,
  data: { quantity: number; price: number; fee?: number | null; note?: string | null },
): Promise<void> {
  const userId = await getUserId()
  const t = await loadOwnedTrade(userId, id)
  if (t.status !== 'aktiv') {
    throw new Error('Nachkauf nur an einem aktiven Trade möglich.')
  }
  const quantity = requirePositive(data.quantity, 'Bitte eine Stückzahl > 0 für den Nachkauf eintragen.')
  const price = requirePositive(data.price, 'Bitte den Ausführungskurs des Nachkaufs eintragen.')

  const events = await loadTradeEvents(userId, id)
  const settle = settlePosition(t, events)
  const newOpen = settle.openQty + quantity
  const newAvgEntry = newOpen > 0 ? (settle.openQty * settle.avgEntry + quantity * price) / newOpen : settle.avgEntry
  const newTotalEntered = settle.totalEntered + quantity

  const toInsert: TradeEventInsert[] = []
  if (!events.some((e) => e.type === 'eroeffnet')) {
    toInsert.push(openedEventValues(t, userId, { note: 'Eröffnet' }))
  }
  toInsert.push({
    tradeId: id,
    userId,
    type: 'nachkauf',
    at: new Date(),
    quantity,
    price,
    fee: t.tradedWithMoney ? normalizeFee(data.fee, 0) : 0,
    note: data.note?.trim() || null,
  })

  await db.transaction(async (tx) => {
    await tx.insert(tradeEvent).values(toInsert)
    await tx
      .update(trade)
      .set({ positionSize: newTotalEntered, entryPrice: newAvgEntry })
      .where(and(eq(trade.id, id), eq(trade.userId, userId)))
  })

  revalidatePath('/')
  revalidatePath('/trades')
  revalidatePath('/tracking')
}

// ---------------------------------------------------------------------------
// Teilziele (Etappe 13)
// ---------------------------------------------------------------------------

/** Alle Stufen eines Trades, in Plan-Reihenfolge (owner-gefiltert). */
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
export async function executeTarget(
  tradeId: number,
  targetId: number,
  data: { price?: number | null; fee?: number | null; note?: string | null } = {},
): Promise<{ quantity: number; price: number }> {
  const userId = await getUserId()
  const t = await loadOwnedTrade(userId, tradeId)
  if (t.status !== 'aktiv') {
    throw new Error('Ein Teilziel lässt sich nur an einem aktiven Trade ausführen.')
  }

  const ziele = await loadTradeTargets(userId, tradeId)
  const ziel = ziele.find((z) => z.id === targetId)
  if (!ziel) throw new Error('Teilziel nicht gefunden.')
  if (ziel.executedAt != null) throw new Error('Dieses Teilziel ist bereits ausgeführt.')

  const events = await loadTradeEvents(userId, tradeId)
  const settle = settlePosition(t, events)
  const basis = basisQuantity(t, events)
  if (!(basis > 0)) {
    throw new Error(
      'Ohne Positionsgröße lässt sich der Anteil einer Stufe nicht in eine Stückzahl übersetzen. ' +
        'Bitte Einsatz oder Stückzahl am Trade nachtragen.',
    )
  }

  const geplant = plannedQty(basis, ziel.sharePct)
  // Mehr als offen ist, lässt sich nicht verkaufen — etwa nach einem Teilverkauf
  // von Hand. Die Stufe gibt dann eben nur noch den Rest ab.
  const menge = Math.min(geplant, settle.openQty)
  if (!(menge > 0)) {
    throw new Error('Es ist keine Position mehr offen, die diese Stufe abgeben könnte.')
  }
  if (menge >= settle.openQty - 1e-9) {
    throw new Error(
      'Diese Stufe schließt die Position vollständig. Sie läuft über „Abschließen" — ' +
        'dort greifen Verlust-Annahme, Plan-Treue und Check-in.',
    )
  }

  const kurs = data.price != null && data.price > 0 ? data.price : ziel.price
  const jetzt = new Date()

  await db.transaction(async (tx) => {
    // Alt-Trade ohne Eröffnungs-Event: nachziehen, sonst fehlt dem Settlement
    // der Anker (dieselbe Nachsorge wie in `partialClose`).
    if (!events.some((e) => e.type === 'eroeffnet')) {
      await tx.insert(tradeEvent).values(openedEventValues(t, userId, { note: 'Eröffnet' }))
    }
    const [ereignis] = await tx
      .insert(tradeEvent)
      .values({
        tradeId,
        userId,
        type: 'teilverkauf',
        at: jetzt,
        quantity: menge,
        price: kurs,
        fee: t.tradedWithMoney ? normalizeFee(data.fee, 0) : 0,
        note: data.note?.trim() || `Teilziel ${ziel.sortOrder + 1} erreicht`,
      })
      .returning({ id: tradeEvent.id })

    await tx
      .update(tradeTarget)
      .set({
        executedAt: jetzt,
        executedPrice: kurs,
        executedQty: menge,
        eventId: ereignis.id,
      })
      .where(and(eq(tradeTarget.id, ziel.id), eq(tradeTarget.userId, userId)))
  })

  revalidatePath('/')
  revalidatePath('/trades')
  revalidatePath('/tracking')
  return { quantity: menge, price: kurs }
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
  const t = await loadOwnedTrade(userId, id)
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

export async function deleteTrade(id: number): Promise<void> {
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
    startCapital: opts.startCapitalOverride ?? startCapital,
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
    const totalPnL = list
      .filter((t) => tradeNetPnl(t, evs(t)) !== null)
      .reduce((acc, t) => acc + (tradeNetPnl(t, evs(t)) ?? 0), 0)
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
