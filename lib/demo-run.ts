// Demo orders are evaluated on completed 5-minute candles, at their planned
// prices. A durable cursor replaces the old two-hour lookback. Every batch
// shares the same portfolio/trade lock as manual actions.
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { brokerOrder, portfolio, trade, tradeEvent, tradeTarget, userSettings } from '@/lib/db/schema'
import { getCachedCandles } from '@/lib/market-data/cached'
import { readStoredCandles, pruneStoredCandles } from '@/lib/market-data/candle-store'
import { createSymbolResolver } from '@/lib/market-data/lookup'
import type { Candle, Interval, Market } from '@/lib/market-data/types'
import { demoFills, type DemoFill } from '@/lib/demo-fill'
import { effectiveTargets, type TradeTargetRow } from '@/lib/trade-targets'
import { settlePosition, type TradeEventRow } from '@/lib/trade-events'
import { normalizePortfolioKind } from '@/lib/portfolio-scope'
import { gebundeneMargin } from '@/lib/contract-trade'
import { berechneDeckung, parseFxRates, pruefeDeckung } from '@/lib/margin'
import { netCashflow, tradeNetPnl, parseViolations } from '@/lib/trade-stats'
import { loadScopedCashflows } from '@/lib/portfolio-context'
import { withTradeLock } from '@/lib/trade-lock'
import { pruefBeginn, completedDemoCandles, demoCoveragePrefix, DEMO_CANDLE_SECONDS } from '@/lib/demo-progress'

export { pruefBeginn } from '@/lib/demo-progress'
export const FILL_INTERVAL: Interval = '5min'
export const DEMO_BATCH_SIZE = 250

export type DemoFillZeile = {
  tradeId: number; ticker: string; art: string; preis: number
  menge: number; zeit: string; grund: string
}
export type DemoRunReport = {
  ran: boolean; trocken: boolean; tradesGeprueft: number
  einstiege: number; teilziele: number; abschluesse: number
  unvollstaendig: number[]; ohneKerzen: number[]; vorFenster: number[]
  ungedeckt: number[]; ausstehend: number[]; zeilen: DemoFillZeile[]; error: string | null
}
export function leererDemoBericht(): DemoRunReport {
  return { ran: false, trocken: false, tradesGeprueft: 0, einstiege: 0,
    teilziele: 0, abschluesse: 0, unvollstaendig: [], ohneKerzen: [],
    vorFenster: [], ungedeckt: [], ausstehend: [], zeilen: [], error: null }
}

