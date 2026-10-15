import { describe, expect, it } from 'vitest'
import { automaticCheckHealthy, usableAlertPrice, boundedRead } from './alert-health'
import { alertCronAuthorized } from './alert-cron-auth'
import { healthFrom, CHECK_STALE_MS } from './notify/status'

describe('honest automatic alarm health', () => {
  it('requires a completed successful pass, including quote and delivery results', () => {
    const good = { finishedAt: new Date(), complete: true, error: null, mailsFailed: 0, quotesMissing: 0 }
    expect(automaticCheckHealthy(good)).toBe(true)
    for (const patch of [{ finishedAt: null }, { complete: false }, { error: 'failure' }, { mailsFailed: 1 }, { quotesMissing: 1 }]) expect(automaticCheckHealthy({ ...good, ...patch })).toBe(false)
  })
  it('never calls a future or stale quote usable', () => {
    const now = Date.now(), time = now / 1000
    expect(usableAlertPrice(10, time, now)).toBe(true)
    expect(usableAlertPrice(10, time + 1, now)).toBe(false)
    expect(usableAlertPrice(10, time - 901, now)).toBe(false)
    expect(usableAlertPrice(0, time, now)).toBe(false)
    expect(usableAlertPrice(NaN, time, now)).toBe(false)
  })
  it('cannot hide failures behind a fresh attempt', () => {
    const now = new Date()
    expect(healthFrom({ hasMailConfig: true, lastCheckAt: null, lastAttemptAt: now })).toBe('pruefung_fehler')
    expect(healthFrom({ hasMailConfig: true, lastCheckAt: now, lastAttemptAt: now, lastAttemptOk: false })).toBe('pruefung_fehler')
    expect(healthFrom({ hasMailConfig: true, lastCheckAt: new Date(now.getTime() - CHECK_STALE_MS - 1), now })).toBe('takt_fehlt')
    expect(healthFrom({ hasMailConfig: true, lastCheckAt: new Date(now.getTime() - CHECK_STALE_MS - 1), lastAttemptAt: now, lastAttemptOk:false, now })).toBe('pruefung_fehler')
    expect(healthFrom({ hasMailConfig: true, lastCheckAt: new Date(now.getTime() + 1000), now })).toBe('takt_fehlt')
  })
  it('authenticates only the scoped alarm secret and bounds a hung read', async () => {
    expect(alertCronAuthorized('Bearer alarm-only', 'alarm-only')).toBe(true)
    expect(alertCronAuthorized('Bearer demo-secret', 'alarm-only')).toBe(false)
    expect(alertCronAuthorized(null, 'alarm-only')).toBe(false)
    expect(alertCronAuthorized('Bearer undefined', undefined)).toBe(false)
    await expect(boundedRead(new Promise(() => {}), 2)).rejects.toThrow('Zeitbudget')
  })
})
