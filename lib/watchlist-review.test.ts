import { describe, expect, it } from 'vitest'
import {
  REVIEW_INTERVAL_DAYS,
  istFaellig,
  reviewStand,
  reviewStandJeSektion,
  tageSeither,
  tradingViewUrl,
} from './watchlist-review'

const JETZT = new Date('2026-08-11T12:00:00Z')
const vorTagen = (n: number, stunden = 0) =>
  new Date(JETZT.getTime() - n * 24 * 60 * 60 * 1000 - stunden * 60 * 60 * 1000)

describe('istFaellig', () => {
  it('ist fällig, wenn noch nie angesehen', () => {
    expect(istFaellig(null, JETZT)).toBe(true)
  })

  it('ist NICHT fällig bei genau sieben Tagen — die Woche ist erst danach um', () => {
    expect(istFaellig(vorTagen(REVIEW_INTERVAL_DAYS), JETZT)).toBe(false)
  })

  it('ist fällig ab einer Minute nach sieben Tagen', () => {
    const knapp = new Date(vorTagen(REVIEW_INTERVAL_DAYS).getTime() - 60_000)
    expect(istFaellig(knapp, JETZT)).toBe(true)
  })

  it('ist nicht fällig, was gerade eben angesehen wurde', () => {
    expect(istFaellig(JETZT, JETZT)).toBe(false)
  })

  it('nimmt auch eine Zeichenkette, wie sie aus der Datenbank kommen kann', () => {
    expect(istFaellig(vorTagen(8).toISOString(), JETZT)).toBe(true)
    expect(istFaellig(vorTagen(1).toISOString(), JETZT)).toBe(false)
  })

  it('behandelt einen unlesbaren Wert wie „nie angesehen“ statt zu raten', () => {
    expect(istFaellig('kein Datum', JETZT)).toBe(true)
  })

  it('rechnet über die Zeitumstellung hinweg in echten Stunden', () => {
    // In Europa wird in der Nacht zum 25.10.2026 zurückgestellt: Der Kalender
    // zeigt 7 Tage, vergangen sind 169 Stunden. Fällig ist erst, was WIRKLICH
    // länger als eine Woche her ist.
    const nachher = new Date('2026-10-28T12:00:00Z')
    const genauEineWoche = new Date(nachher.getTime() - REVIEW_INTERVAL_DAYS * 24 * 60 * 60 * 1000)
    expect(istFaellig(genauEineWoche, nachher)).toBe(false)
    expect(istFaellig(new Date(genauEineWoche.getTime() - 60 * 60 * 1000), nachher)).toBe(true)
  })
})

describe('tageSeither', () => {
  it('zählt volle Tage', () => {
    expect(tageSeither(vorTagen(0, 5), JETZT)).toBe(0)
    expect(tageSeither(vorTagen(1), JETZT)).toBe(1)
    expect(tageSeither(vorTagen(9, 3), JETZT)).toBe(9)
  })

  it('gibt ohne Datum null zurück, statt 0 zu behaupten', () => {
    expect(tageSeither(null, JETZT)).toBeNull()
  })

  it('wird bei einem Datum in der Zukunft nicht negativ', () => {
    expect(tageSeither(new Date(JETZT.getTime() + 60_000), JETZT)).toBe(0)
  })
})

describe('reviewStand', () => {
  it('zählt offene gegen gesamt', () => {
    const stand = reviewStand(
      [
        { lastReviewedAt: null },
        { lastReviewedAt: vorTagen(9) },
        { lastReviewedAt: vorTagen(2) },
        { lastReviewedAt: vorTagen(0) },
      ],
      JETZT,
    )
    expect(stand).toEqual({ gesamt: 4, offen: 2 })
  })

  it('bleibt bei leerer Watchlist bei null', () => {
    expect(reviewStand([], JETZT)).toEqual({ gesamt: 0, offen: 0 })
  })
})

describe('reviewStandJeSektion', () => {
  it('trennt nach Sektion und führt Symbole ohne Sektion unter null', () => {
    const map = reviewStandJeSektion(
      [
        { lastReviewedAt: vorTagen(9), watchlistSection: 'Indizes' },
        { lastReviewedAt: vorTagen(1), watchlistSection: 'Indizes' },
        { lastReviewedAt: null, watchlistSection: null },
        { lastReviewedAt: vorTagen(1) },
      ],
      JETZT,
    )
    expect(map.get('Indizes')).toEqual({ gesamt: 2, offen: 1 })
    expect(map.get(null)).toEqual({ gesamt: 2, offen: 1 })
  })
})

describe('tradingViewUrl', () => {
  it('nimmt den hinterlegten Chart-Link unverändert — das ist die eigene Wahl', () => {
    const url = 'https://www.tradingview.com/chart/abc/?symbol=NASDAQ%3AAAPL'
    expect(tradingViewUrl({ ticker: 'AAPL', market: 'aktien', chartUrl: url })).toBe(url)
  })

  it('baut ohne Link eine Adresse aus der geprüften Symbolübersetzung', () => {
    const url = tradingViewUrl({
      ticker: 'AAPL',
      market: 'aktien',
      chartUrl: null,
      resolvedExchange: 'NASDAQ',
    })
    expect(url).toBe('https://www.tradingview.com/chart/?symbol=NASDAQ%3AAAPL')
  })

  it('schickt nie den Rohticker, sondern immer ein qualifiziertes Symbol', () => {
    // Ohne Präfix landet `CL1!` bei TradingView am australischen Zertifikat statt
    // beim Öl. Welche Börse bzw. welcher Spot-Alias richtig ist, entscheidet
    // `toTradingViewSymbol` — hier zählt nur, dass überhaupt qualifiziert wird.
    const url = tradingViewUrl({ ticker: 'CL1!', market: 'rohstoffe', chartUrl: null })
    expect(url).toContain('%3A') // der kodierte Doppelpunkt in `BOERSE:TICKER`
    expect(url).not.toMatch(/symbol=CL1!?$/)
  })
})
