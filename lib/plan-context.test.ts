import { describe, expect, it } from 'vitest'
import { emptyPlanContext, normalizePlanContext, planGaps, planningSnapshot } from './plan-context'
import { hasRecentLoss, resolveManagementReview } from './management-review'
import { normalizeMoodCheck } from './emotions'

const context = { ...emptyPlanContext(), expectedMove: 'Count could be wrong; expect correction',
  entryTrigger: 'First entry into zone', stopManagement: 'No trailing', targetManagement: 'Full exit at target', riskConfirmed: true }
const trade = { planContext: context, entryPrice: 100, stopLoss: 90, takeProfit: 120,
  elliottInvalidation: 89, positionSize: 2, direction: 'long', quoteCurrency: 'USD', accountCurrency: 'USD', quoteToAccountRate: 1 }

describe('concrete planning and explicit assessments', () => {
  it('accepts an uncertain but concrete plan, without any yes/no preanswers', () => {
    expect(planGaps(trade)).toEqual([])
    expect(planGaps({ ...trade, planContext: { ...context, riskConfirmed: false } })).toContain('Risikobestätigung mit benannten Kosten und Datenlücken')
  })
  it('keeps old preanswers and incomplete or directionally invalid plans from opening the gate', () => {
    expect(planGaps({ ...trade, planContext: null })).toContain('Erwarteter Verlauf')
    expect(planGaps({ ...trade, elliottInvalidation: null })).toContain('Invalidierung')
    expect(planGaps({ ...trade, positionSize: null })).toContain('Positionsgröße')
    expect(planGaps({ ...trade, accountCurrency: 'EUR' })).toContain('Währung und berechenbares Stop-Risiko')
    expect(planGaps({ ...trade, stopLoss: 110 })).toContain('Stop und Ziel passend zur Richtung')
  })
  it('validates context versions and never accepts a client-only readiness flag', () => {
    expect(normalizePlanContext({ ...context, expectedMove: '  unsure  ' })?.expectedMove).toBe('unsure')
    expect(() => normalizePlanContext({ ...context, version: 2 })).toThrow()
    expect(() => normalizePlanContext({ ...context, ready: true })).toThrow()
    expect(() => normalizePlanContext({ ...context, riskConfirmed: 'yes' })).toThrow()
    expect(() => normalizePlanContext({ ...context, entryTrigger: 23 })).toThrow()
  })
  it('keeps actual changes and their assessments separate', () => {
    expect(resolveManagementReview({ assessment: 'plan', reason: 'Confirmed trailing rule before partial sale' }).violation).toBe(false)
    expect(resolveManagementReview({ assessment: 'unknown', reason: 'No original rule' }).violation).toBeNull()
    expect(resolveManagementReview({ assessment: 'violation', reason: 'User confirms deviation' }).violation).toBe(true)
    expect(() => resolveManagementReview({ assessment: 'plan', reason: '' })).toThrow()
    expect(() => resolveManagementReview({ assessment: 'plan', reason: 'rule' }, true)).toThrow()
  })
  it('uses temporal proximity only as a neutral bounded hint', () => {
    const now = Date.parse('2026-10-05T12:00:00Z')
    expect(hasRecentLoss('2026-10-05T11:01:00Z', now)).toBe(true)
    expect(hasRecentLoss('2026-10-05T11:00:00Z', now)).toBe(false)
    expect(hasRecentLoss('2026-10-05T12:01:00Z', now)).toBe(false)
    expect(hasRecentLoss('invalid', now)).toBe(false)
  })
  it('captures original numeric planning values and free feelings without inferred scores or tags', () => {
    expect(planningSnapshot(trade)).toMatchObject({ stopLoss: 90, positionSize: 2, planContext: context })
    expect(normalizeMoodCheck({ score: null, tags: [], note: 'I am afraid, but will follow the plan' }))
      .toEqual({ score: null, tags: [], note: 'I am afraid, but will follow the plan' })
    expect(normalizeMoodCheck({ score: 9, tags: [], note: 'afraid' })).toBeNull()
  })
})
