import { requireFrozenFxRate, portfolioCurrency } from '@/lib/money-currency'

import { normalizePlanContext, planGaps, requireCompletePlan, planningSnapshot, type PlanContext } from '@/lib/plan-context'
import { createTradeForUser } from '@/lib/create-trade-service'
import { hasRecentLoss, resolveManagementReview, type ManagementReview } from '@/lib/management-review'
import { db } from '@/lib/db'
import { withManualTrade } from '@/lib/manual-trade'
import { priceAlert, trade, tradeEvent, tradeTarget, assessment, stock } from '@/lib/db/schema'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
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

import type { TradeInput } from '@/app/actions/trades'
import { userSettings } from '@/lib/db/schema'
import { createPlanAlertsForUser } from '@/lib/plan-alert-service'
import { eventTime, eventSource, revisionReason, eventsBeforeAction, validateEventSequence } from '@/lib/trade-history'
import { projectPosition } from '@/lib/trade-projection'

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
  const [settings] = await db.select({ currency: userSettings.currency }).from(userSettings).where(eq(userSettings.userId, args.userId)).limit(1)
  const kontowaehrung = portfolioCurrency(depot, settings?.currency ?? 'EUR')
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
    at: t.openedAt ?? eventTime(),
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
export async function activateTradeForUser(
  userId: string,
  id: number,
  mood: MoodCheckInput,
  // Etappe 3: auf Wunsch beim Aktivieren Kurs-Alerts aus dem Plan ableiten
  // (Stop/Ziel/Einstieg). Bewusst optional — der Kernvorgang bleibt unverändert.
  opts?: { createPlanAlerts?: boolean; execution?: { price: number; quantity: number; fee?: number } },
): Promise<{ revengeWarning: boolean; alertsCreated: number; deckungsHinweis: string | null }> {
  const t = await loadOwnedTrade(userId, id)
  if (t.status !== 'geplant') throw new Error('Nur geplante Trades können aktiviert werden.')
  // Das Fragen-Gate gilt nur auf dem vollen Weg. Ein schneller Trade überspringt
  // es bewusst (siehe `lib/trade-kind.ts`) — er bleibt aber als solcher
  // gekennzeichnet, damit später niemand Disziplin unterstellt, wo keine
  // geprüft wurde.
  if (requiresPreTradeGate(t.tradeKind)) requireCompletePlan(t)
  const checkIn = moodForKind(t.tradeKind, mood, 'entry')

  // Deckung erneut prüfen (Teil 3). Zwischen Planen und Eröffnen kann anderes
  // Kapital gebunden worden sein — drei Pläne, die einzeln passten, passen
  // zusammen nicht. Der eigene Trade wird dabei ausgeklammert, sonst zählte
  // sein Einschuss doppelt: einmal als gebunden, einmal als das, was hier
  // geprüft wird.
  let deckungsHinweis: string | null = null
  if (t.contracts != null && t.contractInitialMargin != null && t.contractCurrency) {
    const ergebnis = await verlangeDeckung({
      snapshotRate: requireFrozenFxRate(t),
      userId,
      portfolioId: t.portfolioId,
      felder: {
        contracts: t.contracts,
        contractTickSize: t.contractTickSize ?? 0,
        contractTickValue: t.contractTickValue ?? 0,
        contractMultiplier: t.contractMultiplier ?? 0,
        contractCurrency: t.contractCurrency,
        contractInitialMargin: t.contractInitialMargin,
        positionSize: t.positionSize ?? 0,
        risiko: 0,
      },
      ticker: t.ticker,
      exceptTradeId: t.id,
    })
    deckungsHinweis = ergebnis.hinweis
  }

  // Zeitliche Nähe zu einem Verlust ist nur ein Prüfhinweis.
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

  const revengeWarning = hasRecentLoss(lastLoss?.closedAt, Date.now())
  const violations = parseViolations(t.ruleViolations)

  const openedAt = eventTime()
  const plannedTargets = await loadTradeTargets(userId, id)
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
        ...(opts?.execution ? { price: opts.execution.price, quantity: opts.execution.quantity,
          fee: t.tradedWithMoney ? opts.execution.fee ?? t.feeEntry ?? 0 : 0 } : {}),
        at: openedAt,
        note: 'Eröffnet',
        payload: JSON.stringify({ planningSnapshot: planningSnapshot({ ...t, targets: plannedTargets.map(z => ({ price: z.price, sharePct: z.sharePct, note: z.note })) }), source: eventSource() }),
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
      const { created } = await createPlanAlertsForUser(userId, id, { kinds: ['stop', 'ziel'] })
      alertsCreated = created
    } catch {
      alertsCreated = 0
    }
  }

  await projectPosition(userId, id)

  revalidatePath('/')
  revalidatePath('/trades')
  revalidatePath('/tracking')
  return { revengeWarning, alertsCreated, deckungsHinweis }
}

