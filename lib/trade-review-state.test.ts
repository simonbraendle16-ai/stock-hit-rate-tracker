import { describe, expect, it } from 'vitest'
import { pendingReview, reviewStatusAfterClose } from './trade-review-state'

const base={status:'abgeschlossen',reviewStatus:null,reviewDeferredUntil:null,followedPlan:null,tradeKind:'schnell',moodExit:null,moodExitNote:null,reviewLossAccepted:null}
describe('review reminders without retroactive obligations',()=>{
  it('does not enqueue historical trades or infer completion from an outcome',()=>{
    expect(pendingReview(base)).toBe(false)
    expect(reviewStatusAfterClose(base,'gewinn')).toBeNull()
    expect(reviewStatusAfterClose(base,'gewinn',true)).toBe('pending')
  })
  it('reminds only explicit pending and due deferred reviews',()=>{
    expect(pendingReview({...base,reviewStatus:'pending'})).toBe(true)
    const until=new Date('2026-10-07T10:00:00Z')
    expect(pendingReview({...base,reviewStatus:'deferred',reviewDeferredUntil:until},new Date('2026-10-07T09:00:00Z'))).toBe(false)
    expect(pendingReview({...base,reviewStatus:'deferred',reviewDeferredUntil:until},until)).toBe(true)
    expect(pendingReview({...base,reviewStatus:'skipped'})).toBe(false)
  })
  it('preserves honest negative answers, deferral and skipping when facts change',()=>{
    const rated={...base,reviewStatus:'completed',followedPlan:false,moodExitNote:'Own answer',reviewLossAccepted:false}
    expect(reviewStatusAfterClose(rated,'verlust')).toBe('completed')
    expect(reviewStatusAfterClose({...rated,reviewLossAccepted:null},'verlust')).toBe('pending')
    expect(reviewStatusAfterClose({...rated,reviewStatus:'skipped'},'verlust')).toBe('skipped')
    expect(reviewStatusAfterClose({...rated,reviewStatus:'deferred'},'verlust')).toBe('deferred')
  })
})
