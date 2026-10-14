import { describe, expect, it } from 'vitest'
import { confirmedRegularFeedPause } from './alert-feed-pause'
const now = Date.parse('2026-10-14T13:00:00Z') // 09:00 New York, before regular open
const snapshot = { price: 100, quotedAt: Date.parse('2026-10-13T20:00:00Z') / 1000,
  fetchedAt: new Date(now), marketState: 'PRE', quoteType: 'EQUITY', exchange: 'NasdaqGS', lastError: null }
describe('confirmed pause of the regular quote feed', () => {
  it('accepts a current PRE response, never age alone or a regular-session outage', () => {
    expect(confirmedRegularFeedPause(snapshot, 'aktien', now)).toBe(true)
    expect(confirmedRegularFeedPause({...snapshot,marketState:null}, 'aktien', now)).toBe(false)
    expect(confirmedRegularFeedPause({...snapshot,marketState:'REGULAR'}, 'aktien', now)).toBe(false)
    expect(confirmedRegularFeedPause(snapshot, 'aktien', Date.parse('2026-10-14T13:30:00Z'))).toBe(false)
    expect(confirmedRegularFeedPause({...snapshot,fetchedAt:new Date('2026-10-14T13:31:00Z')}, 'aktien', Date.parse('2026-10-14T13:31:00Z'))).toBe(false)
  })
  it.each([
    {fetchedAt:new Date(now-901000)}, {fetchedAt:new Date(now+1)}, {quotedAt:(now+1000)/1000},
    {quotedAt:(now-6*86400000)/1000}, {price:0}, {price:NaN}, {lastError:'offline'},
    {exchange:'unknown'}, {quoteType:'CRYPTOCURRENCY'}, {marketState:'HALTED'},
  ])('cannot excuse invalid evidence: %j', patch => {
    expect(confirmedRegularFeedPause({...snapshot,...patch}, 'aktien', now)).toBe(false)
  })
  it('keeps crypto and unknown markets outside the pause exception', () => {
    expect(confirmedRegularFeedPause(snapshot,'krypto',now)).toBe(false)
    expect(confirmedRegularFeedPause(snapshot,'sonstiges',now)).toBe(false)
  })
  it('handles DST, an explicit closed holiday, ASX and Xetra only with provider evidence', () => {
    const winter = Date.parse('2026-11-02T14:00:00Z')
    expect(confirmedRegularFeedPause({...snapshot,fetchedAt:new Date(winter),quotedAt:(winter-3600000)/1000},'aktien',winter)).toBe(true)
    expect(confirmedRegularFeedPause({...snapshot,marketState:'CLOSED'},'aktien',now)).toBe(true)
    expect(confirmedRegularFeedPause({...snapshot,marketState:'POST',exchange:'ASX',quotedAt:(now-3600000)/1000},'aktien',now)).toBe(true)
    const evening=Date.parse('2026-10-14T18:00:00Z')
    expect(confirmedRegularFeedPause({...snapshot,fetchedAt:new Date(evening),quotedAt:(evening-3600000)/1000,marketState:'POST',exchange:'XETRA'},'aktien',evening)).toBe(true)
  })
})
