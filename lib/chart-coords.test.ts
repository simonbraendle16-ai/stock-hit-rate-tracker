import { describe, expect, it } from 'vitest'
import {
  ACHSEN_BREITE_FALLBACK,
  pruefeAchsenBreite,
  barStep,
  istProjektion,
  logicalToTime,
  snapTime,
  timeToLogical,
} from './chart-coords'

/** Gleichmäßige Stundenkerzen. */
const H = 3600
const gleich = Array.from({ length: 10 }, (_, i) => 1_700_000_000 + i * H)

/** Tageskerzen mit Wochenendlücke — der Normalfall bei Aktien. */
const T = 86400
const mitLuecke = [
  1_700_000_000, // Mo
  1_700_000_000 + T, // Di
  1_700_000_000 + 2 * T, // Mi
  1_700_000_000 + 3 * T, // Do
  1_700_000_000 + 4 * T, // Fr
  1_700_000_000 + 7 * T, // Mo (Wochenende übersprungen)
  1_700_000_000 + 8 * T,
]

describe('barStep', () => {
  it('nimmt den Abstand gleichmäßiger Kerzen', () => {
    expect(barStep(gleich)).toBe(H)
  })

  it('lässt sich von einer Wochenendlücke nicht verziehen', () => {
    // Der Mittelwert läge bei 8/6 Tagen; der Median trifft den echten Takt.
    expect(barStep(mitLuecke)).toBe(T)
  })

  it('bleibt bei zu wenig Daten gutmütig', () => {
    expect(barStep([])).toBeGreaterThan(0)
    expect(barStep([123])).toBeGreaterThan(0)
  })
})

describe('timeToLogical / logicalToTime', () => {
  const s = barStep(gleich)

  it('trifft Kerzenzeiten genau auf ihren Index', () => {
    gleich.forEach((t, i) => {
      expect(timeToLogical(gleich, s, t)).toBeCloseTo(i, 9)
    })
  })

  it('interpoliert zwischen zwei Kerzen', () => {
    expect(timeToLogical(gleich, s, gleich[3] + H / 2)).toBeCloseTo(3.5, 9)
  })

  it('schreibt hinter der letzten Kerze fort statt aufzugeben', () => {
    const zukunft = gleich[gleich.length - 1] + 4 * H
    expect(timeToLogical(gleich, s, zukunft)).toBeCloseTo(gleich.length - 1 + 4, 9)
  })

  it('schreibt vor der ersten Kerze ins Negative fort', () => {
    expect(timeToLogical(gleich, s, gleich[0] - 2 * H)).toBeCloseTo(-2, 9)
  })

  it('ist die Umkehrung von logicalToTime — auch außerhalb der Reihe', () => {
    for (const l of [-3.5, -1, 0, 2.25, 6, 9, 12.5, 40]) {
      const t = logicalToTime(gleich, s, l)
      expect(timeToLogical(gleich, s, t)).toBeCloseTo(l, 6)
    }
  })

  it('überspringt die Wochenendlücke, statt sie als Zeit zu rechnen', () => {
    const st = barStep(mitLuecke)
    // Der Montag nach dem Wochenende ist Index 5, nicht Index 7.
    expect(timeToLogical(mitLuecke, st, mitLuecke[5])).toBeCloseTo(5, 9)
  })
})

describe('snapTime', () => {
  const s = barStep(gleich)

  it('zieht einen Klick auf die nächstgelegene Kerze', () => {
    expect(snapTime(gleich, s, gleich[4] + 0.4 * H)).toBe(gleich[4])
    expect(snapTime(gleich, s, gleich[4] + 0.6 * H)).toBe(gleich[5])
  })

  it('erlaubt Punkte hinter der letzten Kerze', () => {
    const letzte = gleich[gleich.length - 1]
    const geschnappt = snapTime(gleich, s, letzte + 3.2 * H)
    expect(geschnappt).toBe(letzte + 3 * H)
    expect(geschnappt).toBeGreaterThan(letzte)
  })

  it('legt einen projizierten Punkt auf die echte Kerze, sobald sie nachkommt', () => {
    // Genau der Replay-Fall: gezeichnet wird in die Zukunft, danach läuft der
    // Replay weiter und die Kerze existiert wirklich. Der Punkt darf dabei
    // nicht verrutschen.
    const kurz = gleich.slice(0, 6)
    const punkt = snapTime(kurz, barStep(kurz), kurz[5] + 2 * H)
    expect(timeToLogical(gleich, s, punkt)).toBeCloseTo(7, 9)
    expect(gleich[7]).toBe(punkt)
  })
})

describe('istProjektion', () => {
  it('erkennt Punkte hinter der letzten Kerze', () => {
    const letzte = gleich[gleich.length - 1]
    expect(istProjektion(gleich, letzte)).toBe(false)
    expect(istProjektion(gleich, letzte + 1)).toBe(true)
    expect(istProjektion([], 5)).toBe(false)
  })
})

describe('pruefeAchsenBreite', () => {
  it('nimmt eine plausible gemessene Breite', () => {
    expect(pruefeAchsenBreite(1170, 62)).toBe(62)
    expect(pruefeAchsenBreite(1170, 90)).toBe(90)
  })

  it('lehnt 0 ab — der gefaehrlichste Fall', () => {
    // priceScale().width() liefert genau das; mit 0 laege die Zeichenebene
    // ueber der ganzen Achse.
    expect(pruefeAchsenBreite(1170, 0)).toBe(ACHSEN_BREITE_FALLBACK)
    expect(pruefeAchsenBreite(1170, -5)).toBe(ACHSEN_BREITE_FALLBACK)
  })

  it('haelt eine halbe Chartbreite nicht fuer eine Achse', () => {
    expect(pruefeAchsenBreite(1000, 600)).toBe(ACHSEN_BREITE_FALLBACK)
  })

  it('rundet und faengt unbrauchbare Zahlen ab', () => {
    expect(pruefeAchsenBreite(1170, 61.6)).toBe(62)
    expect(pruefeAchsenBreite(Number.NaN, 62)).toBe(ACHSEN_BREITE_FALLBACK)
    expect(pruefeAchsenBreite(1170, Number.NaN)).toBe(ACHSEN_BREITE_FALLBACK)
  })
})