/** User-scoped calls reconcile one trade before a manual operation. */
export async function runDemoFills(
  opts: { userId?: string; tradeId?: number; trocken?: boolean; maxMs?: number; refresh?: boolean } = {},
): Promise<DemoRunReport> {
  const report = leererDemoBericht()
  report.trocken = opts.trocken === true
  const started = Date.now()
  try {
    const depots = await db.select({ id: portfolio.id, kind: portfolio.kind })
      .from(portfolio).where(opts.userId ? eq(portfolio.userId, opts.userId) : undefined)
    const ids = depots.filter((p) => normalizePortfolioKind(p.kind) === 'demo').map((p) => p.id)
    if (!ids.length) return { ...report, ran: true }
    let trades = await db.select().from(trade).where(and(
      inArray(trade.portfolioId, ids), inArray(trade.status, ['geplant', 'aktiv']),
      opts.userId ? eq(trade.userId, opts.userId) : undefined,
      opts.tradeId != null ? eq(trade.id, opts.tradeId) : undefined,
    ))
    const brokerLinks = await db.select({ linkedTradeId: brokerOrder.linkedTradeId }).from(brokerOrder)
      .where(inArray(brokerOrder.portfolioId, ids))
    const brokerTradeIds = new Set(brokerLinks.map((row) => row.linkedTradeId))
    trades = trades.filter((row) => !brokerTradeIds.has(row.id))
    // Healthy trades first so repeatedly failing symbols cannot starve the rest.
    // A shared symbol is refreshed again if a later trade needs older history.
    const baseline = (t: typeof trade.$inferSelect) =>
      pruefBeginn(t, []).beginn.getTime()
    trades.sort((a, b) => Number(Boolean(a.demoIssue)) - Number(Boolean(b.demoIssue)) || baseline(a) - baseline(b))
    const resolvers = new Map<string, Awaited<ReturnType<typeof createSymbolResolver>>>()
    const refreshed = new Map<string, number>()
    const pendingSymbols = new Set<string>()
    for (let i = 0; i < trades.length; i++) {
      const before = trades[i]
      if (opts.maxMs != null && Date.now() - started >= opts.maxMs) {
        report.ausstehend.push(...trades.slice(i).map((t) => t.id))
        break
      }
      report.tradesGeprueft++
      try {
        if (!resolvers.has(before.userId)) {
          resolvers.set(before.userId, await createSymbolResolver(before.userId))
        }
        const symbol = resolvers.get(before.userId)!(before.ticker, before.stockId)
        const key = `${before.market}:${symbol}`
        const refreshSince = Math.floor(baseline(before) / 1000)
          - (before.demoCheckedAt ? DEMO_CANDLE_SECONDS : 7 * 24 * 60 * 60)
        if (!report.trocken && opts.refresh !== false && refreshSince < (refreshed.get(key) ?? Infinity)) {
          await getCachedCandles(symbol, before.market as Market, FILL_INTERVAL, {
            since: refreshSince,
            limit: 1, forceRefresh: true, requireFresh: true,
          })
          refreshed.set(key, refreshSince)
        }
        const result = await withTradeLock(before.userId, before.id, async (t, depot) => {
          if (normalizePortfolioKind(depot.kind) !== 'demo' || !['geplant', 'aktiv'].includes(t.status)) return null
          // The symbol was resolved before taking the lock. A concurrent edit
          // must never evaluate a new instrument using the old one's candles.
          if (t.ticker !== before.ticker || t.stockId !== before.stockId || t.market !== before.market) {
            return { issue: null, pending: true }
          }
          // Broker-linked trades use confirmed broker fills, never simulated prices.
          const linked = await db.select({ id: brokerOrder.id }).from(brokerOrder)
            .where(and(eq(brokerOrder.userId, t.userId), eq(brokerOrder.linkedTradeId, t.id))).limit(1)
          if (linked.length) return null
          const events = await ladeEreignisse(t.userId, t.id)
          const targets = await ladeStufen(t.userId, t.id)
          const beginn = pruefBeginn(t, events).beginn
          const since = Math.ceil(beginn.getTime() / (DEMO_CANDLE_SECONDS * 1000)) * DEMO_CANDLE_SECONDS
          const [previous, rows] = await Promise.all([
            readStoredCandles(symbol, FILL_INTERVAL, { before: since, limit: 1 }),
            getCachedCandles(symbol, t.market as Market, FILL_INTERVAL, {
              since, ascending: true, limit: DEMO_BATCH_SIZE + 1, storedOnly: true,
            }),
          ])
          const candles = completedDemoCandles(rows, beginn, Date.now())
          if (!candles.length) {
            if (!rows.length && !previous.length) {
              await markIssue(t, 'Keine verwertbaren 5-Minuten-Kursdaten. Manuelle Buchung bleibt möglich.', report.trocken)
              return { issue: 'empty' as const }
            }
            return null // Market closed, or only an unfinished candle is available.
          }
          const coverage = demoCoveragePrefix(candles, previous[0] ?? null, beginn, t.market)
          if (coverage.gap && !coverage.usable.length) {
            await markIssue(t, 'Lücke in den 5-Minuten-Kursdaten. Bitte frühere Ausführungen manuell prüfen.', report.trocken)
            return { issue: 'coverage' as const }
          }
          if (!(t.positionSize != null && t.positionSize > 0)) {
            await markIssue(t, 'Ohne Positionsgröße ist keine automatische Ausführung möglich.', report.trocken)
            return { issue: 'coverage' as const }
          }
          const batch = coverage.usable.slice(0, DEMO_BATCH_SIZE)
          const outcome = await verarbeiteTrade({ t, events, targetRows: targets, kerzen: batch,
            vorherKurs: previous[0]?.close ?? null, trocken: report.trocken })
          if (!report.trocken) {
            await db.update(trade).set({
              demoCheckedAt: new Date((batch[batch.length - 1].time + DEMO_CANDLE_SECONDS) * 1000),
              // A warning about manually bypassed missing history stays visible.
              demoIssue: coverage.gap && !outcome.closed
                ? 'Lücke in den 5-Minuten-Kursdaten. Bitte frühere Ausführungen manuell prüfen.'
                : t.demoIssue?.startsWith('Ungeprüfte Historie:') ? t.demoIssue : null,
            }).where(and(eq(trade.id, t.id), eq(trade.userId, t.userId)))
          }
          return { issue: coverage.gap && !outcome.closed ? 'coverage' as const : null, outcome,
            pending: coverage.usable.length > DEMO_BATCH_SIZE && !outcome.closed }
        })
        if (result?.issue === 'empty') report.ohneKerzen.push(before.id)
        if (result?.issue === 'coverage') { report.unvollstaendig.push(before.id); pendingSymbols.add(key) }
        if (result?.outcome) {
          report.einstiege += result.outcome.einstiege
          report.teilziele += result.outcome.teilziele
          report.abschluesse += result.outcome.abschluesse
          report.zeilen.push(...result.outcome.zeilen)
          if (result.outcome.ungedeckt) report.ungedeckt.push(before.id)
        }
        if (result?.pending) {
          report.ausstehend.push(before.id)
          pendingSymbols.add(key)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        report.ohneKerzen.push(before.id)
        report.error ??= message
        if (!report.trocken) {
          await withTradeLock(before.userId, before.id, async (current, depot) => {
            if (normalizePortfolioKind(depot.kind) === 'demo') {
              await markIssue(current, `Demo-Automatik: ${message}`, false)
            }
          }).catch(() => {})
        }
      }
    }
    if (!report.trocken && !report.ausstehend.length && !report.error) {
      for (const [key] of refreshed) {
        if (pendingSymbols.has(key)) continue
        const symbol = key.slice(key.indexOf(':') + 1)
        await pruneStoredCandles(symbol, FILL_INTERVAL, 'A')
      }
    }
    report.ran = true
  } catch (err) {
    report.error = err instanceof Error ? err.message : String(err)
  }
  return report
}

async function markIssue(t: typeof trade.$inferSelect, issue: string, trocken: boolean) {
  if (!trocken) await db.update(trade).set({
    demoIssue: t.demoIssue?.startsWith('Ungeprüfte Historie:') ? t.demoIssue : issue,
  })
    .where(and(eq(trade.id, t.id), eq(trade.userId, t.userId)))
}

async function verarbeiteTrade(args: {
  t: typeof trade.$inferSelect; events: TradeEventRow[]; targetRows: TradeTargetRow[]
  kerzen: Candle[]; vorherKurs: number | null; trocken: boolean
}) {
  const { t } = args
  let status = t.status
  let stufen = args.targetRows
  const events = [...args.events]
  let previous = args.vorherKurs
  const result = { einstiege: 0, teilziele: 0, abschluesse: 0,
    zeilen: [] as DemoFillZeile[], ungedeckt: false, closed: false }
  for (const candle of args.kerzen) {
    if (result.closed) break
    const basis = events.find((e) => e.type === 'eroeffnet')?.quantity ?? t.positionSize
    const fills = demoFills({
      trade: { status, direction: t.direction, entryPrice: t.entryPrice,
        stopLoss: t.stopLoss, positionSize: basis },
      targets: effectiveTargets(t, stufen), candle,
      vorherKurs: previous,
      openQuantity: status === 'aktiv' ? settlePosition(t, events).openQty : undefined,
    })
    previous = candle.close
    for (const fill of fills) {
      if (fill.art === 'einstieg') {
        const deckung = await deckungReicht(t)
        if (!deckung.ok) {
          result.ungedeckt = true
          result.closed = true
          if (!args.trocken) await verwerfeUngedeckt(t, new Date(fill.zeit * 1000), deckung.grund)
          result.zeilen.push({ tradeId: t.id, ticker: t.ticker, art: 'verworfen (ungedeckt)',
            preis: fill.preis, menge: fill.menge, zeit: new Date(fill.zeit * 1000).toISOString(), grund: deckung.grund })
          break
        }
      }
      const next = args.trocken ? trockenFolge({ fill, stufen, status }) : await bucheFill({ t: { ...t, status }, fill, stufen })
      stufen = next.stufen
      status = next.status
      events.push({ id: (events[events.length - 1]?.id ?? 0) + 1, tradeId: t.id,
        userId: t.userId, type: fill.art === 'einstieg' ? 'eroeffnet' : fill.schliesst ? 'geschlossen' : 'teilverkauf',
        at: new Date(fill.zeit * 1000), quantity: fill.menge, price: fill.preis,
        fee: 0, payload: null, note: fill.grund, createdAt: new Date() })
      result.zeilen.push({ tradeId: t.id, ticker: t.ticker, art: fill.art,
        preis: fill.preis, menge: fill.menge, zeit: new Date(fill.zeit * 1000).toISOString(), grund: fill.grund })
      if (fill.art === 'einstieg') result.einstiege++
      else if (fill.art === 'teilziel') result.teilziele++
      else result.abschluesse++
      result.closed = fill.schliesst
      if (result.closed) break
    }
  }
  return result
}

async function deckungReicht(
  t: typeof trade.$inferSelect,
): Promise<{ ok: true } | { ok: false; grund: string }> {
  // Kein Kontrakt-Trade oder kein Einschuss in Kontowährung bekannt (Fremd-
  // währung ohne hinterlegten Kurs) → nichts zu prüfen, und geraten wird nicht.
  if (t.contracts == null || t.investedAmount == null || !t.contractCurrency) return { ok: true }

  const [depot] = await db
    .select()
    .from(portfolio)
    .where(eq(portfolio.id, t.portfolioId))
  if (!depot) return { ok: true }

  const zeilen = await db
    // `contracts` muss mit: `gebundeneMargin` zählt nur Kontrakt-Trades.
    .select({
      status: trade.status,
      investedAmount: trade.investedAmount,
      contracts: trade.contracts,
    })
    .from(trade)
    .where(and(eq(trade.userId, t.userId), eq(trade.portfolioId, t.portfolioId)))

  const abgeschlossen = await db
    .select()
    .from(trade)
    .where(
      and(
        eq(trade.userId, t.userId),
        eq(trade.portfolioId, t.portfolioId),
        eq(trade.status, 'abgeschlossen'),
      ),
    )
  let realisiertePnl = 0
  for (const alt of abgeschlossen) {
    const evs = await ladeEreignisse(alt.userId, alt.id)
    realisiertePnl += tradeNetPnl(alt, evs) ?? 0
  }

  const flows = await loadScopedCashflows(t.userId, [t.portfolioId])

  // Der eigene Einschuss wird aus der Bindung herausgerechnet und als das
  // geprüft, was er ist — sonst zählte er doppelt.
  const deckung = berechneDeckung({
    startCapital: depot.startCapital,
    netCashflow: netCashflow(flows),
    realisiertePnl,
    gebundeneMargin: gebundeneMargin(zeilen) - t.investedAmount,
  })

  const [einst] = await db
    .select({ currency: userSettings.currency })
    .from(userSettings)
    .where(eq(userSettings.userId, t.userId))
  const kontowaehrung = einst?.currency ?? 'EUR'

  // `investedAmount` steht bereits in Kontowährung (so schreibt es `createTrade`),
  // deshalb wird hier nicht noch einmal umgerechnet.
  const pruefung = pruefeDeckung({
    einschuss: t.investedAmount,
    waehrung: kontowaehrung,
    kontowaehrung,
    rates: parseFxRates(depot.fxRates),
    deckung,
    label: `${t.ticker} · ${t.contracts} Kontrakte`,
  })
  return pruefung.ok ? { ok: true } : { ok: false, grund: pruefung.grund }
}

/**
 * Einen ungedeckten Trade verwerfen: Status `abgebrochen`, mit einem Ereignis,
 * das den Grund trägt. Kein Einstiegs-Ereignis — die Position hat es nie
 * gegeben, und eine erfundene Eröffnung wäre schlimmer als ein Abbruch.
 */
async function verwerfeUngedeckt(
  t: typeof trade.$inferSelect,
  at: Date,
  grund: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(trade)
      .set({ status: 'abgebrochen', closedAt: at, noTradeNote: grund })
      .where(and(eq(trade.id, t.id), eq(trade.userId, t.userId)))
    await tx.insert(tradeEvent).values({
      tradeId: t.id,
      userId: t.userId,
      type: 'geschlossen',
      at,
      quantity: 0,
      price: null,
      payload: JSON.stringify({
        auto: true,
        quelle: 'demo-fill',
        interval: FILL_INTERVAL,
        grund: 'ungedeckt',
      }),
      note: grund,
    })
  })
}

