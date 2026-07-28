// Prognosen und Trades je Instrument in einer Zeile.
//
// Bisher lebten die beiden Welten getrennt: `/analysis` kannte nur Prognosen,
// `/tracking` nur Trades ohne Instrumentenbezug. Damit war die eigentliche
// Douglas-Frage nirgends beantwortbar — nicht „lag ich richtig?" und nicht
// „habe ich verdient?", sondern die LÜCKE dazwischen. Wer bei einem Wert zu
// 70 % richtig liegt und trotzdem verliert, hat kein Analyse-, sondern ein
// Umsetzungsproblem. Diese Zahl steht hier.
//
// Nicht neu gerechnet wird nichts: Trefferquote, Erwartungswert und Plan-Treue
// kommen aus `baseBucket` in `lib/trade-stats.ts` — demselben Kern, auf dem
// Zustand, Setup und Zeit-Heatmap sitzen. Zwei Wege zur selben Kennzahl wären
// zwei Wahrheiten.

import {
  baseBucket,
  tradeNetPnl,
  type BucketCore,
  type TradeEventsByTrade,
  type TradeRow,
} from './trade-stats'

/**
 * Ab so vielen ENTSCHIEDENEN Trades gilt die Trade-Trefferquote eines
 * Instruments als belastbar.
 *
 * Bewusst niedriger als die übrigen Schwellen des Projekts (20 für Monte-Carlo,
 * 10 für Setups): Die dortigen Auswertungen fassen alle Trades zusammen, hier
 * wird auf ~90 Instrumente verteilt. Bei 10 bliebe die Trade-Hälfte auf Jahre
 * überall stumm. Die Quote wird deshalb IMMER gezeigt — unterhalb dieser
 * Schwelle aber mit der Grundlage darunter, damit „100 %" aus einem einzigen
 * Trade nicht wie Statistik aussieht.
 */
export const MIN_INSTRUMENT_TRADES = 5

/** Nur was die Prognose-Auswertung von einer `assessment`-Zeile braucht. */
export type AssessmentLike = {
  stockId: number
  isCorrect: boolean
  /** Zielzone nie angelaufen → weder richtig noch falsch. */
  zoneNotReached: boolean
}

/** Nur was diese Auswertung von einem Instrument braucht. */
export type InstrumentLike = {
  id: number
  ticker: string
  name: string
  market: string
}

export type AssessmentSide = {
  /** Alle Prognosen, auch die neutralen. */
  total: number
  correct: number
  wrong: number
  /** Zielzone nie angelaufen — zählt in keine Quote. */
  notReached: number
  /** correct + wrong — der Nenner der Quote. */
  decided: number
  /** 0–100, bezogen auf `decided`. */
  hitRate: number
}

export type MoneySide = {
  trades: number
  decided: number
  /** Summe des Netto-P&L in Kontowährung. Nur Echtgeld. */
  netPnl: number
  /** Ø R-Vielfaches. */
  expectancy: number
}

export type TradeSide = {
  /** Alle Trades am Instrument, auch geplante und nicht gehandelte. */
  total: number
  /** Entschiedene (Gewinn oder Verlust) — der Nenner der Quote. */
  decided: number
  /** Trefferquote, Erwartungswert, Plan-Treue aus dem gemeinsamen Kern. */
  core: BucketCore
  /** Echtgeld getrennt von Demo — eine gute Quote aus Papertrades ist keine. */
  money: MoneySide
  demo: MoneySide
  /** Ist `decided` groß genug für eine belastbare Quote? */
  enough: boolean
}

export type InstrumentStats = {
  stockId: number
  ticker: string
  name: string
  market: string
  assessments: AssessmentSide
  trades: TradeSide
  /**
   * Prognose-Trefferquote minus Trade-Trefferquote, in Prozentpunkten.
   * `null`, wenn eine der beiden Seiten keine entschiedene Zeile hat — eine
   * Lücke gegen nichts ist keine Aussage.
   *
   * Positiv heißt: Die Analyse trifft besser als die Umsetzung — dort sitzt das
   * Verhalten, nicht die Prognose.
   */
  gap: number | null
  /** Prognosen + Trades — der Sortierschlüssel „nach Aktivität". */
  activity: number
}

const DECIDED = new Set(['gewinn', 'verlust'])

function emptyMoneySide(): MoneySide {
  return { trades: 0, decided: 0, netPnl: 0, expectancy: 0 }
}

/** Geld- und R-Kennzahlen einer Teilmenge (Echtgeld oder Demo). */
function moneySide(rows: TradeRow[], eventsByTrade?: TradeEventsByTrade): MoneySide {
  if (rows.length === 0) return emptyMoneySide()
  const decided = rows.filter((t) => t.result && DECIDED.has(t.result))
  const core = baseBucket(decided, 1, eventsByTrade)
  const netPnl = decided.reduce(
    (acc, t) => acc + (tradeNetPnl(t, eventsByTrade?.get(t.id) ?? []) ?? 0),
    0,
  )
  return {
    trades: rows.length,
    decided: decided.length,
    netPnl,
    expectancy: core.expectancy,
  }
}

