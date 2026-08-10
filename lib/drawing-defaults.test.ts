import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DRAWING_DEFAULTS,
  MAX_FIB_VORLAGEN,
  normalizeDrawingDefaults,
} from './drawing-defaults'
import { DEFAULT_FIB } from './fib-levels'

describe('normalizeDrawingDefaults — Fib-Vorlagen', () => {
  it('steht ohne Angabe auf keiner Vorlage', () => {
    expect(normalizeDrawingDefaults(null).fibVorlagen).toEqual([])
    expect(normalizeDrawingDefaults({}).fibVorlagen).toEqual([])
    expect(normalizeDrawingDefaults('kaputt').fibVorlagen).toEqual([])
  })

  it('liest Vorlagen aus einem JSON-String', () => {
    const roh = JSON.stringify({
      fibVorlagen: [{ name: 'Trend', stil: { levels: [{ wert: 0.618, an: true }] } }],
    })
    const d = normalizeDrawingDefaults(roh)
    expect(d.fibVorlagen).toHaveLength(1)
    expect(d.fibVorlagen[0].name).toBe('Trend')
    expect(d.fibVorlagen[0].stil.levels.map((l) => l.wert)).toEqual([0.618])
  })

  it('wirft Namenloses und Doppeltes weg', () => {
    const d = normalizeDrawingDefaults({
      fibVorlagen: [
        { name: 'A', stil: {} },
        { name: '  ', stil: {} },
        { name: 'a', stil: {} }, // gleicher Name, andere Schreibung
        'quatsch',
        null,
      ],
    })
    expect(d.fibVorlagen.map((v) => v.name)).toEqual(['A'])
  })

  it('kürzt zu lange Namen und begrenzt die Zahl', () => {
    const viele = Array.from({ length: MAX_FIB_VORLAGEN + 5 }, (_, i) => ({
      name: `Vorlage-${i}`.padEnd(60, 'x'),
      stil: {},
    }))
    const d = normalizeDrawingDefaults({ fibVorlagen: viele })
    expect(d.fibVorlagen).toHaveLength(MAX_FIB_VORLAGEN)
    for (const v of d.fibVorlagen) expect(v.name.length).toBeLessThanOrEqual(32)
  })

  it('repariert einen kaputten Vorlagen-Stil, statt die Vorlage zu verlieren', () => {
    // Eine unbrauchbare Level-Liste darf keine unsichtbare Zeichnung ergeben.
    const d = normalizeDrawingDefaults({
      fibVorlagen: [{ name: 'Kaputt', stil: { levels: [{ wert: 999 }] } }],
    })
    expect(d.fibVorlagen[0].stil.levels).toEqual(DEFAULT_FIB.levels)
  })

  it('lässt die übrigen Standards unberührt', () => {
    const d = normalizeDrawingDefaults({ fibVorlagen: [{ name: 'X', stil: {} }] })
    expect(d.farbe).toBe(DEFAULT_DRAWING_DEFAULTS.farbe)
    expect(d.staerke).toBe(DEFAULT_DRAWING_DEFAULTS.staerke)
  })
})
