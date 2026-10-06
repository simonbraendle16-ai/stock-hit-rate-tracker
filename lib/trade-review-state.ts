import { requiresMoodCheck } from './trade-kind'

export type ReviewState = { status: string; reviewStatus: string | null; reviewDeferredUntil: Date | null; followedPlan: boolean | null }
export function pendingReview(t: ReviewState, now = new Date()) {
  return t.status === 'abgeschlossen' && (t.reviewStatus === 'pending' ||
    (t.reviewStatus === 'deferred' && !!t.reviewDeferredUntil && new Date(t.reviewDeferredUntil) <= now))
}

type ReviewFacts = Pick<ReviewState, 'reviewStatus' | 'followedPlan'> & {
  tradeKind: string | null; moodExit: number | null; moodExitNote: string | null; reviewLossAccepted: boolean | null
}
export function reviewStatusAfterClose(t: ReviewFacts, result: string | null, newlyClosed = false) {
  if (t.reviewStatus === 'skipped' || t.reviewStatus === 'deferred') return t.reviewStatus
  if (t.reviewStatus == null && !newlyClosed) return null
  const complete = t.followedPlan != null &&
    (!requiresMoodCheck(t.tradeKind) || t.moodExit != null || !!t.moodExitNote?.trim()) &&
    (result !== 'verlust' || t.reviewLossAccepted != null)
  return complete ? 'completed' : 'pending'
}
