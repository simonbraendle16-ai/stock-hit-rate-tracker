import { describe, expect, it } from 'vitest'
import { quoteAge } from './quote-age'

const now = Date.parse('2026-10-12T12:00:00Z')

describe('Watchlist-Kursalter', () => {
  it('zeigt bei gerade erneut abgerufenem Vortageskurs weiterhin einen Tag', () => {
    const quotedAt = Date.parse('2026-10-11T12:00:00Z') / 1000
    expect(quoteAge(quotedAt, now)).toEqual({ short: '1 Tg.', long: 'vor 1 Tg.' })
  })

  it.each([
    [0, 'eben', 'gerade eben'],
    [59, 'eben', 'gerade eben'],
    [60, '1 Min.', 'vor 1 Min.'],
    [3599, '59 Min.', 'vor 59 Min.'],
    [3600, '1 Std.', 'vor 1 Std.'],
    [86399, '23 Std.', 'vor 23 Std.'],
    [86400, '1 Tg.', 'vor 1 Tg.'],
  ])('formatiert %s Sekunden Alter für Handy und Desktop', (seconds, short, long) => {
    expect(quoteAge(now / 1000 - seconds, now)).toEqual({ short, long })
  })

  it.each([undefined, null, 0, -1, NaN, Infinity, now / 1000 + 60])(
    'kennzeichnet fehlende oder unplausible Kurszeit %s ausdrücklich', (quotedAt) => {
      expect(quoteAge(quotedAt, now)).toEqual({ short: 'Kurszeit unbekannt', long: 'Kurszeit unbekannt' })
    },
  )
})
