import type { TradeInput } from '@/app/actions/trades'
import { ApiError, onlyKeys } from './assistant-api'
import { normalizePlanContext } from './plan-context'
import { MAX_TEILZIELE, type TargetPlanInput } from './trade-targets'
import { serializeSetupTags } from './setups'

export const PLAN_PATCH_KEYS = ['notes','strategy','setupTags','planContext','elliottInvalidation','elliottWaveCount','waveDegree',
  'entryPrice','stopLoss','takeProfit','positionSize','investedAmount','leverage','feeEntry','feeExit','targets'] as const
export function normalizePlanPatch(raw: Record<string, unknown>, active = false): Partial<TradeInput> {
  onlyKeys(raw, PLAN_PATCH_KEYS)
  if (!Object.keys(raw).length) throw new ApiError(422, 'Mindestens eine Planangabe erforderlich.')
  if (active && ['entryPrice','positionSize','investedAmount','leverage','feeEntry','feeExit'].some(k => k in raw)) {
    throw new ApiError(422, 'Aktive Ausführungsdaten über Nachkauf, Verkauf oder Ereigniskorrektur ändern.')
  }
  const patch: Partial<TradeInput> = {}
  for (const key of ['entryPrice','stopLoss','takeProfit','positionSize','investedAmount','leverage','feeEntry','feeExit','elliottInvalidation'] as const) {
    if (!(key in raw)) continue
    const v = raw[key]
    if (v === null && ['elliottInvalidation','investedAmount','positionSize'].includes(key)) { (patch as Record<string, unknown>)[key] = null; continue }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (v === 0 && !key.startsWith('fee'))) throw new ApiError(422, `${key} ist ungültig.`)
    patch[key] = v
  }
  for (const key of ['notes','strategy','elliottWaveCount','waveDegree'] as const) {
    if (!(key in raw)) continue
    const v = raw[key]
    if (v !== null && (typeof v !== 'string' || v.length > (key === 'waveDegree' ? 200 : key === 'notes' ? 8000 : 4000))) throw new ApiError(422, `${key} ist ungültig.`)
    patch[key] = typeof v === 'string' ? v.trim() || null : null
  }
  if ('planContext' in raw) { try { patch.planContext = normalizePlanContext(raw.planContext) } catch { throw new ApiError(422, 'Plan-Kontext ist ungültig.') } }
  if ('setupTags' in raw) {
    if (!Array.isArray(raw.setupTags) || raw.setupTags.some(v => typeof v !== 'string')) throw new ApiError(422, 'Setup-Tags sind ungültig.')
    try { serializeSetupTags(raw.setupTags); patch.setupTags = raw.setupTags } catch { throw new ApiError(422, 'Setup-Tags sind ungültig.') }
  }
  if ('targets' in raw) {
    if (!Array.isArray(raw.targets)) throw new ApiError(422, 'Zielstaffel muss eine Liste sein.')
    if (raw.targets.length > MAX_TEILZIELE) throw new ApiError(422, `Höchstens ${MAX_TEILZIELE} Teilziele zusätzlich zum Kursziel.`)
    for (const v of raw.targets) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ApiError(422, 'Zielstufe ist ungültig.')
      onlyKeys(v as Record<string, unknown>, ['price','sharePct','note'])
      if (typeof v.price !== 'number' || !Number.isFinite(v.price) || v.price <= 0 || typeof v.sharePct !== 'number' || !Number.isFinite(v.sharePct) || v.sharePct <= 0 || v.sharePct > 100) throw new ApiError(422, 'Zielkurs oder Anteil ist ungültig.')
      if (typeof v.note !== 'undefined' && v.note !== null && (typeof v.note !== 'string' || v.note.length > 2000)) throw new ApiError(422, 'Zielnotiz ist ungültig.')
    }
    patch.targets = raw.targets as TargetPlanInput[]
  }
  return patch
}
