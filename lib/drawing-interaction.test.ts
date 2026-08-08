import { describe, expect, it } from 'vitest'
import {
  KLICK_SCHWELLE,
  TOOL_SPECS,
  gesteAuswerten,
  istZeichenwerkzeug,
  istZug,
  punkteVerschieben,
  vorschauPunkte,
  werkzeugBleibt,
} from './drawing-interaction'
import { barStep, logicalToTime, timeToLogical } from './chart-coords'
import type { DrawingPoint } from '@/app/actions/drawings'

const p = (time: number, price: number) => ({ time, price })

describe('istZug', () => {
  it('trennt Klick von Ziehen', () => {
    expect(istZug({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(false)
    expect(istZug({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(false)
    expect(istZug({ x: 0, y: 0 }, { x: KLICK_SCHWELLE, y: 0 })).toBe(true)
    expect(istZug({ x: 100, y: 100 }, { x: 140, y: 60 })).toBe(true)
  })

  it('misst schräg, nicht je Achse', () => {
    // 3/4/5-Dreieck: 3 px waagerecht plus 4 px senkrecht sind 5 px Weg.
    expect(istZug({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(true)
  })
})

describe('gesteAuswerten — Ziehen', () => {
  it('legt eine Trendlinie in EINER Geste an', () => {
    // Der Kern der ganzen Etappe: vorher brauchte das zwei getrennte Klicks.
    const r = gesteAuswerten('trendline', [], p(100, 10), p(200, 20), true)
    expect(r).toEqual({ art: 'anlegen', punkte: [p(100, 10), p(200, 20)] })
  })

  it('gilt für alles, was eine Strecke aufspannt', () => {
    for (const tool of ['ray', 'arrow', 'rect', 'ellipse', 'fib', 'pricerange', 'daterange'] as const) {
      const r = gesteAuswerten(tool, [], p(1, 1), p(2, 2), true)
      expect(r.art).toBe('anlegen')
    }
  })

  it('zieht beim Kanal nur die Basis und wartet auf den dritten Punkt', () => {
    const r = gesteAuswerten('channel', [], p(1, 1), p(2, 2), true)
    expect(r).toEqual({ art: 'weiter', punkte: [p(1, 1), p(2, 2)] })

    const fertig = gesteAuswerten('channel', [p(1, 1), p(2, 2)], p(3, 3), p(3, 3), false)
    expect(fertig).toEqual({ art: 'anlegen', punkte: [p(1, 1), p(2, 2), p(3, 3)] })
  })

  it('zieht bei einem Wellenzug NICHT — jeder Punkt ist eine eigene Aussage', () => {
    const r = gesteAuswerten('ew_impulse', [], p(1, 1), p(2, 2), true)
    // Trotz Ziehen nur EIN Punkt gesetzt (der Endpunkt der Geste).
    expect(r).toEqual({ art: 'weiter', punkte: [p(2, 2)] })
  })
})

describe('gesteAuswerten — Klicken bleibt vollständig erhalten', () => {
  it('setzt Punkt für Punkt wie bisher', () => {
    const erst = gesteAuswerten('trendline', [], p(1, 1), p(1, 1), false)
    expect(erst).toEqual({ art: 'weiter', punkte: [p(1, 1)] })

    const dann = gesteAuswerten('trendline', [p(1, 1)], p(9, 9), p(9, 9), false)
    expect(dann).toEqual({ art: 'anlegen', punkte: [p(1, 1), p(9, 9)] })
  })

  it('führt einen Elliott-Impuls über sechs Klicks', () => {
    let gesetzt: ReturnType<typeof p>[] = []
    for (let i = 1; i <= 5; i++) {
      const r = gesteAuswerten('ew_impulse', gesetzt, p(i, i), p(i, i), false)
      expect(r.art).toBe('weiter')
      if (r.art === 'weiter') gesetzt = r.punkte
    }
    const letzter = gesteAuswerten('ew_impulse', gesetzt, p(6, 6), p(6, 6), false)
    expect(letzter.art).toBe('anlegen')
    if (letzter.art === 'anlegen') expect(letzter.punkte).toHaveLength(6)
  })
})

describe('gesteAuswerten — Ein-Punkt-Werkzeuge', () => {
  it('nimmt den Druckpunkt, auch wenn die Hand verwackelt', () => {
    // Sonst verschöbe ein unruhiger Klick die waagerechte Linie.
    for (const tool of ['hline', 'vline'] as const) {
      const r = gesteAuswerten(tool, [], p(5, 50), p(9, 99), true)
      expect(r).toEqual({ art: 'anlegen', punkte: [p(5, 50)] })
    }
  })
})

describe('gesteAuswerten — Grenzfälle', () => {
  it('meldet „nichts" für Werkzeuge mit eigenem Ablauf', () => {
    for (const tool of ['cursor', 'eraser', 'text', 'measure', 'brush', 'longpos'] as const) {
      expect(gesteAuswerten(tool, [], p(1, 1), p(2, 2), true)).toEqual({ art: 'nichts' })
    }
  })

  it('gibt nie mehr Punkte zurück, als der Typ erlaubt', () => {
    // Die Serveraktion lehnt zu viele Punkte ab — hier darf gar nichts
    // Überzähliges entstehen.
    const r = gesteAuswerten('trendline', [p(1, 1), p(2, 2)], p(3, 3), p(3, 3), false)
    expect(r.art).toBe('anlegen')
    if (r.art === 'anlegen') expect(r.punkte).toHaveLength(2)
  })
})

describe('vorschauPunkte', () => {
  it('zeigt die Strecke schon beim Ziehen', () => {
    expect(vorschauPunkte('trendline', [], p(1, 1), p(5, 5), true)).toEqual([p(1, 1), p(5, 5)])
  })

  it('hängt den Zeiger im Klick-Modus an die gesetzten Punkte', () => {
    expect(vorschauPunkte('trendline', [p(1, 1)], null, p(7, 7), false)).toEqual([
      p(1, 1),
      p(7, 7),
    ])
  })

  it('ist ohne Zeiger leer statt geraten', () => {
    expect(vorschauPunkte('trendline', [p(1, 1)], null, null, false)).toEqual([])
  })

  it('zeigt beim Ein-Punkt-Werkzeug den Zeiger selbst', () => {
    expect(vorschauPunkte('hline', [], null, p(3, 30), false)).toEqual([p(3, 30)])
  })
})

describe('istZeichenwerkzeug / werkzeugBleibt', () => {
  it('kennt genau die Werkzeuge aus der Tabelle', () => {
    expect(istZeichenwerkzeug('trendline')).toBe(true)
    expect(istZeichenwerkzeug('cursor')).toBe(false)
    expect(istZeichenwerkzeug('measure')).toBe(false)
    expect(Object.keys(TOOL_SPECS).length).toBeGreaterThanOrEqual(14)
  })

  it('hält das Werkzeug nur fest, wenn es gewünscht ist', () => {
    expect(werkzeugBleibt('trendline', true)).toBe(true)
    expect(werkzeugBleibt('trendline', false)).toBe(false)
    expect(werkzeugBleibt('cursor', true)).toBe(false)
  })
})

describe('punkteVerschieben', () => {
  const STUNDE = 3600
  const TAG = 86400
  const gitter = (n: number, schritt: number, ab = 1_700_000_000) =>
    Array.from({ length: n }, (_, i) => ab + i * schritt)

  const rechner = (times: number[]) => {
    const step = barStep(times)
    return {
      zuIndex: (t: number) => timeToLogical(times, step, t),
      zuZeit: (i: number) => logicalToTime(times, step, i),
    }
  }

  const pkt = (time: number, price = 100): DrawingPoint => ({ time, price })

  it('lässt die Zeichnung stehen, wenn sie nur senkrecht wandert', () => {
    const times = gitter(300, STUNDE)
    const { zuIndex, zuZeit } = rechner(times)
    const punkte = [pkt(times[50]), pkt(times[70]), pkt(times[90]), pkt(times[110])]
    const neu = punkteVerschieben(punkte, 0, 5, zuIndex, zuZeit)
    expect(neu.map((p) => p.time)).toEqual(punkte.map((p) => p.time))
    expect(neu.map((p) => p.price)).toEqual([105, 105, 105, 105])
  })

  it('rückt jeden Punkt um DIESELBE Zahl Balken', () => {
    const times = gitter(300, STUNDE)
    const { zuIndex, zuZeit } = rechner(times)
    const punkte = [pkt(times[50]), pkt(times[70]), pkt(times[90]), pkt(times[110])]
    for (const versatz of [1, -1, 7, -12]) {
      const neu = punkteVerschieben(punkte, versatz, 0, zuIndex, zuZeit)
      for (let k = 0; k < punkte.length; k++) {
        expect(neu[k].time - punkte[k].time).toBe(versatz * STUNDE)
      }
    }
  })

  /**
   * Der gemeldete Fehler: Eine WXY-Zeichnung schwenkte beim Anfassen schnell
   * hin und her. Ursache war ein Sprung genau zwischen Versatz 0 und 1 — die
   * Punkte wurden dort aus ihrem GERUNDETEN Rasterindex neu erzeugt und
   * wanderten dabei unterschiedlich weit (gemessen: 4, 5, 9 und 6 Tage statt
   * einheitlich 7). Ein Zittern der Hand kippt genau dort hin und her.
   */
  it('verformt eine Zeichnung nicht, die von einer feineren Ebene stammt', () => {
    // Wochenkerzen (Kontext-Chart), Zeichnung auf Stundenbasis gezogen.
    const times = gitter(300, 7 * TAG)
    const { zuIndex, zuZeit } = rechner(times)
    const punkte = [
      pkt(times[50] + 3 * TAG),
      pkt(times[70] + 2 * TAG),
      pkt(times[90] + 5 * TAG),
      pkt(times[110] + 1 * TAG),
    ]

    const bei0 = punkteVerschieben(punkte, 0, 0, zuIndex, zuZeit)
    const bei1 = punkteVerschieben(punkte, 1, 0, zuIndex, zuZeit)

    // Der Schritt von 0 auf 1 Balken bewegt JEDEN Punkt um genau eine Woche.
    for (let k = 0; k < punkte.length; k++) {
      expect(bei1[k].time - bei0[k].time).toBe(7 * TAG)
    }

    // Und die Abstände untereinander bleiben erhalten — nichts verformt sich.
    const abstand = (ps: DrawingPoint[]) =>
      ps.slice(1).map((p, i) => p.time - ps[i].time)
    expect(abstand(bei1)).toEqual(abstand(punkte))
  })

  it('ist umkehrbar — hin und zurück ergibt den Ausgangszustand', () => {
    const times = gitter(300, 7 * TAG)
    const { zuIndex, zuZeit } = rechner(times)
    const punkte = [pkt(times[40] + 2 * TAG), pkt(times[60] + 6 * TAG)]
    const hin = punkteVerschieben(punkte, 5, 3, zuIndex, zuZeit)
    const zurueck = punkteVerschieben(hin, -5, -3, zuIndex, zuZeit)
    expect(zurueck).toEqual(punkte)
  })
})
