import { db } from '@/lib/db'
import { priceAlert, trade, tradeEvent, tradeTarget, assessment, stock } from '@/lib/db/schema'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
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
  hasPartialSale,
  isRiskReducingStop,
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

import { userSettings } from '@/lib/db/schema'
import type { TradeInput } from '@/app/actions/trades'

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
    realisiertePnl += tradeNetPnl(t, eventsByTrade.get(t.id) ?? []) ?? 0
  }

  const flows = await loadScopedCashflows(userId, [portfolioId])
  const offene = rows.filter((r) => r.id !== exceptTradeId)

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
  const [settings] = await db.select({ currency: userSettings.currency }).from(userSettings)
    .where(eq(userSettings.userId, args.userId)).limit(1)
  const kontowaehrung = settings?.currency ?? 'EUR'

  const pruefung = pruefeDeckung({
    einschuss: args.felder.contractInitialMargin,
    waehrung: args.felder.contractCurrency,
    kontowaehrung,
    rates,
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
    rates,
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

export async function createTradeForUser(
  userId: string,
  input: TradeInput,
  apiRequest?: { key: string; hash: string; source: { kind: string; capturedAt: string } },
): Promise<{ id: number; deckungsHinweis: string | null }> {
  const ticker = input.ticker.trim().toUpperCase()
  if (!ticker) throw new Error('Ticker ist erforderlich.')
  if (!input.entryPrice || !input.stopLoss) {
    throw new Error('Einstieg und Stop-Loss sind erforderlich.')
  }
  // Das Kursziel ist seit dem Umbau der Teilziele PFLICHT.
  //
  // Douglas-Begründung: „Risiko ist vor dem Einstieg definiert" heißt beides —
  // wo der Trade falsch ist UND wo er aufgegangen ist. Ohne Ziel gibt es kein
  // Chance-Risiko-Verhältnis, keinen Wecker am Ziel, keinen Bot-Zwilling und
  // keinen Balken Stop↔Ziel; all das fiel vorher still aus, weil das Feld
  // optional war. Technisch: Es ist zugleich die äußerste Stufe des
  // Staffel-Plans, an der der nicht verteilte Rest der Position hängt.
  if (input.takeProfit == null || !Number.isFinite(input.takeProfit) || input.takeProfit <= 0) {
    throw new Error('Ein Kursziel ist erforderlich — es ist die äußerste Stufe deines Plans.')
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
  // `input.takeProfit` ist an dieser Stelle geprüft (Pflicht, > 0, richtige
  // Seite) — TypeScript trägt die Einschränkung nur nicht durch das Objekt.
  const zielPlan = resolveTargetPlan({ ...input, takeProfit: input.takeProfit })

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

      // Letzte Stufe: Gibt es schlicht kein Instrument, wird eins angelegt.
      //
      // Ohne das bleibt der Trade ohne `stockId` — und dann wird der ROHTICKER
      // an den Anbieter gereicht, was diese App verbietet. Genau daraus entstand
      // die Meldung „Unbekannter Ticker bei Twelve Data" an laufenden Trades:
      // Yahoo scheiterte, der Rückfall kannte das Kürzel auch nicht, und der
      // Trade stand dauerhaft ohne Kurs da.
      //
      // Bei `mehrdeutig` wird NICHT angelegt: Dort gibt es Kandidaten, und ein
      // weiteres Instrument daneben verdoppelte die Verwirrung.
      if (stockId === null && found.reason === 'kein-treffer') {
        const { createInstrumentForTrade } = await import('@/lib/link-trades')
        stockId = await createInstrumentForTrade({
          userId,
          ticker,
          market: (input.market ?? 'aktien') as Market,
        })

        // Sofort auflösen und den ersten Kurs holen — dieselbe Entscheidung wie
        // in `addStock`: Ein frisch angelegtes Instrument, das eine Viertelstunde
        // ohne Kurs dasteht, ist genau der Zustand, den das hier beseitigen soll.
        // Fehlschläge sind folgenlos, der Hintergrundlauf holt es nach.
        try {
          const { runSymbolSync } = await import('@/lib/market-data/sync')
          await runSymbolSync({
            trigger: 'manual',
            onlyStockIds: [stockId],
            forceResolve: true,
          })
        } catch {
          /* siehe oben */
        }
      }
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

  const leverage = normalizeLeverage(input.leverage)

  // --- Kontrakte (Teil 3) ---------------------------------------------------
  //
  // Ein Terminkontrakt wird gezählt, nicht für einen Betrag gekauft. Liegt eine
  // gültige Spezifikation vor UND hat der Nutzer Kontrakte angegeben, bestimmt
  // sie die Positionsgröße; `investedAmount` trägt dann den EINSCHUSS, also das
  // Kapital, das der Broker tatsächlich blockiert. Ohne beides bleibt alles beim
  // bisherigen Weg über Einsatz und Hebel — kein Bruch im Altbestand.
  const kontraktFelder = await ladeKontraktFelder({
    userId,
    stockId,
    ticker,
    market: input.market ?? 'aktien',
    contracts: input.contracts,
    entryPrice: input.entryPrice,
    stopLoss: input.stopLoss,
    leverage,
  })

  // Der Einschuss in KONTOWÄHRUNG — das ist, was in `investedAmount` gehört,
  // denn diese Spalte ist überall die Kontowährungs-Größe. Ohne hinterlegten
  // Umrechnungskurs bleibt sie leer: Ein 1:1 übernommener USD-Betrag wäre in
  // der Bilanz um knapp zehn Prozent falsch, und das wäre schlimmer als eine
  // Lücke, die man sieht.
  const deckungsErgebnis = kontraktFelder
    ? await verlangeDeckung({
        userId,
        portfolioId: zielDepot.id,
        felder: kontraktFelder,
        ticker,
      })
    : null

  const investedAmount = kontraktFelder
    ? (deckungsErgebnis?.einschussKonto ?? null)
    : (input.investedAmount ?? null)
  const positionSize = kontraktFelder
    ? kontraktFelder.positionSize
    : investedAmount != null
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
        externalRequestKey: apiRequest?.key ?? null,
        externalRequestHash: apiRequest?.hash ?? null,
        externalSource: apiRequest?.source ?? null,
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
        // Die Spezifikation wird EINGEFROREN — dieselbe Haltung wie bei den
        // Gebühren: Ein später geänderter Tick-Wert oder Einschuss darf die
        // Historie nicht rückwirkend umschreiben.
        contracts: kontraktFelder?.contracts ?? null,
        contractTickSize: kontraktFelder?.contractTickSize ?? null,
        contractTickValue: kontraktFelder?.contractTickValue ?? null,
        contractMultiplier: kontraktFelder?.contractMultiplier ?? null,
        contractCurrency: kontraktFelder?.contractCurrency ?? null,
        contractInitialMargin: kontraktFelder?.contractInitialMargin ?? null,
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

  // `deckungsHinweis` ist gesetzt, wenn der Einschuss NICHT gegen die Deckung
  // geprueft werden konnte (Fremdwaehrung ohne hinterlegten Kurs). Der Trade
  // ist angelegt — aber das Formular sagt es, statt ihn wie einen geprüften
  // aussehen zu lassen.
  return { id: row.id, deckungsHinweis: deckungsErgebnis?.hinweis ?? null }
}
