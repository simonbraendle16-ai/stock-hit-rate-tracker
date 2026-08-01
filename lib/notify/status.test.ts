import { describe, expect, it } from 'vitest'
import { CHECK_STALE_MS, healthFrom } from './status'

const NOW = new Date('2026-08-01T14:00:00Z')

function minutesAgo(min: number): Date {
  return new Date(NOW.getTime() - min * 60_000)
}

describe('healthFrom', () => {
  it('meldet „nie gelaufen", solange kein Prüflauf existiert', () => {
    expect(healthFrom({ hasMailConfig: true, lastCheckAt: null, now: NOW })).toBe('nie_gelaufen')
    // Auch ohne Zugangsdaten bleibt das die richtige Aussage: Wenn gar nicht
    // geprüft wird, ist der fehlende Versand nicht die eigentliche Ursache.
    expect(healthFrom({ hasMailConfig: false, lastCheckAt: null, now: NOW })).toBe('nie_gelaufen')
  })

  it('ist zufrieden, wenn eben geprüft wurde und der Versand steht', () => {
    expect(healthFrom({ hasMailConfig: true, lastCheckAt: minutesAgo(4), now: NOW })).toBe('ok')
  })

  it('duldet Verzögerungen des externen Takts bis zur Schwelle', () => {
    const gerade = new Date(NOW.getTime() - CHECK_STALE_MS + 1_000)
    expect(healthFrom({ hasMailConfig: true, lastCheckAt: gerade, now: NOW })).toBe('ok')
  })

  it('schlägt an, sobald der Takt ausbleibt', () => {
    const zuAlt = new Date(NOW.getTime() - CHECK_STALE_MS - 1_000)
    expect(healthFrom({ hasMailConfig: true, lastCheckAt: zuAlt, now: NOW })).toBe('takt_fehlt')
  })

  it('nennt fehlende Zugangsdaten, wenn geprüft wird, aber nichts rausgehen kann', () => {
    expect(healthFrom({ hasMailConfig: false, lastCheckAt: minutesAgo(2), now: NOW })).toBe(
      'kein_versand',
    )
  })

  it('nennt den toten Takt vor den fehlenden Zugangsdaten', () => {
    // Beides kaputt: Der fehlende Takt wiegt schwerer — ohne ihn löst nicht
    // einmal etwas aus, das man verschicken könnte.
    expect(healthFrom({ hasMailConfig: false, lastCheckAt: minutesAgo(120), now: NOW })).toBe(
      'takt_fehlt',
    )
  })
})
