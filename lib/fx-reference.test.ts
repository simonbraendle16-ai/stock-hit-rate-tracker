import { describe, expect, it } from 'vitest'
import { crossFx, parseEcbFx, requireFxDate, FX_MAX_AGE_MS } from './fx-reference'

const now = new Date('2026-10-13T18:00:00Z')
const xml = (date = '2026-10-13', usd = '1.2') => `<gesmes:Envelope xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><Cube><Cube time='${date}'><Cube currency='USD' rate='${usd}'/><Cube currency='GBP' rate='0.8'/></Cube></Cube></gesmes:Envelope>`
describe('documented FX reference contract', () => {
  it('keeps reference date and fetch time distinct and calculates the correct direction', () => {
    const r = parseEcbFx(xml(), now)
    expect(r.referenceAt.toISOString()).toBe('2026-10-13T00:00:00.000Z')
    expect(r.fetchedAt).toEqual(now)
    expect(crossFx(r.rates, 'USD', 'EUR')).toBeCloseTo(1 / 1.2)
    expect(crossFx(r.rates, 'EUR', 'USD')).toBeCloseTo(1.2)
    expect(crossFx(r.rates, 'GBP', 'USD')).toBeCloseTo(1.5)
    expect(crossFx({}, 'USD', 'USD')).toBe(1)
    expect(() => crossFx(r.rates, 'XYZ', 'EUR')).toThrow('keinen Referenzkurs')
  })
  it('accepts exactly seven days and a Friday reference on a Sunday', () => {
    expect(() => requireFxDate(new Date(now.getTime() - FX_MAX_AGE_MS), now)).not.toThrow()
    expect(() => parseEcbFx(xml('2026-10-09'), new Date('2026-10-11T15:00Z'))).not.toThrow()
  })
  it('rejects stale, future, invalid, HTML, zero and duplicate values', () => {
    for (const date of [new Date(now.getTime() - FX_MAX_AGE_MS - 1), new Date(now.getTime() + 1), new Date('invalid')]) expect(() => requireFxDate(date, now)).toThrow()
    for (const raw of [xml('2026-10-14'), xml('2026-09-01'), xml('2026-02-30'), xml('2026-10-13', '0'), '<html>unavailable</html>', '<!DOCTYPE foo>' + xml(), xml().replace('</Cube></Cube>', "<Cube currency='USD' rate='1.3'/></Cube></Cube>")]) expect(() => parseEcbFx(raw, now)).toThrow()
  })
})
