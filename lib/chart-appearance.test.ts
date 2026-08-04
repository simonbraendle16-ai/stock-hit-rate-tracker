import { describe, expect, it } from 'vitest'
import {
  APPEARANCE_PRESETS,
  DEFAULT_APPEARANCE,
  isDefaultAppearance,
  isValidColor,
  matchingPreset,
  normalizeAppearance,
} from './chart-appearance'

describe('isValidColor', () => {
  it('nimmt die üblichen Schreibweisen an', () => {
    for (const v of [
      '#fff',
      '#ffffff',
      '#ffffff80',
      'rgb(1,2,3)',
      'rgba(163, 166, 205, 0.08)',
      'transparent',
    ]) {
      expect(isValidColor(v), v).toBe(true)
    }
  })

  it('lehnt alles andere ab', () => {
    for (const v of ['red', 'url(x)', 'javascript:1', '#ff', '', null, 42, {}]) {
      expect(isValidColor(v), String(v)).toBe(false)
    }
  })
})

describe('normalizeAppearance', () => {
  it('gibt bei fehlender Eingabe den Standard', () => {
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE)
    expect(normalizeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE)
  })

  it('übernimmt gültige Felder und behält den Rest', () => {
    const a = normalizeAppearance({ bg: '#000000', up: '#ffffff' })
    expect(a.bg).toBe('#000000')
    expect(a.up).toBe('#ffffff')
    // unverändert
    expect(a.down).toBe(DEFAULT_APPEARANCE.down)
    expect(a.accent).toBe(DEFAULT_APPEARANCE.accent)
  })

  it('liest auch die gespeicherte JSON-Zeichenkette', () => {
    expect(normalizeAppearance(JSON.stringify({ bg: '#123456' })).bg).toBe('#123456')
  })

  it('lässt kaputtes JSON nicht durchschlagen', () => {
    expect(normalizeAppearance('{nicht json')).toEqual(DEFAULT_APPEARANCE)
    expect(normalizeAppearance('[]')).toEqual(DEFAULT_APPEARANCE)
    expect(normalizeAppearance(7)).toEqual(DEFAULT_APPEARANCE)
  })

  it('verwirft einzelne ungültige Farben, ohne das Ganze zu verlieren', () => {
    const a = normalizeAppearance({ bg: 'javascript:alert(1)', down: '#00ff00' })
    expect(a.bg).toBe(DEFAULT_APPEARANCE.bg)
    expect(a.down).toBe('#00ff00')
  })

  it('nimmt Wahrheitswerte nur als echte Wahrheitswerte', () => {
    expect(normalizeAppearance({ gridVisible: false }).gridVisible).toBe(false)
    expect(normalizeAppearance({ hollow: true }).hollow).toBe(true)
    // 'true' als Text ist kein Wahrheitswert
    expect(normalizeAppearance({ hollow: 'true' }).hollow).toBe(DEFAULT_APPEARANCE.hollow)
  })

  it('schneidet Leerzeichen ab', () => {
    expect(normalizeAppearance({ bg: '  #abcdef  ' }).bg).toBe('#abcdef')
  })
})

describe('Vorlagen', () => {
  it('sind alle vollständig und gültig', () => {
    for (const p of APPEARANCE_PRESETS) {
      expect(normalizeAppearance(p.values), p.id).toEqual(p.values)
    }
  })

  it('werden wiedererkannt', () => {
    for (const p of APPEARANCE_PRESETS) {
      expect(matchingPreset(p.values)).toBe(p.id)
    }
    expect(matchingPreset({ ...DEFAULT_APPEARANCE, bg: '#010203' })).toBeNull()
  })

  it('Schwarz/Weiß trägt wirklich schwarzen Grund und weiße Kerzen', () => {
    const sw = APPEARANCE_PRESETS.find((p) => p.id === 'schwarzweiss')!.values
    expect(sw.bg).toBe('#000000')
    expect(sw.borderUp).toBe('#ffffff')
    expect(sw.wickUp).toBe('#ffffff')
  })
})

describe('isDefaultAppearance', () => {
  it('erkennt den Auslieferungszustand', () => {
    expect(isDefaultAppearance(DEFAULT_APPEARANCE)).toBe(true)
    expect(isDefaultAppearance({ ...DEFAULT_APPEARANCE, hollow: true })).toBe(false)
  })
})
