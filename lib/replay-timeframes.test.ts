import { describe, expect, it } from 'vitest'
import type { Candle } from './market-data/types'
import {
  intervalSekunden,
  kerzenBisZeitpunkt,
  replayEnde,
} from './replay-timeframes'

const H = 3600
const T0 = 1_700_000_000 // liegt auf einer vollen Stunde

const k = (time: number, open: number, high: number, low: number, close: number, volume = 1): Candle => ({
  time,
  open,
  high,
  low,
  close,
  volume,
})

/** Vier Stundenkerzen, die zusammen eine 4h-Kerze ergeben. */
const stunden: Candle[] = [
  k(T0 + 0 * H, 100, 105, 99, 104),
  k(T0 + 1 * H, 104, 110, 103, 108),
  k(T0 + 2 * H, 108, 120, 90, 95), // das Extrem liegt in der DRITTEN Stunde
  k(T0 + 3 * H, 95, 99, 94, 98),
  k(T0 + 4 * H, 98, 130, 97, 128),
]

/** Die passende 4h-Kerze: Hoch 120, Tief 90 — beides erst ab Stunde 3 bekannt. */
const vierStunden: Candle[] = [
  k(T0, 100, 120, 90, 98, 4),
  k(T0 + 4 * H, 98, 130, 97, 128, 4),
]

describe('intervalSekunden', () => {
  it('kennt die Handelsintervalle', () => {
    expect(intervalSekunden('15min')).toBe(900)
    expect(intervalSekunden('4h')).toBe(4 * H)
    expect(intervalSekunden('1day')).toBe(86400)
  })
})

describe('replayEnde', () => {
  it('nimmt das ENDE der letzten sichtbaren Kerze, nicht ihren Anfang', () => {
    // Zwei sichtbare Stundenkerzen -> der Moment liegt bei T0 + 2h.
    expect(replayEnde(stunden, 2, H)).toBe(T0 + 2 * H)
  })

  it('nutzt die echte Folgekerze statt der Intervall-Länge', () => {
    // Wochenendlücke: die nächste Kerze kommt erst drei Tage später.
    const mitLuecke = [k(T0, 1, 1, 1, 1), k(T0 + 3 * 86400, 1, 1, 1, 1)]
    expect(replayEnde(mitLuecke, 1, 86400)).toBe(T0 + 3 * 86400)
  })

  it('fällt am Ende der Reihe auf die Intervall-Länge zurück', () => {
    expect(replayEnde(stunden, 5, H)).toBe(T0 + 5 * H)
  })

  it('liefert null, wenn noch nichts sichtbar ist', () => {
    expect(replayEnde(stunden, 0, H)).toBeNull()
    expect(replayEnde([], 3, H)).toBeNull()
  })
})

describe('kerzenBisZeitpunkt', () => {
  const zielS = 4 * H
  const basisS = H

  it('verrät die Zukunft NICHT: die angebrochene 4h-Kerze wird neu gerechnet', () => {
    // Replay steht nach zwei Stundenkerzen. Bekannt ist bis dahin nur
    // Hoch 110 / Tief 99 — das Extrem 120/90 kommt erst danach.
    const ende = replayEnde(stunden, 2, basisS)!
    const out = kerzenBisZeitpunkt(vierStunden, stunden, ende, zielS, basisS)

    expect(out).toHaveLength(1)
    expect(out[0].time).toBe(T0)
    expect(out[0].open).toBe(100)
    expect(out[0].high).toBe(110)
    expect(out[0].low).toBe(99)
    expect(out[0].close).toBe(108)
    // Der gespeicherte Wert wäre 120/90 gewesen — genau das darf nicht kommen.
    expect(out[0].high).not.toBe(120)
    expect(out[0].low).not.toBe(90)
  })

  it('gibt eine abgeschlossene Kerze unverändert heraus', () => {
    const ende = replayEnde(stunden, 4, basisS)! // genau das Ende der 4h-Kerze
    const out = kerzenBisZeitpunkt(vierStunden, stunden, ende, zielS, basisS)
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual(vierStunden[0])
  })

  it('summiert das Volumen der angebrochenen Kerze', () => {
    const ende = replayEnde(stunden, 3, basisS)!
    const out = kerzenBisZeitpunkt(vierStunden, stunden, ende, zielS, basisS)
    expect(out[0].volume).toBe(3)
  })

  it('lässt die angebrochene Kerze WEG, wenn die Basis sie nicht deckt', () => {
    // Lieber eine Kerze zu wenig als eine, die mehr weiß als der Übende.
    const ende = replayEnde(stunden, 2, basisS)!
    const out = kerzenBisZeitpunkt(vierStunden, [], ende, zielS, basisS)
    expect(out).toEqual([])
  })

  it('zeigt nie eine Kerze, die nach dem Replay-Moment beginnt', () => {
    const ende = replayEnde(stunden, 2, basisS)!
    const out = kerzenBisZeitpunkt(vierStunden, stunden, ende, zielS, basisS)
    expect(out.every((c) => c.time < ende)).toBe(true)
  })

  it('schneidet eine FEINERE Zeitebene sauber ab (Analyse kleinteiliger)', () => {
    // Ziel = Basis: Es darf sich nichts ändern außer dem Abschneiden.
    const ende = replayEnde(stunden, 3, basisS)!
    const out = kerzenBisZeitpunkt(stunden, stunden, ende, basisS, basisS)
    expect(out).toEqual(stunden.slice(0, 3))
  })

  it('kommt mit leeren Eingaben klar', () => {
    expect(kerzenBisZeitpunkt([], stunden, T0, zielS, basisS)).toEqual([])
  })

  it('gibt nichts heraus, wenn der Replay noch vor der ersten Kerze steht', () => {
    expect(kerzenBisZeitpunkt(vierStunden, stunden, T0, zielS, basisS)).toEqual([])
  })
})
