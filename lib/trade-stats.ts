// Reine Statistik- und P&L-Logik über bereits geladene Trade-Zeilen.
//
// Bewusst OHNE 'use server', ohne DB-Zugriff und ohne Auth: dadurch ist die
// Geldmathematik direkt testbar (`lib/trade-stats.test.ts`). Die Server Actions
// in `app/actions/trades.ts` laden die Zeilen und rufen nur noch hier hinein —
// keine zweite Rechenlogik daneben.

import type { trade } from '@/lib/db/schema'
import {
  EMOTION_TAGS,
  MIN_GROUP_SIZE,
  MOOD_GROUPS,
  moodGroupOf,
  parseMoodTags,
  type MoodTone,
} from '@/lib/emotions'

export type TradeRow = typeof trade.$inferSelect
export type RuleViolation = 'stop_moved' | 'invalidation_ignored' | 'revenge'

/** Eine Ein- oder Auszahlung aufs Handelskonto. */
export type CashflowRow = {
  amount: number // immer positiv; die Richtung steckt in `kind`
  kind: 'einzahlung' | 'auszahlung'
  occurredAt: Date | string
  note?: string | null
}

// ---------------------------------------------------------------------------
// Einzelner Trade
// ---------------------------------------------------------------------------

/**
 * Tatsächlich gezahlte Ordergebühren eines Trades (Kauf + Verkauf).
 *
 * Die Werte stehen seit Migration 0010 auf dem Trade selbst und werden beim
 * Abschluss eingefroren — dadurch verändert eine spätere Änderung der
 * Standard-Gebühr in den Einstellungen die Historie NICHT mehr rückwirkend.
 * Demo-/Papertrades kosten nichts.
 */
export function tradeFees(t: TradeRow): number {
  if (!t.tradedWithMoney) return 0
  return (t.feeEntry ?? 0) + (t.feeExit ?? 0)
}

/**
 * Brutto-P&L vor Gebühren.
 *
 * Verlangt einen Ausstiegskurs, sobald ein Ergebnis feststeht — `closeTrade`
 * erzwingt ihn. Fehlt er bei Altbestand trotzdem, liefert die Funktion `null`
 * statt eines erfundenen Betrags; solche Trades bleiben aus Bilanz und
 * Erwartungswert heraus, statt sie zu verfälschen.
 */
export function tradeGrossPnl(t: TradeRow): number | null {
  if (t.result === 'breakeven' || !t.result) return 0
  if (t.actualExitPrice == null || t.entryPrice == null) return null
  const size = t.positionSize ?? 1
  return (t.actualExitPrice - t.entryPrice) * (t.direction === 'short' ? -size : size)
}

/** Netto-P&L: Brutto minus eingefrorene Gebühren. `null`, wenn nicht berechenbar. */
export function tradePnl(t: TradeRow): number | null {
  const gross = tradeGrossPnl(t)
  return gross === null ? null : gross - tradeFees(t)
}

/** Trades, deren P&L feststeht — die einzige Basis für Geldkennzahlen. */
export function hasPnl(t: TradeRow): boolean {
  return tradePnl(t) !== null
}

/** P&L oder 0 — für Summen, in denen unvollständige Trades nicht mitzählen sollen. */
function pnlOrZero(t: TradeRow): number {
  return tradePnl(t) ?? 0
}

/**
 * Risiko in Kontowährung = |Einstieg − Stop| × Stückzahl.
 * Der Hebel steckt bereits in `positionSize` und wirkt daher automatisch mit.
 */
export function tradeRisk(t: TradeRow): number {
  const size = t.positionSize ?? 1
  const r = Math.abs(t.entryPrice - t.stopLoss) * size
  return r > 0 ? r : size * 10
}

