import { frozenFxRate, type MoneyMetadata } from './money-currency'

export type PlanContext = {
  version: 1
  expectedMove: string
  entryTrigger: string
  stopManagement: string
  targetManagement: string
  riskConfirmed: boolean
  rules?: { name: string; version: string | null; text: string }[]
}

export const emptyPlanContext = (): PlanContext => ({ version: 1, expectedMove: '', entryTrigger: '',
  stopManagement: '', targetManagement: '', riskConfirmed: false })

export function normalizePlanContext(raw: unknown): PlanContext | null {
  if (raw == null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Plan-Kontext ist ungültig.')
  const r = raw as Record<string, unknown>
  const keys = ['version', 'expectedMove', 'entryTrigger', 'stopManagement', 'targetManagement', 'riskConfirmed', 'rules']
  if (r.version !== 1 || typeof r.riskConfirmed !== 'boolean' || Object.keys(r).some(k => !keys.includes(k))) {
    throw new Error('Plan-Kontext ist ungültig.')
  }
  const result = emptyPlanContext()
  for (const key of ['expectedMove', 'entryTrigger', 'stopManagement', 'targetManagement'] as const) {
    if (typeof r[key] !== 'string' || r[key].length > 4000) throw new Error('Planangaben sind ungültig.')
    result[key] = r[key].trim()
  }
  result.riskConfirmed = r.riskConfirmed
  if ('rules' in r) {
    if (!Array.isArray(r.rules) || r.rules.length > 20) throw new Error('Bestätigte Regelbezüge sind ungültig.')
    result.rules = r.rules.map(v => {
      if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !['name','version','text'].includes(k)) ||
          typeof v.name !== 'string' || !v.name.trim() || v.name.length > 200 || typeof v.text !== 'string' || !v.text.trim() || v.text.length > 4000 ||
          (v.version !== null && (typeof v.version !== 'string' || !v.version.trim() || v.version.length > 200))) throw new Error('Bestätigte Regelbezüge sind ungültig.')
      return { name: v.name.trim(), version: v.version?.trim() ?? null, text: v.text.trim() }
    })
  }
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
export function planningSnapshot(t: PlannedTrade & { feeEntry?: number | null; feeExit?: number | null; targets?: readonly unknown[] | null;
  elliottWaveCount?: string | null; waveDegree?: string | null; strategy?: string | null; setupTags?: string | null;
  investedAmount?: number | null; leverage?: number | null; contracts?: number | null; notes?: string | null }) {
  return { version: 2, planContext: t.planContext ?? null, entryPrice: t.entryPrice, stopLoss: t.stopLoss,
    takeProfit: t.takeProfit, elliottInvalidation: t.elliottInvalidation, positionSize: t.positionSize,
    direction: t.direction, quoteCurrency: t.quoteCurrency, accountCurrency: t.accountCurrency,
    quoteToAccountRate: t.quoteToAccountRate, fxRateAt: t.fxRateAt, feeEntry: t.feeEntry, feeExit: t.feeExit,
    targets: t.targets ?? null, elliottWaveCount: t.elliottWaveCount ?? null, waveDegree: t.waveDegree ?? null,
    strategy: t.strategy ?? null, setupTags: t.setupTags ?? null, investedAmount: t.investedAmount ?? null,
    notes: t.notes ?? null,
    leverage: t.leverage ?? null, contracts: t.contracts ?? null,
    ruleReferences: t.planContext?.rules ?? null, gaps: [
      ...(!t.planContext?.rules?.length ? ['Keine separate bestätigte Regelversion hinterlegt'] : t.planContext.rules.some(r=>!r.version) ? ['Mindestens ein Regelbezug ohne benannte Version'] : []),
      ...(t.targets === undefined ? ['Zielstaffel nicht geladen'] : [])] }
}