function assessmentSide(rows: AssessmentLike[]): AssessmentSide {
  let correct = 0
  let wrong = 0
  let notReached = 0
  for (const a of rows) {
    if (a.zoneNotReached) notReached++
    else if (a.isCorrect) correct++
    else wrong++
  }
  const decided = correct + wrong
  return {
    total: rows.length,
    correct,
    wrong,
    notReached,
    decided,
    hitRate: decided ? (correct / decided) * 100 : 0,
  }
}

function tradeSide(rows: TradeRow[], eventsByTrade?: TradeEventsByTrade): TradeSide {
  const decided = rows.filter((t) => t.result && DECIDED.has(t.result))
  return {
    total: rows.length,
    decided: decided.length,
    // Der gemeinsame Kern rechnet über die ENTSCHIEDENEN Trades — dieselbe
    // Auswahl wie Disziplin, Setup und Zeit-Heatmap.
    core: baseBucket(decided, MIN_INSTRUMENT_TRADES, eventsByTrade),
    money: moneySide(
      rows.filter((t) => t.tradedWithMoney),
      eventsByTrade,
    ),
    demo: moneySide(
      rows.filter((t) => !t.tradedWithMoney),
      eventsByTrade,
    ),
    enough: decided.length >= MIN_INSTRUMENT_TRADES,
  }
}

/**
 * Eine Zeile je Instrument, absteigend nach Aktivität.
 *
 * Instrumente ohne jede Prognose und ohne jeden Trade fallen raus — reine
 * Beobachtung ist Sache der Watchlist, nicht der Auswertung.
 */
export function computeInstrumentStats(
  instruments: InstrumentLike[],
  assessments: AssessmentLike[],
  trades: TradeRow[],
  eventsByTrade?: TradeEventsByTrade,
): InstrumentStats[] {
  const assessmentsByStock = new Map<number, AssessmentLike[]>()
  for (const a of assessments) {
    const list = assessmentsByStock.get(a.stockId)
    if (list) list.push(a)
    else assessmentsByStock.set(a.stockId, [a])
  }

  const tradesByStock = new Map<number, TradeRow[]>()
  for (const t of trades) {
    if (t.stockId == null) continue // ohne Instrument — siehe `lib/link-trades.ts`
    const list = tradesByStock.get(t.stockId)
    if (list) list.push(t)
    else tradesByStock.set(t.stockId, [t])
  }

  const out: InstrumentStats[] = []
  for (const inst of instruments) {
    const a = assessmentsByStock.get(inst.id) ?? []
    const t = tradesByStock.get(inst.id) ?? []
    if (a.length === 0 && t.length === 0) continue

    const assessmentStats = assessmentSide(a)
    const tradeStats = tradeSide(t, eventsByTrade)

    out.push({
      stockId: inst.id,
      ticker: inst.ticker,
      name: inst.name,
      market: inst.market,
      assessments: assessmentStats,
      trades: tradeStats,
      gap:
        assessmentStats.decided > 0 && tradeStats.decided > 0
          ? assessmentStats.hitRate - tradeStats.core.winRate
          : null,
      activity: assessmentStats.total + tradeStats.total,
    })
  }

  // Nach Aktivität, bei Gleichstand die bessere Prognosequote zuerst.
  out.sort((x, y) => y.activity - x.activity || y.assessments.hitRate - x.assessments.hitRate)
  return out
}

/**
 * Dieselbe Lücke über ALLE Instrumente zusammen.
 *
 * Auf der Auswertungsseite ist das die Zahl, die heute schon trägt: Je
 * Instrument sind die Trades noch dünn, in Summe aber nicht. `null`, solange
 * eine der beiden Seiten leer ist.
 */
export function overallGap(rows: InstrumentStats[]): {
  assessmentHitRate: number
  tradeHitRate: number
  gap: number
  assessmentsDecided: number
  tradesDecided: number
} | null {
  let aCorrect = 0
  let aDecided = 0
  let tWins = 0
  let tDecided = 0

  for (const r of rows) {
    aCorrect += r.assessments.correct
    aDecided += r.assessments.decided
    tWins += Math.round((r.trades.core.winRate / 100) * r.trades.decided)
    tDecided += r.trades.decided
  }

  if (aDecided === 0 || tDecided === 0) return null

  const assessmentHitRate = (aCorrect / aDecided) * 100
  const tradeHitRate = (tWins / tDecided) * 100
  return {
    assessmentHitRate,
    tradeHitRate,
    gap: assessmentHitRate - tradeHitRate,
    assessmentsDecided: aDecided,
    tradesDecided: tDecided,
  }
}