export function parseViolations(raw: string | null): RuleViolation[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? (v as RuleViolation[]) : []
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Cashflows
// ---------------------------------------------------------------------------

/** Nettosumme aller Ein-/Auszahlungen (Einzahlung positiv, Auszahlung negativ). */
export function netCashflow(flows: CashflowRow[]): number {
  return flows.reduce((acc, c) => acc + (c.kind === 'auszahlung' ? -c.amount : c.amount), 0)
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

export type DisciplineStats = {
  completed: number
  disciplineScore: number // 0-100, Anteil plan-konformer Trades
  winRate: number // 0-100
  expectancy: number // Ø R-Vielfaches
  streak: number // plan-konforme Trades in Folge, vom jüngsten rückwärts
  ruleViolations: number
  totalPnL: number
  startCapital: number
  currentBalance: number
  returnPct: number
  incomplete: number // abgeschlossene Trades ohne berechenbaren P&L
}

/**
 * Disziplin- und Geldkennzahlen über die abgeschlossenen Trades.
 * `rows` muss chronologisch nach Abschluss sortiert sein (ältester zuerst).
 */
export function computeDisciplineStats(
  rows: TradeRow[],
  startCapital: number,
  cashflows: CashflowRow[] = [],
): DisciplineStats {
  const completed = rows.length
  const followed = rows.filter((t) => t.followedPlan).length
  const wins = rows.filter((t) => t.result === 'gewinn').length
  const disciplineScore = completed ? (followed / completed) * 100 : 0

  // Win-Rate und Erwartungswert beide über ENTSCHIEDENE Trades (Gewinn|Verlust),
  // damit sie denselben Nenner nutzen. Breakeven zählt in keine der beiden.
  const decisive = rows.filter((t) => t.result === 'gewinn' || t.result === 'verlust')
  const winRate = decisive.length ? (wins / decisive.length) * 100 : 0

  // Erwartungswert nur über Trades mit bekanntem P&L — ein unvollständiger Trade
  // darf das R-Vielfache nicht nach unten ziehen.
  const rated = decisive.filter(hasPnl)
  const rSum = rated.reduce((acc, t) => acc + pnlOrZero(t) / tradeRisk(t), 0)
  const expectancy = rated.length ? rSum / rated.length : 0

  let streak = 0
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].followedPlan) streak++
    else break
  }

  const ruleViolations = rows.reduce((acc, t) => acc + parseViolations(t.ruleViolations).length, 0)

  // Kontobilanz NUR aus Echtgeld-Trades — Demo darf das reale Kapital nicht verfälschen.
  const money = rows.filter((t) => t.tradedWithMoney)
  const totalPnL = money.reduce((acc, t) => acc + pnlOrZero(t), 0)

  // Eingezahltes Kapital = Startkapital + Netto-Cashflows. Die Rendite misst
  // gegen das tatsächlich eingesetzte Geld, nicht gegen einen fixen Startwert.
  const invested = startCapital + netCashflow(cashflows)
  const currentBalance = invested + totalPnL
  const returnPct = invested ? (totalPnL / invested) * 100 : 0

  return {
    completed,
    disciplineScore,
    winRate,
    expectancy,
    streak,
    ruleViolations,
    totalPnL,
    startCapital,
    currentBalance,
    returnPct,
    incomplete: rows.filter((t) => t.result && !hasPnl(t)).length,
  }
}

export type EquityPoint = {
  date: string
  label: string
  balance: number
  kind: 'trade' | 'cashflow'
  note?: string
}

export type EquityStats = {
  startCapital: number
  points: EquityPoint[]
  maxDrawdown: number // größter Rückgang vom Hoch, in Kontowährung (>= 0)
  maxDrawdownPct: number // relativ zum jeweiligen Hoch, 0-100
  worstLossStreak: number
  currentLossStreak: number
}

