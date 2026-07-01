// Zentrale Geld-/Gebühren-Rechenlogik für Trades.
// EINE Quelle für Formular (Live-Vorschau), Server-Actions (persistierte P&L)
// und Anzeige (Trade-Card / Detailseite) — keine doppelte Logik.

/** Ordergebühr je Order (Kauf ODER Verkauf) in Euro. */
export const ORDER_FEE_EUR = 9
/** Voller Round-Trip: ein Kauf + ein Verkauf. */
export const ROUND_TRIP_FEE_EUR = ORDER_FEE_EUR * 2

export type Direction = 'long' | 'short'

/** Stückzahl aus Kapitaleinsatz und Einstiegskurs. Fraktional erlaubt (Krypto). */
export function computeShares(invested: number, entry: number): number {
  if (!invested || !entry || entry <= 0) return 0
  return invested / entry
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
 * Gebühren = ein Kauf (Einstieg) + ein Verkauf (Take-Profit) = 18 €.
 */
export function projectTakeProfit(args: {
  invested: number
  entry: number
  tp: number
  direction: Direction
  sellPct: number // 0..100
}): TakeProfitProjection | null {
  const { invested, entry, tp, direction } = args
  if (!invested || !entry || !tp) return null
  const pct = clampPct(args.sellPct)
  const shares = computeShares(invested, entry)
  const soldShares = shares * (pct / 100)
  const proceeds = soldShares * tp
  const grossProfit = directionalDiff(tp, entry, direction) * soldShares
  const fees = ROUND_TRIP_FEE_EUR
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
 * Gebühren = ein Kauf + ein Verkauf = 18 €.
 */
export function projectStopLoss(args: {
  invested: number
  entry: number
  sl: number
  direction: Direction
}): StopLossProjection | null {
  const { invested, entry, sl, direction } = args
  if (!invested || !entry || !sl) return null
  const shares = computeShares(invested, entry)
  // directionalDiff ist bei einem SL negativ (long: sl<entry, short: sl>entry).
  const grossLoss = directionalDiff(sl, entry, direction) * shares
  const fees = ROUND_TRIP_FEE_EUR
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
