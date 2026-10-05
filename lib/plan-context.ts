import { frozenFxRate, type MoneyMetadata } from './money-currency'

export type PlanContext = {
  version: 1
  expectedMove: string
  entryTrigger: string
  stopManagement: string
  targetManagement: string
  riskConfirmed: boolean
}

export const emptyPlanContext = (): PlanContext => ({ version: 1, expectedMove: '', entryTrigger: '',
  stopManagement: '', targetManagement: '', riskConfirmed: false })

export function normalizePlanContext(raw: unknown): PlanContext | null {
  if (raw == null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Plan-Kontext ist ungültig.')
  const r = raw as Record<string, unknown>
  const keys = ['version', 'expectedMove', 'entryTrigger', 'stopManagement', 'targetManagement', 'riskConfirmed']
  if (r.version !== 1 || typeof r.riskConfirmed !== 'boolean' || Object.keys(r).some(k => !keys.includes(k))) {
    throw new Error('Plan-Kontext ist ungültig.')
  }
  const result = emptyPlanContext()
  for (const key of ['expectedMove', 'entryTrigger', 'stopManagement', 'targetManagement'] as const) {
    if (typeof r[key] !== 'string' || r[key].length > 4000) throw new Error('Planangaben sind ungültig.')
    result[key] = r[key].trim()
  }
  result.riskConfirmed = r.riskConfirmed
  return result
}

type PlannedTrade = MoneyMetadata & {
  planContext?: PlanContext | null
  entryPrice?: number | null
  stopLoss?: number | null
  takeProfit?: number | null
  elliottInvalidation?: number | null
  positionSize?: number | null
  direction?: string
}
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

export function planGaps(t: PlannedTrade): string[] {
  let context: PlanContext | null = null
  try { context = normalizePlanContext(t.planContext) } catch { /* invalid is incomplete */ }
  const gaps: string[] = []
  if (!context?.expectedMove) gaps.push('Erwarteter Verlauf')
  if (!positive(t.elliottInvalidation)) gaps.push('Invalidierung')
  if (!positive(t.entryPrice) || !context?.entryTrigger) gaps.push('Einstieg und Auslöser')
  if (!positive(t.stopLoss) || !context?.stopManagement) gaps.push('Anfangsstop und Stop-Management')
  if (!positive(t.takeProfit) || !context?.targetManagement) gaps.push('Ziel und Ziel-Management')
  if (!positive(t.positionSize)) gaps.push('Positionsgröße')
  const fx = frozenFxRate(t)
  const risk = positive(t.entryPrice) && positive(t.stopLoss) && positive(t.positionSize) && fx !== null
    ? Math.abs(t.entryPrice - t.stopLoss) * t.positionSize * fx : NaN
  if (!positive(risk)) gaps.push('Währung und berechenbares Stop-Risiko')
  if (positive(t.entryPrice) && positive(t.stopLoss) && positive(t.takeProfit) &&
      !((t.direction === 'long' && t.stopLoss < t.entryPrice && t.takeProfit > t.entryPrice) ||
        (t.direction === 'short' && t.stopLoss > t.entryPrice && t.takeProfit < t.entryPrice))) {
    gaps.push('Stop und Ziel passend zur Richtung')
  }
  if (!context?.riskConfirmed) gaps.push('Risikobestätigung mit benannten Kosten und Datenlücken')
  return gaps
}

export function requireCompletePlan(t: PlannedTrade): void {
  const gaps = planGaps(t)
  if (gaps.length) throw new Error(`Plan noch unvollständig: ${gaps.join('; ')}.`)
}

/** Recorded at activation, never reconstructed from a later management change. */
export function planningSnapshot(t: PlannedTrade & { feeEntry?: number | null; feeExit?: number | null; targets?: readonly unknown[] | null }) {
  return { version: 1, planContext: t.planContext ?? null, entryPrice: t.entryPrice, stopLoss: t.stopLoss,
    takeProfit: t.takeProfit, elliottInvalidation: t.elliottInvalidation, positionSize: t.positionSize,
    direction: t.direction, quoteCurrency: t.quoteCurrency, accountCurrency: t.accountCurrency,
    quoteToAccountRate: t.quoteToAccountRate, fxRateAt: t.fxRateAt, feeEntry: t.feeEntry, feeExit: t.feeExit,
    targets: t.targets ?? [] }
}
