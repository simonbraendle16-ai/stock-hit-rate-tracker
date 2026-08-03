import { describe, expect, it } from 'vitest'
import {
  MIN_HIDDEN_CANDLES,
  MIN_VISIBLE_CANDLES,
  defaultStartIndex,
  isBlindMode,
  randomStartIndex,
  requiresElliott,
  sanitizeErrorTags,
  serializeErrorTags,
  parseErrorTags,
  trimText,
  validateThesis,
  type TrainingThesis,
} from './training'

const these = (over: Partial<TrainingThesis> = {}): TrainingThesis => ({
  direction: 'long',
  elliottCount: null,
  invalidation: null,
  entryPrice: null,
  stopLoss: null,
  takeProfit: null,
  note: null,
  setupTags: [],
  ...over,
})

describe('Modi', () => {
  it('verdeckt Zufall und Elliott, nicht die freie Übung', () => {
    expect(isBlindMode('frei')).toBe(false)
    expect(isBlindMode('zufall')).toBe(true)
    expect(isBlindMode('elliott')).toBe(true)
  })

  it('verlangt die Wellenzählung nur im Elliott-Training', () => {
    expect(requiresElliott('elliott')).toBe(true)
    expect(requiresElliott('zufall')).toBe(false)
  })
})

describe('sanitizeErrorTags', () => {
  it('wirft Unbekanntes und Dubletten raus', () => {
    expect(sanitizeErrorTags(['stop_zu_eng', 'stop_zu_eng', 'quatsch'])).toEqual(['stop_zu_eng'])
  })

  it('nimmt "kein Fehler" zurück, sobald ein echter Fehler dabeisteht', () => {
    expect(sanitizeErrorTags(['kein_fehler', 'zu_frueher_einstieg'])).toEqual([
      'zu_frueher_einstieg',
    ])
    expect(sanitizeErrorTags(['kein_fehler'])).toEqual(['kein_fehler'])
  })

  it('begrenzt auf vier Fehler', () => {
    const alle = [
      'falsche_wellenzaehlung',
      'falsche_invalidierung',
      'grad_verwechselt',
      'korrektur_als_impuls',
      'zu_frueher_einstieg',
      'stop_zu_eng',
    ]
    expect(sanitizeErrorTags(alle)).toHaveLength(4)
  })

  it('liefert für zwei gleiche Auswahlen dieselbe Reihenfolge', () => {
    const a = sanitizeErrorTags(['stop_zu_eng', 'falsche_wellenzaehlung'])
    const b = sanitizeErrorTags(['falsche_wellenzaehlung', 'stop_zu_eng'])
    expect(a).toEqual(b)
  })

  it('macht aus leerer Auswahl null statt "[]"', () => {
    expect(serializeErrorTags([])).toBeNull()
    expect(parseErrorTags(null)).toEqual([])
    expect(parseErrorTags('kaputt')).toEqual([])
    expect(parseErrorTags(serializeErrorTags(['stop_zu_eng']))).toEqual(['stop_zu_eng'])
  })
})

describe('randomStartIndex', () => {
  it('lässt immer genug Vergangenheit und genug Zukunft', () => {
    const total = 400
    for (const r of [0, 0.25, 0.5, 0.75, 0.999999]) {
      const i = randomStartIndex(total, r)
      expect(i).toBeGreaterThanOrEqual(MIN_VISIBLE_CANDLES)
      expect(total - i).toBeGreaterThanOrEqual(MIN_HIDDEN_CANDLES)
    }
  })

  it('nutzt das Fenster von 35 % bis 80 % aus', () => {
    const total = 1000
    expect(randomStartIndex(total, 0)).toBe(350)
    expect(randomStartIndex(total, 0.999999)).toBe(800)
  })

  it('kommt mit knappen Historien und kaputten Zufallszahlen zurecht', () => {
    expect(randomStartIndex(40, Number.NaN)).toBeGreaterThan(0)
    expect(randomStartIndex(40, 0.5)).toBeLessThanOrEqual(40)
  })

  it('setzt den freien Start auf knapp zwei Drittel', () => {
    expect(defaultStartIndex(1000)).toBe(620)
    // Bei kurzer Historie bleibt trotzdem Zukunft übrig.
    expect(1000 - defaultStartIndex(1000)).toBeGreaterThanOrEqual(MIN_HIDDEN_CANDLES)
    expect(defaultStartIndex(50)).toBeLessThanOrEqual(50 - MIN_HIDDEN_CANDLES)
  })
})

describe('validateThesis', () => {
  it('nimmt eine saubere Long-These an', () => {
    expect(
      validateThesis('frei', these({ entryPrice: 100, stopLoss: 95, takeProfit: 115 })),
    ).toEqual([])
  })

  it('lehnt einen Stop über dem Einstieg bei Long ab', () => {
    const f = validateThesis('frei', these({ entryPrice: 100, stopLoss: 105 }))
    expect(f.join(' ')).toContain('Stop unter dem Einstieg')
  })

  it('lehnt ein Ziel unter dem Einstieg bei Short nicht ab', () => {
    expect(
      validateThesis(
        'frei',
        these({ direction: 'short', entryPrice: 100, stopLoss: 105, takeProfit: 90 }),
      ),
    ).toEqual([])
  })

  it('lässt "kein Setup" ohne Level durch', () => {
    expect(validateThesis('frei', these({ direction: 'keine' }))).toEqual([])
  })

  it('verlangt im Elliott-Training Zählung und Invalidation', () => {
    const f = validateThesis('elliott', these({ entryPrice: 100, stopLoss: 95 }))
    expect(f).toHaveLength(2)
    expect(
      validateThesis(
        'elliott',
        these({ entryPrice: 100, stopLoss: 95, elliottCount: 'Welle 3', invalidation: 94 }),
      ),
    ).toEqual([])
  })

  it('weist negative Kurse ab', () => {
    expect(validateThesis('frei', these({ entryPrice: -5 })).join(' ')).toContain('Einstieg')
  })
})

describe('trimText', () => {
  it('macht aus Leerraum null und kürzt zu lange Texte', () => {
    expect(trimText('   ', 10)).toBeNull()
    expect(trimText(42, 10)).toBeNull()
    expect(trimText('  hallo  ', 10)).toBe('hallo')
    expect(trimText('abcdefghijk', 5)).toBe('abcde')
  })
})
