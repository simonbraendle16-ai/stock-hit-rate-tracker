// Zentrale Geld-/Gebühren-Rechenlogik für Trades.
// EINE Quelle für Formular (Live-Vorschau), Server-Actions (persistierte P&L)
// und Anzeige (Trade-Card / Detailseite) — keine doppelte Logik.

import { contractMultiplier } from './contract-specs'

/** Vorbelegung der Ordergebühr je Order, wenn ein Nutzer noch nichts eingestellt hat. */
export const DEFAULT_ORDER_FEE = 9

export type Direction = 'long' | 'short'

/** Gebühren eines Trades: je ein Betrag für Einstieg und Ausstieg. */
export type Fees = {
  entry: number
  exit: number
}

/** Fällt auf die Standardgebühr zurück, wenn nichts übergeben wurde. */
function resolveFees(fees?: Partial<Fees> | null): Fees {
  return {
    entry: Number.isFinite(fees?.entry) ? (fees!.entry as number) : DEFAULT_ORDER_FEE,
    exit: Number.isFinite(fees?.exit) ? (fees!.exit as number) : DEFAULT_ORDER_FEE,
  }
}

/**
 * Stückzahl aus Kapitaleinsatz, Einstiegskurs und Hebel. Fraktional erlaubt (Krypto).
 *
 * Der Hebel vergrößert die Position, nicht das gebundene Kapital: Bei 1.000 €
 * Einsatz und Hebel 5 wird eine Position über 5.000 € gehalten. Das Risiko
 * bleibt am Stop verankert — es steigt mit der Stückzahl, nicht mit dem Faktor
 * an sich.
 */
export function computeShares(invested: number, entry: number, leverage = 1): number {
  if (!invested || !entry || entry <= 0) return 0
  const lev = Number.isFinite(leverage) && leverage > 0 ? leverage : 1
  return (invested * lev) / entry
}

/** Positionswert = Kapitaleinsatz × Hebel. Das gebundene Kapital bleibt der Einsatz. */
export function computePositionValue(invested: number, leverage = 1): number {
  if (!invested) return 0
  const lev = Number.isFinite(leverage) && leverage > 0 ? leverage : 1
  return invested * lev
}

/** Chance-Risiko-Verhältnis (R:R) — richtungsunabhängig, null ohne Take-Profit. */
export function computeRiskReward(
  entry: number,
  stopLoss: number,
  takeProfit: number | null,
): number | null {
  if (takeProfit == null) return null
  const rr = Math.abs(takeProfit - entry) / Math.abs(entry - stopLoss)
  return Number.isFinite(rr) ? rr : null
}

/** Vorzeichen des Kursgewinns pro Stück in Richtung des Trades. */
function directionalDiff(exit: number, entry: number, direction: Direction): number {
  return direction === 'short' ? entry - exit : exit - entry
}

export type TakeProfitProjection = {
  shares: number // gesamte Position
  soldShares: number // beim TP verkaufter Anteil
  remainingShares: number // Restposition, die weiterläuft
  proceeds: number // Verkaufserlös des verkauften Anteils
  grossProfit: number // Rohgewinn vor Gebühren
  fees: number // Kauf- + Verkaufsgebühr
  netProfit: number // Gewinn nach Gebühren
}

/**
 * Projektion für den Take-Profit — für einen einstellbaren Verkaufsanteil.
 * Gebühren = Einstieg + Ausstieg; ohne Angabe die Standardgebühr.
 */
export function projectTakeProfit(args: {
  invested: number
  entry: number
  tp: number
  direction: Direction
  sellPct: number // 0..100
  leverage?: number
  fees?: Partial<Fees> | null
}): TakeProfitProjection | null {
  const { invested, entry, tp, direction } = args
  if (!invested || !entry || !tp) return null
  const pct = clampPct(args.sellPct)
  const shares = computeShares(invested, entry, args.leverage ?? 1)
  const soldShares = shares * (pct / 100)
  const proceeds = soldShares * tp
  const grossProfit = directionalDiff(tp, entry, direction) * soldShares
  const f = resolveFees(args.fees)
  const fees = f.entry + f.exit
  return {
    shares,
    soldShares,
    remainingShares: shares - soldShares,
    proceeds,
    grossProfit,
    fees,
    netProfit: grossProfit - fees,
  }
}

export type StopLossProjection = {
  shares: number
  grossLoss: number // negativer Rohbetrag (Kursverlust der vollen Position)
  fees: number
  netLoss: number // Verlust nach Gebühren (negativ)
}

/**
 * Projektion für den Stop-Loss über die VOLLE Position.
 * Gebühren = Einstieg + Ausstieg; ohne Angabe die Standardgebühr.
 */
export function projectStopLoss(args: {
  invested: number
  entry: number
  sl: number
  direction: Direction
  leverage?: number
  fees?: Partial<Fees> | null
}): StopLossProjection | null {
  const { invested, entry, sl, direction } = args
  if (!invested || !entry || !sl) return null
  const shares = computeShares(invested, entry, args.leverage ?? 1)
  // directionalDiff ist bei einem SL negativ (long: sl<entry, short: sl>entry).
  const grossLoss = directionalDiff(sl, entry, direction) * shares
  const f = resolveFees(args.fees)
  const fees = f.entry + f.exit
  return {
    shares,
    grossLoss,
    fees,
    netLoss: grossLoss - fees,
  }
}

