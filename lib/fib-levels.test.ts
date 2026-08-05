import { describe, expect, it } from 'vitest'
import {
  addLevel,
  DEFAULT_FIB,
  DEFAULT_FIBEXT,
  fibLinien,
  MAX_FIB_LEVELS,
  normalizeFibStil,
  removeLevel,
  toggleLevel,
} from './fib-levels'

describe('normalizeFibStil', () => {
  it('gibt bei fehlenden Daten den Standard zurück', () => {
    expect(normalizeFibStil(null)).toEqual(DEFAULT_FIB)
    expect(normalizeFibStil('kaputt')).toEqual(DEFAULT_FIB)
    expect(normalizeFibStil({})).toEqual(DEFAULT_FIB)
  })

  it('gibt eine Kopie zurück, nie den Standard selbst', () => {
    const a = normalizeFibStil(null)
    a.levels[0].an = false
    expect(DEFAULT_FIB.levels[0].an).toBe(true)
  })

  it('übernimmt gültige Levels und wirft doppelte weg', () => {
    const s = normalizeFibStil({
      levels: [
        { wert: 0, an: true },
        { wert: 0.618, an: false },
        { wert: 0.618, an: true }, // doppelt
      ],
    })
    expect(s.levels).toHaveLength(2)
    expect(s.levels[1]).toMatchObject({ wert: 0.618, an: false })
  })

  it('wirft unsinnige Levels weg, ohne die gültigen zu verlieren', () => {
    const s = normalizeFibStil({
      levels: [{ wert: 0.5, an: true }, { wert: 99 }, { wert: Number.NaN }, 'quatsch', null],
    })
    expect(s.levels).toEqual([{ wert: 0.5, an: true }])
  })

  it('fällt auf den Standard zurück, wenn nichts Gültiges übrig bleibt', () => {
    // Eine Zeichnung ganz ohne Levels wäre unsichtbar — das darf nicht passieren.
    expect(normalizeFibStil({ levels: [] }).levels).toEqual(DEFAULT_FIB.levels)
    expect(normalizeFibStil({ levels: [{ wert: 50 }] }).levels).toEqual(DEFAULT_FIB.levels)
  })

  it('lässt eine ungültige Farbe nicht in ein SVG-Attribut', () => {
    expect(normalizeFibStil({ farbe: 'url(javascript:alert(1))' }).farbe).toBe(DEFAULT_FIB.farbe)
    expect(normalizeFibStil({ farbe: '#ff0000' }).farbe).toBe('#ff0000')
    expect(normalizeFibStil({ levels: [{ wert: 0.5, an: true, farbe: 'boese' }] }).levels[0].farbe)
      .toBeUndefined()
  })

  it('begrenzt die Linienstärke', () => {
    expect(normalizeFibStil({ staerke: 99 }).staerke).toBe(4)
    expect(normalizeFibStil({ staerke: 0 }).staerke).toBe(0.5)
    expect(normalizeFibStil({ staerke: 'dick' }).staerke).toBe(DEFAULT_FIB.staerke)
  })

  it('nimmt nur bekannte Beschriftungsarten', () => {
    expect(normalizeFibStil({ beschriftung: 'prozent' }).beschriftung).toBe('prozent')
    expect(normalizeFibStil({ beschriftung: 'irgendwas' }).beschriftung).toBe(
      DEFAULT_FIB.beschriftung,
    )
  })

  it('nimmt einen eigenen Standard entgegen (Extension)', () => {
    expect(normalizeFibStil(null, DEFAULT_FIBEXT)).toEqual(DEFAULT_FIBEXT)
  })

  it('begrenzt die Zahl der Levels', () => {
    const viele = Array.from({ length: 60 }, (_, i) => ({ wert: i / 100, an: true }))
    expect(normalizeFibStil({ levels: viele }).levels.length).toBe(MAX_FIB_LEVELS)
  })
})

