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

// --- Teil 4: die Regel gilt für ZWEI übergeordnete Ebenen ------------------
//
// Der Abnahmepunkt des Plans: „Die angebrochene Kerze der höheren Ebene verrät
// weiterhin nichts über die Zukunft — und zwar auf beiden Ebenen."
//
// Warum das überhaupt zu prüfen ist: Teil 4 zeigt zwei Kontext-Charts statt
// einem. Beide bekommen dieselbe Basis-Ebene und denselben Moment; die Frage
// ist, ob der Zuschnitt auch für die GRÖBERE der beiden noch trägt. Genau dort
// wäre der Fehler teuer: Eine Tageskerze, die ihr fertiges Hoch zeigt, verrät
// mehr als eine 4h-Kerze, die dasselbe tut.

describe('zwei übergeordnete Ebenen gleichzeitig', () => {
  const TAG = 24 * H

  /** Zwölf Stundenkerzen; das Extrem (140) liegt in der ZEHNTEN. */
  const basis: Candle[] = Array.from({ length: 12 }, (_, i) =>
    i === 9
      ? k(T0 + 9 * H, 100, 140, 60, 100)
      : k(T0 + i * H, 100, 101, 99, 100),
  )

  /** Die 4h-Kerzen dazu — die dritte enthält das Extrem. */
  const vierer: Candle[] = [
    k(T0 + 0 * H, 100, 101, 99, 100, 4),
    k(T0 + 4 * H, 100, 101, 99, 100, 4),
    k(T0 + 8 * H, 100, 140, 60, 100, 4),
  ]

  /** Die Tageskerze, die alles umspannt — mit dem fertigen Extrem. */
  const tage: Candle[] = [k(T0, 100, 140, 60, 100, 12)]

  // Der Replay steht nach acht Stunden: Stunde 10 (Index 9) ist noch nicht
  // gelaufen, das Extrem also unbekannt.
  const ende = replayEnde(basis, 8, H)!

  it('haelt das Extrem auf der ersten Ebene zurueck', () => {
    const geschnitten = kerzenBisZeitpunkt(vierer, basis, ende, 4 * H, H)
    const letzte = geschnitten[geschnitten.length - 1]
    expect(letzte.high).toBeLessThan(140)
    expect(letzte.low).toBeGreaterThan(60)
  })

  it('haelt das Extrem auch auf der ZWEITEN, groeberen Ebene zurueck', () => {
    const geschnitten = kerzenBisZeitpunkt(tage, basis, ende, TAG, H)
    expect(geschnitten).toHaveLength(1)
    expect(geschnitten[0].high).toBeLessThan(140)
    expect(geschnitten[0].low).toBeGreaterThan(60)
  })

  it('stellt beide Ebenen auf denselben Moment — kein Ausreisser nach rechts', () => {
    for (const [ziel, sek] of [
      [vierer, 4 * H],
      [tage, TAG],
    ] as const) {
      for (const c of kerzenBisZeitpunkt(ziel, basis, ende, sek, H)) {
        // Keine Kerze darf jenseits des Replay-Moments beginnen.
        expect(c.time).toBeLessThan(ende)
      }
    }
  })

  it('verraet auf keiner Ebene mehr als die Basis selbst', () => {
    const bisher = basis.filter((c) => c.time + H <= ende)
    const hoechstesBekannt = Math.max(...bisher.map((c) => c.high))
    const tiefstesBekannt = Math.min(...bisher.map((c) => c.low))

    for (const [ziel, sek] of [
      [vierer, 4 * H],
      [tage, TAG],
    ] as const) {
      for (const c of kerzenBisZeitpunkt(ziel, basis, ende, sek, H)) {
        expect(c.high).toBeLessThanOrEqual(hoechstesBekannt)
        expect(c.low).toBeGreaterThanOrEqual(tiefstesBekannt)
      }
    }
  })
})