async function ladeEreignisse(userId: string, tradeId: number): Promise<TradeEventRow[]> {
  return db
    .select()
    .from(tradeEvent)
    .where(and(eq(tradeEvent.tradeId, tradeId), eq(tradeEvent.userId, userId)))
    .orderBy(asc(tradeEvent.at), asc(tradeEvent.id))
}

async function ladeStufen(userId: string, tradeId: number): Promise<TradeTargetRow[]> {
  return db
    .select()
    .from(tradeTarget)
    .where(and(eq(tradeTarget.tradeId, tradeId), eq(tradeTarget.userId, userId)))
    .orderBy(asc(tradeTarget.sortOrder), asc(tradeTarget.id))
}

/**
 * Ein einzelnes Ereignis buchen — in EINER Transaktion, damit Ereignis,
 * Zielstufe und Trade-Zustand nie auseinanderfallen.
 *
 * Die Ausführungszeit ist die KERZENZEIT, nicht die Uhrzeit des Laufs. Sonst
 * trüge ein Stop, der um 09:35 auslöste und um 10:00 gefunden wird, die falsche
 * Zeit — und jede Auswertung über Tageszeiten wäre stillschweigend verschoben.
 */
async function bucheFill(args: {
  t: typeof trade.$inferSelect
  fill: DemoFill
  stufen: TradeTargetRow[]
}): Promise<{ stufen: TradeTargetRow[]; status: string }> {
  const { t, fill } = args
  const at = new Date(fill.zeit * 1000)
  // Die Herkunft steht im Ereignis, nicht in einer neuen Spalte: Daran erkennt
  // die Oberfläche, bei welchen Trades der Check-in noch nachzuholen ist.
  const payload = JSON.stringify({ auto: true, quelle: 'demo-fill', interval: FILL_INTERVAL, preisModus: 'plan', art: fill.art })
  let status = t.status

  const eventTyp =
    fill.art === 'einstieg' ? 'eroeffnet' : fill.art === 'teilziel' ? 'teilverkauf' : 'geschlossen'

  await db.transaction(async (tx) => {
    const [ev] = await tx
      .insert(tradeEvent)
      .values({
        tradeId: t.id,
        userId: t.userId,
        type: eventTyp,
        at,
        quantity: fill.menge,
        price: fill.preis,
        payload,
        note: fill.grund,
      })
      .returning({ id: tradeEvent.id })

    if (fill.art === 'einstieg') {
      // Der PLAN bleibt unangetastet: `entryPrice` ist das vereinbarte Level,
      // Der Demo-Fill nutzt dasselbe Level; die Herkunft steht im Ereignis.
      await tx
        .update(trade)
        .set({ status: 'aktiv', openedAt: at })
        .where(and(eq(trade.id, t.id), eq(trade.userId, t.userId)))
      status = 'aktiv'
    }

    if (fill.targetId != null) {
      await tx
        .update(tradeTarget)
        .set({
          executedAt: at,
          executedPrice: fill.preis,
          executedQty: fill.menge,
          eventId: ev.id,
        })
        .where(and(eq(tradeTarget.id, fill.targetId), eq(tradeTarget.userId, t.userId)))
    }

    if (fill.schliesst) {
      // Das Ergebnis wird nicht geschätzt, sondern aus den Ereignissen
      // gefaltet — dieselbe Quelle, die auch die Hand-Buchung nutzt
      // (`settlePosition`). Teilverkäufe zählen dadurch mit.
      const alle = await tx
        .select()
        .from(tradeEvent)
        .where(and(eq(tradeEvent.tradeId, t.id), eq(tradeEvent.userId, t.userId)))
        .orderBy(asc(tradeEvent.at), asc(tradeEvent.id))
      const settle = settlePosition(t, alle)

      await tx
        .update(trade)
        .set({
          status: 'abgeschlossen',
          result: ergebnisAus(settle.totalNet),
          actualExitPrice: fill.preis,
          // Die Ausführung IST der Plan — das ist der ganze Punkt der
          // Automatik. Anders als beim Abschluss von Hand gibt es hier keinen
          // Ermessensspielraum, der nachträglich beschönigt werden könnte.
          followedPlan: t.followedPlan !== false && parseViolations(t.ruleViolations).length === 0,
          closedAt: at,
          // `moodExit` und `lossAccepted` bleiben BEWUSST leer — sie werden
          // nachgefordert. Eine Maschine kann keinen Verlust bewusst annehmen;
          // ein voreingetragener Haken wäre eine Lüge im Disziplin-Teil.
        })
        .where(and(eq(trade.id, t.id), eq(trade.userId, t.userId)))
      status = 'abgeschlossen'
    }
  })

  // Die Stufe ist jetzt ausgeführt — der nächste Durchlauf darf sie nicht
  // erneut treffen.
  const stufen =
    fill.targetId == null
      ? args.stufen
      : args.stufen.map((z) =>
          z.id === fill.targetId
            ? { ...z, executedAt: at, executedPrice: fill.preis, executedQty: fill.menge }
            : z,
        )

  return { stufen, status }
}