describe('fibLinien', () => {
  it('rechnet das Retracement einer Aufwärtsbewegung', () => {
    const stil = normalizeFibStil({
      levels: [
        { wert: 0, an: true },
        { wert: 0.5, an: true },
        { wert: 1, an: true },
      ],
      beschriftung: 'aus',
    })
    // Von 100 nach 200 gezogen: 0 = 100, 0,5 = 150, 1 = 200.
    expect(fibLinien(stil, 100, 200).map((l) => l.preis)).toEqual([100, 150, 200])
  })

  it('rechnet auch abwärts richtig herum', () => {
    const stil = normalizeFibStil({ levels: [{ wert: 0.5, an: true }], beschriftung: 'aus' })
    expect(fibLinien(stil, 200, 100)[0].preis).toBe(150)
  })

  it('zeigt ausgeschaltete Levels nicht', () => {
    const stil = normalizeFibStil({
      levels: [
        { wert: 0, an: true },
        { wert: 0.5, an: false },
      ],
    })
    expect(fibLinien(stil, 0, 100).map((l) => l.wert)).toEqual([0])
  })

  it('liefert die Linien immer aufsteigend sortiert', () => {
    const stil = normalizeFibStil({
      levels: [
        { wert: 1, an: true },
        { wert: -0.618, an: true },
        { wert: 0.382, an: true },
      ],
    })
    expect(fibLinien(stil, 0, 100).map((l) => l.wert)).toEqual([-0.618, 0.382, 1])
  })

  it('betont die Basis der Messung', () => {
    const stil = normalizeFibStil({
      levels: [
        { wert: 0, an: true },
        { wert: 0.618, an: true },
        { wert: 1, an: true },
      ],
    })
    expect(fibLinien(stil, 0, 100).map((l) => l.betont)).toEqual([true, false, true])
  })

  it('beschriftet je nach Einstellung', () => {
    const mk = (b: string) => normalizeFibStil({ levels: [{ wert: 0.618, an: true }], beschriftung: b })
    expect(fibLinien(mk('aus'), 0, 100)[0].label).toBe('')
    expect(fibLinien(mk('prozent'), 0, 100)[0].label).toContain('61,8 %')
    expect(fibLinien(mk('preis'), 0, 100)[0].label).toContain('61,8000')
    const beides = fibLinien(mk('beides'), 0, 100)[0].label
    expect(beides).toContain('61,8000')
    expect(beides).toContain('61,8 %')
  })

  it('erbt die Farbe der Zeichnung, wenn das Level keine eigene hat', () => {
    const stil = normalizeFibStil({
      farbe: '#112233',
      levels: [
        { wert: 0, an: true },
        { wert: 1, an: true, farbe: '#445566' },
      ],
    })
    expect(fibLinien(stil, 0, 1).map((l) => l.farbe)).toEqual(['#112233', '#445566'])
  })

  it('trägt die Extension über dieselbe Formel', () => {
    // A=100, B=200, C=150 -> Ursprung C, Spanne B-A = 100.
    const stil = normalizeFibStil(
      { levels: [{ wert: 1, an: true }, { wert: 1.618, an: true }], beschriftung: 'aus' },
      DEFAULT_FIBEXT,
    )
    const linien = fibLinien(stil, 150, 150 + (200 - 100))
    expect(linien.map((l) => l.preis)).toEqual([250, 311.8])
  })
})

describe('Levels ändern', () => {
  it('schaltet ein Level um', () => {
    const s = toggleLevel(DEFAULT_FIB, 0.236)
    expect(s.levels.find((l) => l.wert === 0.236)?.an).toBe(false)
    expect(DEFAULT_FIB.levels.find((l) => l.wert === 0.236)?.an).toBe(true)
  })

  it('ergänzt ein eigenes Level sortiert', () => {
    const s = addLevel(DEFAULT_FIB, 0.707)
    const werte = s.levels.map((l) => l.wert)
    expect(werte).toContain(0.707)
    expect([...werte].sort((a, b) => a - b)).toEqual(werte)
  })

  it('schaltet ein vorhandenes Level ein, statt es doppelt anzulegen', () => {
    const aus = toggleLevel(DEFAULT_FIB, 0.5)
    const s = addLevel(aus, 0.5)
    expect(s.levels.filter((l) => l.wert === 0.5)).toHaveLength(1)
    expect(s.levels.find((l) => l.wert === 0.5)?.an).toBe(true)
  })

  it('nimmt keine unsinnigen Werte an', () => {
    expect(addLevel(DEFAULT_FIB, Number.NaN)).toBe(DEFAULT_FIB)
    expect(addLevel(DEFAULT_FIB, 50)).toBe(DEFAULT_FIB)
  })

  it('entfernt ein Level, lässt aber nie alle entfernen', () => {
    const s = removeLevel(DEFAULT_FIB, 0.236)
    expect(s.levels.map((l) => l.wert)).not.toContain(0.236)
    const einer = { ...DEFAULT_FIB, levels: [{ wert: 0.5, an: true }] }
    expect(removeLevel(einer, 0.5)).toBe(einer)
  })
})