function labelFor(d: Date): string {
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

/**
 * Equity-Kurve, Max-Drawdown und Verlust-Serien — nur Echtgeld, chronologisch.
 *
 * Ein- und Auszahlungen erscheinen als eigene Punkte (`kind: 'cashflow'`) und
 * zählen NICHT in den Drawdown: eine Auszahlung ist kein Verlust.
 */
export function computeEquityStats(
  rows: TradeRow[],
  startCapital: number,
  cashflows: CashflowRow[] = [],
): EquityStats {
  const money = rows.filter((t) => t.tradedWithMoney && hasPnl(t))

  type Event =
    | { at: Date; kind: 'trade'; delta: number }
    | { at: Date; kind: 'cashflow'; delta: number; note: string }

  const events: Event[] = [
    ...money.map((t): Event => ({
      at: t.closedAt ? new Date(t.closedAt) : new Date(t.createdAt),
      kind: 'trade',
      delta: pnlOrZero(t),
    })),
    ...cashflows.map((c): Event => ({
      at: new Date(c.occurredAt),
      kind: 'cashflow',
      delta: c.kind === 'auszahlung' ? -c.amount : c.amount,
      note: c.note || (c.kind === 'auszahlung' ? 'Auszahlung' : 'Einzahlung'),
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime())

  const points: EquityPoint[] = []
  let balance = startCapital
  let peak = startCapital
  let maxDrawdown = 0
  let maxDrawdownPct = 0

  for (const e of events) {
    balance += e.delta
    if (e.kind === 'cashflow') {
      // Eingezahltes Geld hebt den Referenzwert mit an, ausgezahltes senkt ihn —
      // sonst würde eine Auszahlung als Drawdown erscheinen.
      peak += e.delta
      if (peak < 0) peak = 0
    } else {
      if (balance > peak) peak = balance
      const dd = peak - balance
      if (dd > maxDrawdown) maxDrawdown = dd
      if (peak > 0) {
        const ddPct = (dd / peak) * 100
        if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct
      }
    }
    points.push({
      date: e.at.toISOString(),
      label: labelFor(e.at),
      balance,
      kind: e.kind,
      ...(e.kind === 'cashflow' ? { note: e.note } : {}),
    })
  }

  // Verlust-Serien über ALLE entschiedenen Trades (Echtgeld + Demo), chronologisch.
  const decisive = rows.filter((t) => t.result === 'gewinn' || t.result === 'verlust')
  let worstLossStreak = 0
  let run = 0
  for (const t of decisive) {
    if (t.result === 'verlust') {
      run++
      if (run > worstLossStreak) worstLossStreak = run
    } else {
      run = 0
    }
  }
  let currentLossStreak = 0
  for (let i = decisive.length - 1; i >= 0; i--) {
    if (decisive[i].result === 'verlust') currentLossStreak++
    else break
  }

  return { startCapital, points, maxDrawdown, maxDrawdownPct, worstLossStreak, currentLossStreak }
}

// ---------------------------------------------------------------------------
// Emotions-Auswertung (Etappe 4)
// ---------------------------------------------------------------------------

/** Eine Zeile der Zustands-Auswertung — Gruppe, Tag oder Gesamtvergleich. */
export type MoodBucket = {
  key: string
  label: string
  tone: MoodTone | 'neutral'
  /** Entschiedene Trades (Gewinn|Verlust) in dieser Zeile — der Nenner der Quote. */
  trades: number
  /** Davon mit berechenbarem P&L — die Basis des Erwartungswerts. */
  rated: number
  winRate: number // 0-100
  expectancy: number // Ø R-Vielfaches
  planFollowedRate: number // 0-100
  /** Erst ab `MIN_GROUP_SIZE` Trades zeigt die UI Zahlen statt „zu wenige Daten". */
  enough: boolean
}

export type MoodCoverage = {
  /** Entschiedene Trades insgesamt — die Obergrenze für alles Weitere. */
  decided: number
  withEntryMood: number
  withEntryTags: number
  withExitMood: number
}

export type MoodStats = {
  minGroupSize: number
  coverage: MoodCoverage
  /** Immer alle drei Gruppen, auch leere — sonst verschiebt sich die Tabelle. */
  byEntryGroup: MoodBucket[]
  /** Nur Tags, die mindestens einmal vergeben wurden. */
  byEntryTag: MoodBucket[]
  byExitGroup: MoodBucket[]
  /** Alle entschiedenen Trades — der Bezugspunkt, gegen den man die Gruppen liest. */
  overall: MoodBucket
}

/** Nur Trades mit Ergebnis Gewinn/Verlust — Breakeven hat keine Trefferquote. */
function decisiveRows(rows: TradeRow[]): TradeRow[] {
  return rows.filter((t) => t.result === 'gewinn' || t.result === 'verlust')
}

/**
 * Kennzahlen einer beliebigen Teilmenge — dieselben Definitionen wie in
 * `computeDisciplineStats`: Trefferquote über entschiedene Trades,
 * Erwartungswert nur über die mit berechenbarem P&L.
 */
function moodBucket(
  key: string,
  label: string,
  tone: MoodTone | 'neutral',
  rows: TradeRow[],
): MoodBucket {
  const trades = rows.length
  const wins = rows.filter((t) => t.result === 'gewinn').length
  const rated = rows.filter(hasPnl)
  const rSum = rated.reduce((acc, t) => acc + pnlOrZero(t) / tradeRisk(t), 0)
  const followed = rows.filter((t) => t.followedPlan).length

  return {
    key,
    label,
    tone,
    trades,
    rated: rated.length,
    winRate: trades ? (wins / trades) * 100 : 0,
    expectancy: rated.length ? rSum / rated.length : 0,
    planFollowedRate: trades ? (followed / trades) * 100 : 0,
    enough: trades >= MIN_GROUP_SIZE,
  }
}

/**
 * Zustand vs. Ergebnis — der eigentliche Punkt von Etappe 4.
 *
 * Ausgewertet werden ausschließlich **entschiedene** Trades (Gewinn|Verlust).
 * Trades ohne Check-in (Altbestand) tauchen in keiner Gruppe auf, sondern nur
 * in `coverage` — so bleibt sichtbar, auf wie vielen Daten die Aussage steht,
 * ohne dass ein fehlender Zustand stillschweigend als „ruhig" durchgeht.
 *
 * Die Tag-Auswertung ist bewusst **mehrfachzählend**: ein Trade mit `fomo` und
 * `ungeduld` erscheint in beiden Zeilen. Die Tag-Zahlen summieren sich deshalb
 * nicht auf die Gesamtzahl — sie beantworten je Tag die Frage „was kosten mich
 * meine FOMO-Trades", nicht „wie teilt sich mein Handel auf".
 */
export function computeMoodStats(rows: TradeRow[]): MoodStats {
  const decided = decisiveRows(rows)

  const byEntryGroup = MOOD_GROUPS.map((g) =>
    moodBucket(
      g.key,
      g.label,
      g.tone,
      decided.filter((t) => moodGroupOf(t.moodEntry) === g.key),
    ),
  )

  const byExitGroup = MOOD_GROUPS.map((g) =>
    moodBucket(
      g.key,
      g.label,
      g.tone,
      decided.filter((t) => moodGroupOf(t.moodExit) === g.key),
    ),
  )

  const byEntryTag = EMOTION_TAGS.map((tag) =>
    moodBucket(
      tag.key,
      tag.label,
      tag.tone === 'tragend' ? 'ruhig' : 'unruhig',
      decided.filter((t) => parseMoodTags(t.moodEntryTags).includes(tag.key)),
    ),
  ).filter((b) => b.trades > 0)

  return {
    minGroupSize: MIN_GROUP_SIZE,
    coverage: {
      decided: decided.length,
      withEntryMood: decided.filter((t) => moodGroupOf(t.moodEntry) !== null).length,
      withEntryTags: decided.filter((t) => parseMoodTags(t.moodEntryTags).length > 0).length,
      withExitMood: decided.filter((t) => moodGroupOf(t.moodExit) !== null).length,
    },
    byEntryGroup,
    byEntryTag,
    byExitGroup,
    overall: moodBucket('gesamt', 'alle Trades', 'neutral', decided),
  }
}