// ---------------------------------------------------------------------------
// Kontrakte (Plan Demo-Handel, Teil 3)
// ---------------------------------------------------------------------------
//
// Ein Terminkontrakt wird nicht für einen Betrag gekauft, sondern gezählt. Das
// Risiko ist **Ticks × Tick-Wert × Kontrakte** — 2 ES mit 10 Ticks Abstand sind
// 2 × 10 × 12,50 $ = 250 $, unabhängig davon, wie viel Kapital jemand einsetzt.
//
// Der Brückenschlag zum Rest der App ist `contractPositionSize`: Es liefert
// `Kontrakte × Multiplikator`, und genau das steht am Trade in `positionSize`.
// Damit bleibt der bestehende Weg `(Ausstieg − Einstieg) × positionSize` in
// trade-stats, trade-events, excursion und bot-twin unverändert richtig. Es gibt
// keine zweite P&L-Rechnung — zwei Wege wären zwei Wahrheiten.

/** Die Tick-Anzahl zwischen zwei Kursen, richtungsunabhängig. */
export function ticksBetween(a: number, b: number, tickSize: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !tickSize) return 0
  return Math.abs(a - b) / tickSize
}

/**
 * Die Größe, die am Trade in `positionSize` landet: `Kontrakte × Multiplikator`.
 * Bei 2 ES also 100 — eine Bewegung um 1 Punkt ist 100 $ wert.
 */
export function contractPositionSize(contracts: number, spec: ContractSpecLike): number {
  if (!Number.isFinite(contracts) || contracts <= 0) return 0
  return contracts * contractMultiplier(spec)
}

/** Nur die Felder, die für die Rechnung nötig sind — der volle `ContractSpec` passt. */
export type ContractSpecLike = { tickSize: number; tickValue: number }

/**
 * Das geplante Risiko eines Kontrakt-Trades in der KONTRAKTWÄHRUNG:
 * Ticks × Tick-Wert × Kontrakte.
 */
export function contractRisk(args: {
  entry: number
  stopLoss: number
  contracts: number
  spec: ContractSpecLike
}): number {
  const ticks = ticksBetween(args.entry, args.stopLoss, args.spec.tickSize)
  return ticks * args.spec.tickValue * Math.max(0, args.contracts)
}

/**
 * Brutto-P&L eines Kontrakt-Trades in der Kontraktwährung, richtungsbewusst.
 *
 * **Das ist NICHT der produktive P&L-Weg.** Die App rechnet die P&L überall
 * über `(Ausstieg − Einstieg) × positionSize` (`tradeGrossPnl`, `settlePosition`),
 * und ein Kontrakt-Trade legt in `positionSize` bereits `Kontrakte ×
 * Multiplikator` ab — deshalb stimmt sie dort ohne Zutun.
 *
 * Diese Funktion ist die REFERENZRECHNUNG in Tick-Schreibweise: Sie macht die
 * Deckungsgleichheit beider Wege überhaupt prüfbar (`contract-math.test.ts`).
 * Wer sie in Produktivcode einbaut, schafft einen zweiten P&L-Weg — und zwei
 * Wege wären zwei Wahrheiten. Bitte nicht.
 */
export function contractPnl(args: {
  entry: number
  exit: number
  direction: Direction
  contracts: number
  spec: ContractSpecLike
}): number {
  const diff = directionalDiff(args.exit, args.entry, args.direction)
  return diff * contractPositionSize(args.contracts, args.spec)
}

/** Der Kontraktwert („Notional"): Kurs × Kontraktgröße × Kontrakte. */
export function contractNotional(args: {
  entry: number
  contracts: number
  contractSize: number
}): number {
  if (!Number.isFinite(args.entry) || args.entry <= 0) return 0
  return args.entry * args.contractSize * Math.max(0, args.contracts)
}

/**
 * Der Einschuss, den dieser Trade bindet — in der KONTRAKTWÄHRUNG.
 *
 * `fest`: der Betrag der Börse je Kontrakt, mal Anzahl. `notional`: Kontraktwert
 * geteilt durch den Hebel — so rechnen die Krypto-Perpetuals, dort gibt es
 * keinen festen Betrag je Kontrakt.
 */
export function requiredMargin(args: {
  spec: MarginSpecLike
  contracts: number
  entry: number
  leverage?: number
}): number {
  const n = Math.max(0, args.contracts)
  if (!n) return 0
  if (args.spec.marginModel === 'fest') return args.spec.initialMargin * n
  const lev = Number.isFinite(args.leverage) && (args.leverage as number) > 0 ? (args.leverage as number) : 1
  const notional = contractNotional({
    entry: args.entry,
    contracts: n,
    contractSize: args.spec.contractSize,
  })
  return notional / lev
}

/** Der Teil der Spezifikation, den der Einschuss braucht. */
export type MarginSpecLike =
  | {
      marginModel: 'fest'
      initialMargin: number
      maintenanceMargin: number
      contractSize: number
    }
  | { marginModel: 'notional'; maintenanceRate: number; contractSize: number }

/**
 * Der Erhaltungssatz in der Kontraktwährung — was mindestens auf dem Konto
 * stehen muss, damit die Position nicht zwangsweise geschlossen wird.
 *
 * Noch von keiner Stelle aufgerufen: Die Deckungsprüfung arbeitet mit dem
 * ANFANGSeinschuss (`requiredMargin`), weil sie beim Eröffnen greift. Der
 * Haltebetrag wird gebraucht, sobald es eine Warnung für laufende Positionen
 * gibt („noch X bis zum Nachschuss") — die Zahl steht hier bereit, damit sie
 * dann nicht neu erfunden wird.
 */
export function maintenanceMarginOf(args: {
  spec: MarginSpecLike
  contracts: number
  entry: number
}): number {
  const n = Math.max(0, args.contracts)
  if (!n) return 0
  if (args.spec.marginModel === 'fest') return args.spec.maintenanceMargin * n
  return (
    contractNotional({ entry: args.entry, contracts: n, contractSize: args.spec.contractSize }) *
    args.spec.maintenanceRate
  )
}

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 100
  if (v < 0) return 0
  if (v > 100) return 100
  return v
}
