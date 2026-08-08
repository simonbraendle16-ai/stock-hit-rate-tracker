import { describe, expect, it } from 'vitest'
import { ERWARTETE_GRANULARITAET, passtGranularitaet } from './yahoo'
import type { Interval } from './types'

/**
 * Die Prüfung, die Yahoos stille Herabstufung abfängt.
 *
 * Der gemessene Fall: `range=max` mit `interval=1wk` antwortet mit Status 200,
 * ohne Fehlerfeld — und `meta.dataGranularity: "3mo"`. Die Kerzen sehen aus wie
 * Wochenkerzen, sind aber Quartale. Genau dieser Fall muss verworfen werden.
 */
describe('passtGranularitaet', () => {
  it('nimmt an, was zum angefragten Intervall passt', () => {
    expect(passtGranularitaet('1week', '1wk')).toBe(true)
    expect(passtGranularitaet('1month', '1mo')).toBe(true)
    expect(passtGranularitaet('1day', '1d')).toBe(true)
    expect(passtGranularitaet('15min', '15m')).toBe(true)
    expect(passtGranularitaet('30min', '30m')).toBe(true)
    expect(passtGranularitaet('1h', '60m')).toBe(true)
  })

  it('verwirft die gemessene Herabstufung auf Quartale', () => {
    expect(passtGranularitaet('1week', '3mo')).toBe(false)
    expect(passtGranularitaet('1month', '3mo')).toBe(false)
  })

  it('verwirft auch eine Herabstufung nach oben oder unten anderswo', () => {
    expect(passtGranularitaet('15min', '1d')).toBe(false)
    expect(passtGranularitaet('1h', '1d')).toBe(false)
    expect(passtGranularitaet('1day', '1wk')).toBe(false)
  })

  it('erwartet bei 4h die 60-Minuten-Kerzen, aus denen wir es bauen', () => {
    expect(passtGranularitaet('4h', '60m')).toBe(true)
    expect(passtGranularitaet('4h', '4h')).toBe(false)
    expect(passtGranularitaet('4h', '1d')).toBe(false)
  })

  it('lässt Groß-/Kleinschreibung und Leerraum durchgehen', () => {
    expect(passtGranularitaet('1week', ' 1WK ')).toBe(true)
  })

  it('lässt eine fehlende Angabe durch — verworfen wird nur Nachweisbares', () => {
    expect(passtGranularitaet('1week', null)).toBe(true)
    expect(passtGranularitaet('1week', undefined)).toBe(true)
    expect(passtGranularitaet('1week', '')).toBe(true)
    expect(passtGranularitaet('1week', '   ')).toBe(true)
  })

  it('kennt für jedes Intervall eine Erwartung', () => {
    const alle: Interval[] = ['15min', '30min', '1h', '4h', '1day', '1week', '1month']
    for (const i of alle) {
      expect(ERWARTETE_GRANULARITAET[i]).toBeTruthy()
      expect(passtGranularitaet(i, ERWARTETE_GRANULARITAET[i])).toBe(true)
    }
  })
})
