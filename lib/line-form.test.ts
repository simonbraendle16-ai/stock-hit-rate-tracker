import { describe, expect, it } from 'vitest'
import {
  flaechenForm,
  istFlaechenTyp,
  istLinienTyp,
  linienEnden,
  linienForm,
} from './line-form'

describe('linienForm — der Typ ist nur noch die Voreinstellung', () => {
  it('macht aus einer Trendlinie eine schlichte Strecke', () => {
    const f = linienForm('trendline', null)
    expect(f).toEqual({
      extend: 'none',
      leftEnd: 'none',
      rightEnd: 'none',
      stats: false,
      priceLabels: false,
      middlePoint: false,
    })
  })

  it('behält die Bedeutung der bisherigen Werkzeuge bei', () => {
    // Genau das ist die Zusage: Kein Altbestand ändert sein Aussehen.
    expect(linienForm('ray', null).extend).toBe('right')
    expect(linienForm('extendedline', null).extend).toBe('both')
    expect(linienForm('arrow', null).rightEnd).toBe('arrow')
    expect(linienForm('infoline', null).stats).toBe(true)
  })

  it('lässt den Stil die Voreinstellung überschreiben', () => {
    // Der Kern des Umbaus: Eine gezogene Strecke lässt sich NACHTRÄGLICH zum
    // Strahl machen, statt sie löschen und neu ziehen zu müssen.
    expect(linienForm('trendline', { extend: 'right' } as never).extend).toBe('right')
    // Und andersherum: Ein Strahl darf zur Strecke werden.
    expect(linienForm('ray', { extend: 'none' } as never).extend).toBe('none')
  })

  it('nimmt jede Option einzeln an', () => {
    const f = linienForm('trendline', {
      extend: 'both',
      leftEnd: 'dot',
      rightEnd: 'arrow',
      stats: true,
      priceLabels: true,
      middlePoint: true,
    } as never)
    expect(f).toEqual({
      extend: 'both',
      leftEnd: 'dot',
      rightEnd: 'arrow',
      stats: true,
      priceLabels: true,
      middlePoint: true,
    })
  })

  it('wirft bei Unsinn nur das EINE Feld weg, nicht die Form', () => {
    // Sonst verlöre eine Zeichnung wegen eines kaputten Feldes auch ihre
    // Pfeilspitze — und der Fehler würde im Renderer gesucht.
    const f = linienForm('arrow', {
      extend: 'diagonal',
      leftEnd: 42,
      stats: 'ja',
    } as never)
    expect(f.extend).toBe('none')
    expect(f.leftEnd).toBe('none')
    expect(f.stats).toBe(false)
    expect(f.rightEnd).toBe('arrow') // die Voreinstellung des Typs bleibt
  })

  it('verträgt fehlenden und kaputten Stil', () => {
    for (const s of [null, undefined, 'text', 5, []] as never[]) {
      expect(() => linienForm('trendline', s)).not.toThrow()
    }
    expect(linienForm('ray', 'kaputt' as never).extend).toBe('right')
  })

  it('gibt für unbekannte Typen die schlichte Strecke', () => {
    expect(linienForm('gibtesnicht', null).extend).toBe('none')
  })
})

describe('istLinienTyp', () => {
  it('erkennt die Linien-Werkzeuge', () => {
    for (const t of ['trendline', 'ray', 'extendedline', 'arrow', 'infoline']) {
      expect(istLinienTyp(t)).toBe(true)
    }
    for (const t of ['rect', 'fib', 'hline', 'ew_impulse']) {
      expect(istLinienTyp(t)).toBe(false)
    }
  })
})

describe('linienEnden', () => {
  // Ein Platzhalter-„Verlängern": gibt an, von wo durch was gezogen wurde.
  const verlaengern = (von: string, durch: string) => `${von}->${durch}+`

  it('lässt eine Strecke unangetastet', () => {
    expect(linienEnden('A', 'B', 'none', verlaengern)).toEqual({ von: 'A', bis: 'B' })
  })

  it('verlängert nach rechts über den zweiten Punkt hinaus', () => {
    expect(linienEnden('A', 'B', 'right', verlaengern)).toEqual({ von: 'A', bis: 'A->B+' })
  })

  it('verlängert nach links über den ersten Punkt hinaus', () => {
    // Richtung umgekehrt: von B durch A hinaus.
    expect(linienEnden('A', 'B', 'left', verlaengern)).toEqual({ von: 'B->A+', bis: 'B' })
  })

  it('verlängert in beide Richtungen', () => {
    expect(linienEnden('A', 'B', 'both', verlaengern)).toEqual({
      von: 'B->A+',
      bis: 'A->B+',
    })
  })
})

describe('flaechenForm — Rechteck nach TradingViews Vorbild', () => {
  it('füllt und rahmt standardmäßig, ohne Mittellinie', () => {
    // Das entspricht dem bisherigen Aussehen — kein Altbestand ändert sich.
    expect(flaechenForm('rect', null)).toEqual({
      extend: 'none',
      border: true,
      background: true,
      middleLine: false,
    })
  })

  it('lässt sich zur reinen Zone ohne Rahmen machen', () => {
    expect(flaechenForm('rect', { border: false } as never).border).toBe(false)
  })

  it('lässt sich zum reinen Rahmen ohne Füllung machen', () => {
    // Genau das ging vorher nicht: Die Füllung war fest verdrahtet.
    expect(flaechenForm('rect', { background: false } as never).background).toBe(false)
  })

  it('kennt Mittellinie und Verlängern', () => {
    const f = flaechenForm('rect', { middleLine: true, extend: 'right' } as never)
    expect(f.middleLine).toBe(true)
    expect(f.extend).toBe('right')
  })

  it('wirft Unsinn feldweise weg', () => {
    const f = flaechenForm('rect', { border: 'nein', extend: 'schräg' } as never)
    expect(f.border).toBe(true)
    expect(f.extend).toBe('none')
  })

  it('verträgt kaputten Stil', () => {
    for (const s of [null, undefined, 'x', 7, []] as never[]) {
      expect(() => flaechenForm('rect', s)).not.toThrow()
    }
  })
})

describe('istFlaechenTyp', () => {
  it('erkennt die Flächen-Werkzeuge', () => {
    for (const t of ['rect', 'pricerange', 'daterange']) {
      expect(istFlaechenTyp(t)).toBe(true)
    }
    for (const t of ['trendline', 'fib', 'ellipse']) {
      expect(istFlaechenTyp(t)).toBe(false)
    }
  })

  it('zaehlt den Kanal dazu — er traegt dieselben Regler wie das Rechteck', () => {
    expect(istFlaechenTyp('channel')).toBe(true)
  })
})

describe('Kanal — Flaechenform', () => {
  it('faellt ohne Angabe auf Rahmen und Fuellung an, Mittellinie aus', () => {
    const f = flaechenForm('channel', null)
    expect(f).toEqual({ extend: 'none', border: true, background: true, middleLine: false })
  })

  it('laesst sich zur reinen Zone machen (Rahmen aus)', () => {
    expect(flaechenForm('channel', { border: false }).border).toBe(false)
  })

  it('nimmt dieselben Extend-Werte wie eine Linie', () => {
    expect(flaechenForm('channel', { extend: 'right' }).extend).toBe('right')
    expect(flaechenForm('channel', { extend: 'schraeg' }).extend).toBe('none')
  })
})
