// Zentrale Geld-/Gebühren-Rechenlogik für Trades.
// EINE Quelle für Formular (Live-Vorschau), Server-Actions (persistierte P&L)
// und Anzeige (Trade-Card / Detailseite) — keine doppelte Logik.

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

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 100
  if (v < 0) return 0
  if (v > 100) return 100
  return v
}