/**
 * Die Zustandsfortschreibung des Trockenlaufs — dieselbe Wirkung wie
 * `bucheFill`, nur ohne Schreibzugriff. Beide Wege müssen denselben Zustand
 * ergeben, sonst zeigte der Trockenlauf einen anderen Verlauf als der echte
 * Lauf und wäre wertlos.
 */
function trockenFolge(args: {
  fill: DemoFill
  stufen: TradeTargetRow[]
  status: string
}): { stufen: TradeTargetRow[]; status: string } {
  const { fill } = args
  const at = new Date(fill.zeit * 1000)
  const stufen =
    fill.targetId == null
      ? args.stufen
      : args.stufen.map((z) =>
          z.id === fill.targetId
            ? { ...z, executedAt: at, executedPrice: fill.preis, executedQty: fill.menge }
            : z,
        )
  const status = fill.schliesst ? 'abgeschlossen' : fill.art === 'einstieg' ? 'aktiv' : args.status
  return { stufen, status }
}

/** Gewinn, Verlust oder Nullrunde — die Schwelle liegt bei einem Cent. */
function ergebnisAus(netto: number): 'gewinn' | 'verlust' | 'breakeven' {
  if (!Number.isFinite(netto) || Math.abs(netto) < 0.01) return 'breakeven'
  return netto > 0 ? 'gewinn' : 'verlust'
}