/**
 * Edit plan fields. Allowed freely while `geplant`. Once `aktiv`, changing the
 * stop or invalidation requires an explicit assessment; unknown stays unknown.
 * Legacy force confirms a violation, never an emotional cause.
 */
export async function updateTradePlanForUser(
  userId: string,
  id: number,
  patch: Partial<TradeInput>,
  force = false,
  review?: ManagementReview,
  expectedVersion?: number,
): Promise<void> {
  const t = await loadOwnedTrade(userId, id)

  if (expectedVersion !== undefined && expectedVersion !== t.version) {
    throw new Error('Trade wurde inzwischen geändert. Bitte erneut laden.')
  }

  if (!['geplant', 'aktiv'].includes(t.status)) {
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

  // Die bestehenden TEILziele — alles außer der äußersten Stufe, denn die ist
  // das Kursziel. Es getrennt zu führen ist der ganze Zweck des Umbaus:
  // Vorher konnte man das Ziel eines gestaffelten Trades gar nicht ändern
  // (`takeProfit` galt als abgeleitet und der Aufruf brach ab), obwohl das
  // Kursziel die wichtigste Zahl im Plan ist.
  const bestehendeTeilziele = bestehendeZiele.slice(0, -1)

  let neuerZielPlan: TargetPlanInput[] | null = null // null = Stufen bleiben, wie sie sind
  const zielBeruehrt =
    patch.targets !== undefined ||
    patch.takeProfit !== undefined ||
    (bestehendeZiele.length > 0 && (patch.entryPrice != null || patch.stopLoss != null))

  if (zielBeruehrt) {
    const kursziel = patch.takeProfit !== undefined ? patch.takeProfit : t.takeProfit
    if (kursziel == null) {
      throw new Error('Ein Kursziel ist erforderlich — es ist die äußerste Stufe deines Plans.')
    }
    const gewuenschteTeilziele =
      patch.targets !== undefined
        ? (patch.targets ?? [])
        : bestehendeTeilziele.map((z) => ({ price: z.price, sharePct: z.sharePct, note: z.note }))

    // Ausgeführte Stufen sind unveränderlich und wandern immer zurück in den
    // Plan — sonst ließe sich über eine Planänderung Geschichte umschreiben
    // oder mehr als 100 % der Position verplanen.
    neuerZielPlan = buildTargetPlan({
      entry: zielEntry,
      stopLoss: zielStop,
      direction: nextDirection,
      kursziel,
      teilziele: [
        ...ausgefuehrt.map((z) => ({ price: z.price, sharePct: z.sharePct, note: z.note })),
        ...gewuenschteTeilziele.filter(
          (n) => !ausgefuehrt.some((z) => Math.abs(z.price - n.price) < 1e-9),
        ),
      ],
    })
  }

  // Die abgeleiteten Felder der Trade-Zeile. `takeProfit` ist ab hier die
  // LETZTE Stufe (das Kursziel), nicht mehr die erste.
  const zielAbleitung =
    neuerZielPlan && neuerZielPlan.length > 0
      ? (() => {
          const letzte = neuerZielPlan[neuerZielPlan.length - 1]
          return {
            takeProfit: letzte.price,
            takeProfitPct: letzte.sharePct,
            riskRewardRatio:
              neuerZielPlan.length > 1
                ? blendedRiskReward({
                    entry: zielEntry,
                    stopLoss: zielStop,
                    targets: neuerZielPlan,
                  })
                : computeRiskReward(zielEntry, zielStop, letzte.price),
          }
        })()
      : null

  const violations = parseViolations(t.ruleViolations)
  const levelEvents: TradeEventInsert[] = []
  if (t.status === 'aktiv') {
    const movesStop = patch.stopLoss != null && patch.stopLoss !== t.stopLoss
    const movesInval =
      patch.elliottInvalidation !== undefined && patch.elliottInvalidation !== t.elliottInvalidation
    // Ein Ziel ist verschoben, wenn das Feld selbst wandert ODER wenn die
    // Staffel neu geplant wurde (das Kursziel ist die LETZTE Stufe).
    const zielVorher = t.takeProfit
    const zielNachher = zielAbleitung ? zielAbleitung.takeProfit : patch.takeProfit
    const staffelGeaendert =
      patch.targets !== undefined &&
      JSON.stringify((neuerZielPlan ?? []).map((z) => [z.price, z.sharePct])) !==
        JSON.stringify(bestehendeZiele.map((z) => [z.price, z.sharePct]))
    const movesTarget =
      (zielNachher != null && zielNachher !== zielVorher) || staffelGeaendert

    const management = movesStop || movesInval ? resolveManagementReview(review, force) : null
    if (movesStop && management?.violation === true && !violations.includes('stop_moved')) violations.push('stop_moved')
    if (movesInval && management?.violation === true && !violations.includes('invalidation_ignored')) violations.push('invalidation_ignored')

    // Level-Änderungen für die Chronik festhalten (payload trägt alt→neu).
    if (movesStop) {
      levelEvents.push({
        tradeId: id,
        userId,
        type: 'stop_verschoben',
        at: eventTime(),
        payload: JSON.stringify({ from: t.stopLoss, to: patch.stopLoss, violation: management!.violation, assessment: management!.assessment, reason: management!.reason, source: eventSource() }),
        note: management!.note,
      })
    }
    if (movesTarget) {
      levelEvents.push({
        tradeId: id,
        userId,
        type: 'ziel_geaendert',
        at: eventTime(),
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
        at: eventTime(),
        payload: JSON.stringify({ from: t.elliottInvalidation, to: patch.elliottInvalidation, violation: management!.violation, assessment: management!.assessment, reason: management!.reason, source: eventSource() }),
        note: management!.note,
      })
    }
  }

  // Kapitaleinsatz, Einstieg oder Hebel geändert → Stückzahl neu ableiten (Echtgeld).
  const nextEntry = patch.entryPrice ?? t.entryPrice
  const nextInvested =
    patch.investedAmount !== undefined ? patch.investedAmount : t.investedAmount
  const nextLeverage =
    patch.leverage !== undefined ? normalizeLeverage(patch.leverage) : (t.leverage ?? 1)
  const changesSize = patch.investedAmount !== undefined || patch.entryPrice !== undefined || patch.leverage !== undefined || patch.positionSize !== undefined
  if (changesSize && t.contracts != null) throw new Error('Kontraktgröße und Einschuss bleiben eingefroren. Größenänderungen brauchen eine neue geprüfte Kontraktspezifikation.')
  const derivedSize = changesSize && nextInvested != null
    ? computeShares(nextInvested, nextEntry, nextLeverage, requireFrozenFxRate(t)) : undefined
  if (derivedSize !== undefined && patch.positionSize != null &&
      Math.abs(derivedSize - patch.positionSize) > 1e-8 * Math.max(1, Math.abs(patch.positionSize))) {
    throw new Error('Positionsgröße und Kapitaleinsatz widersprechen sich beim eingefrorenen Plan-FX. Menge und Kapital gemeinsam korrigieren.')
  }

  let nextContext = patch.planContext !== undefined ? normalizePlanContext(patch.planContext) : t.planContext
  const riskInputsChanged = ['entryPrice', 'stopLoss', 'takeProfit', 'investedAmount', 'leverage', 'positionSize', 'elliottInvalidation']
    .some(key => key in patch && patch[key as keyof TradeInput] !== t[key as keyof TradeRow])
  if (t.status === 'geplant' && riskInputsChanged && patch.planContext === undefined && nextContext) {
    nextContext = { ...nextContext, riskConfirmed: false }
  }
  const nextPlan = { ...t, ...patch, planContext: nextContext, takeProfit: zielAbleitung?.takeProfit ?? patch.takeProfit ?? t.takeProfit,
    direction: t.direction, positionSize: derivedSize ?? patch.positionSize ?? t.positionSize }
  const planReady = planGaps(nextPlan).length === 0
  if (Object.keys(patch).length > 0) {
    levelEvents.push({ tradeId: id, userId, type: 'notiz', at: eventTime(), note: 'Planangaben aktualisiert; frühere Fassung erhalten',
      payload: JSON.stringify({ source: eventSource(), reason: revisionReason(),
        before: planningSnapshot({ ...t, targets: bestehendeZiele }),
        after: planningSnapshot({ ...nextPlan, setupTags: patch.setupTags !== undefined ? serializeSetupTags(patch.setupTags) : t.setupTags,
          targets: neuerZielPlan ?? bestehendeZiele }) }) })
  }
  await db.transaction(async (tx) => {
    await tx
      .update(trade)
      .set({
        ...(patch.planContext !== undefined || (t.status === 'geplant' && riskInputsChanged) ? { planContext: nextContext } : {}),
        ...(t.status === 'geplant' ? { preTradeAnswered: planReady } : {}),
        ...(patch.entryPrice != null ? { entryPrice: patch.entryPrice } : {}),
        ...(patch.stopLoss != null ? { stopLoss: patch.stopLoss } : {}),
        // Ziel, Anteil und R:R kommen aus dem Plan. Sobald das Ziel überhaupt
        // berührt wird, ist `zielAbleitung` gesetzt — der Zweig darunter greift
        // also nur noch, wenn gar kein Plan gerechnet wurde. `null` ist seit
        // Migration 0032 kein gültiges Kursziel mehr und wird verworfen, statt
        // die Spalte zu verletzen.
        ...(zielAbleitung
          ? {
              takeProfit: zielAbleitung.takeProfit,
              takeProfitPct: zielAbleitung.takeProfitPct,
              riskRewardRatio: zielAbleitung.riskRewardRatio,
            }
          : patch.takeProfit != null
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
        if (z.executedAt != null || ((neuerZielPlan.length > 1 || ausgefuehrt.length > 0) && neuerZielPlan.some(n => Math.abs(n.price - z.price) < 1e-9))) continue
        await tx.delete(tradeTarget).where(
          and(eq(tradeTarget.id, z.id), eq(tradeTarget.userId, userId)),
        )
      }
      // Eine EINZIGE Stufe ist kein Staffel-Plan, sondern ein gewöhnliches
      // Kursziel — dafür bleiben die Zeilen leer und `effectiveTargets` liest
      // `takeProfit`. Genau so legt `createTrade` einen solchen Trade an; hier
      // dieselbe Regel, sonst bekäme ein einfacher Trade allein durch das
      // Bearbeiten eine Stufen-Zeile und plötzlich einen „Stufe ausführen"-Knopf
      // an seinem einzigen Ziel, das über `closeTrade` gehört.
      // Ausnahme: Sobald etwas ausgeführt ist, bleibt die Liste bestehen — eine
      // abgerechnete Stufe verschwindet nie.
      const behalten = neuerZielPlan.length > 1 || ausgefuehrt.length > 0
      const neu: (typeof tradeTarget.$inferInsert)[] = []
      for (const [i, z] of (behalten ? neuerZielPlan : []).entries()) {
        const alt = bestehendeZiele.find((a) => Math.abs(a.price - z.price) < 1e-9)
        if (alt) {
          await tx
            .update(tradeTarget)
            .set({ sortOrder: i, ...(alt.executedAt == null ? { sharePct: z.sharePct, note: z.note ?? null } : {}) })
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
    await createPlanAlertsForUser(userId, tradeId, { kinds: zuSetzen })
  } catch {
    // siehe oben — der Plan ist bereits gespeichert
  }
}

/**
 * Close a trade. A loss must be explicitly accepted (Douglas: "Meine Zählung
 * war für diesen Trade falsch. Der nächste Trade zählt.").
 */
export async function closeTradeForUser(
  userId: string,
  id: number,
  data: {
    result?: 'gewinn' | 'verlust' | 'breakeven'
    at?: string
    actualExitPrice?: number | null
    followedPlan?: boolean | null
    lossAccepted?: boolean
    // Letzte Gelegenheit, die tatsächlich gezahlten Gebühren zu korrigieren —
    // danach sind sie eingefroren.
    feeEntry?: number | null
    feeExit?: number | null
    // Emotions-Check-in beim Ausstieg (Etappe 4) — Pflicht.
    mood?: MoodCheckInput | null
    // Teilziel (Etappe 13), das mit diesem Abschluss abgetragen wird: die letzte
    // Stufe schließt die Position, und der vollständige Ausstieg gehört hierher,
    // damit die Guards greifen. Optional — ein Abschluss von Hand hat keine Stufe.
    targetId?: number | null
    quantity?: number
    note?: string
  },
): Promise<void> {
  const t = await loadOwnedTrade(userId, id)
  if (t.status !== 'aktiv') throw new Error('Nur aktive Trades können abgeschlossen werden.')
  const checkOut = data.mood ? moodForKind(t.tradeKind, data.mood, 'exit') : null
  // Die bewusste Verlustannahme gilt in BEIDEN Wegen. Sie ist kein
  // Formular-Ballast, sondern der Douglas-Kern beim Ausstieg — ein schneller
  // Trade darf sie so wenig überspringen wie den Stop.
  // Ohne Ausstiegskurs lässt sich der P&L nicht berechnen. Früher wurde an
  // dieser Stelle stillschweigend ein Betrag unterstellt — jetzt wird gefragt.
  if (!(typeof data.actualExitPrice === 'number' && Number.isFinite(data.actualExitPrice) && data.actualExitPrice > 0)) {
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
  const settle = settlePosition(t, eventsBeforeAction(events))
  const openedEvent = events.find((e) => e.type === 'eroeffnet')
  const remaining = events.length ? settle.openQty : (t.positionSize ?? 0)
  if (data.quantity !== undefined && Math.abs(data.quantity - remaining) > 1e-8) throw new Error('Abschlussmenge passt nicht zur offenen Restposition. Spätere Ausführungen prüfen.')
  if (!(remaining > 0)) throw new Error('Keine offene Restposition zum Abschließen.')
  const closedAt = eventTime()

  await db.transaction(async (tx) => {
    await tx
      .update(trade)
      .set({
        status: 'abgeschlossen',
        result: null,
        actualExitPrice: data.actualExitPrice ?? null,
        followedPlan: data.followedPlan ?? null,
        lossAccepted: data.lossAccepted ?? false,
        reviewLossAccepted: data.lossAccepted ?? null,
        reviewStatus: 'pending', reviewDeferredUntil: null,
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
        note: data.note ?? 'Ausführung: Position geschlossen',
        payload: JSON.stringify({ source: eventSource() }),
      })
      .returning({ id: tradeEvent.id })

    // Wurde der Abschluss über eine geplante Stufe ausgelöst, wird sie hier
    // abgetragen — mit dem TATSÄCHLICHEN Ausstiegskurs, nicht mit dem geplanten.
    // Die übrigen offenen Stufen bleiben offen: Sie wurden nicht erreicht, und
    // das soll im Plan sichtbar bleiben, statt nachträglich geglättet zu werden.
    if (data.targetId != null) {
      const [target] = await tx.select().from(tradeTarget).where(and(eq(tradeTarget.id, data.targetId), eq(tradeTarget.tradeId, id), eq(tradeTarget.userId, userId)))
      if (!target || target.executedAt != null) throw new Error('Zielstufe fehlt oder wurde bereits ausgeführt.')
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

  await projectPosition(userId, id)

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
export async function partialCloseForUser(
  userId: string,
  id: number,
  data: { quantity: number; price: number; fee?: number | null; note?: string | null },
): Promise<void> {
  const t = await loadOwnedTrade(userId, id)
  if (t.status !== 'aktiv') {
    throw new Error('Teilverkauf nur an einem aktiven Trade möglich.')
  }
  const quantity = requirePositive(data.quantity, 'Bitte eine Stückzahl > 0 für den Teilverkauf eintragen.')
  const price = requirePositive(data.price, 'Bitte den Ausführungskurs des Teilverkaufs eintragen.')

  const events = await loadTradeEvents(userId, id)
  const settle = settlePosition(t, eventsBeforeAction(events))
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
    at: eventTime(),
    quantity,
    price,
    fee: t.tradedWithMoney ? normalizeFee(data.fee, 0) : 0,
    note: data.note?.trim() || null,
    payload: JSON.stringify({ source: eventSource() }),
  })
  await db.insert(tradeEvent).values(toInsert)

  await projectPosition(userId, id)

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
export async function addToPositionForUser(
  userId: string,
  id: number,
  data: { quantity: number; price: number; fee?: number | null; note?: string | null },
): Promise<void> {
  const t = await loadOwnedTrade(userId, id)
  if (t.status !== 'aktiv') {
    throw new Error('Nachkauf nur an einem aktiven Trade möglich.')
  }
  const quantity = requirePositive(data.quantity, 'Bitte eine Stückzahl > 0 für den Nachkauf eintragen.')
  const price = requirePositive(data.price, 'Bitte den Ausführungskurs des Nachkaufs eintragen.')

  const events = await loadTradeEvents(userId, id)
  const settle = settlePosition(t, eventsBeforeAction(events))
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
    at: eventTime(),
    quantity,
    price,
    fee: t.tradedWithMoney ? normalizeFee(data.fee, 0) : 0,
    note: data.note?.trim() || null,
    payload: JSON.stringify({ source: eventSource() }),
  })

  await db.transaction(async (tx) => {
    await tx.insert(tradeEvent).values(toInsert)
    await tx
      .update(trade)
      .set({ positionSize: newTotalEntered, entryPrice: newAvgEntry })
      .where(and(eq(trade.id, id), eq(trade.userId, userId)))
  })

  await projectPosition(userId, id)

  revalidatePath('/')
  revalidatePath('/trades')
  revalidatePath('/tracking')
}

// ---------------------------------------------------------------------------
// Teilziele (Etappe 13)
// ---------------------------------------------------------------------------

/** Alle Stufen eines Trades, in Plan-Reihenfolge (owner-gefiltert). */
/**
 * Die Stufen MEHRERER Trades in einem Zug — für Ansichten, die viele Pläne
 * nebeneinander zeigen (Chart-Overlay, Plan-Leiste). Eine Abfrage je Trade wäre
 * dort eine Abfrage je Chartlinie.
 */
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
export async function executeTargetForUser(
  userId: string,
  tradeId: number,
  targetId: number,
  data: { price?: number | null; quantity?: number; fee?: number | null; note?: string | null } = {},
): Promise<{ quantity: number; price: number }> {
  const t = await loadOwnedTrade(userId, tradeId)
  if (t.status !== 'aktiv') {
    throw new Error('Ein Teilziel lässt sich nur an einem aktiven Trade ausführen.')
  }

  const ziele = await loadTradeTargets(userId, tradeId)
  const ziel = ziele.find((z) => z.id === targetId)
  if (!ziel) throw new Error('Teilziel nicht gefunden.')
  if (ziel.executedAt != null) throw new Error('Dieses Teilziel ist bereits ausgeführt.')

  const events = await loadTradeEvents(userId, tradeId)
  const settle = settlePosition(t, eventsBeforeAction(events))
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
  const menge = data.quantity ?? Math.min(geplant, settle.openQty)
  if (!(menge > 0)) {
    throw new Error('Es ist keine Position mehr offen, die diese Stufe abgeben könnte.')
  }
  if (menge >= settle.openQty - 1e-9) {
    throw new Error(
      'Diese Stufe schließt die Position vollständig. Sie läuft über „Abschließen" — ' +
        'dort greifen Verlust-Annahme, Plan-Treue und Check-in.',
    )
  }

  const kurs = requirePositive(data.price, 'Tatsächlichen Ausführungskurs der Zielstufe angeben.')
  const jetzt = eventTime()

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
        payload: JSON.stringify({ source: eventSource() }),
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

  await projectPosition(userId, tradeId)

  revalidatePath('/')
  revalidatePath('/trades')
  revalidatePath('/tracking')
  return { quantity: menge, price: kurs }
}
