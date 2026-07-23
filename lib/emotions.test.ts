import { describe, expect, it } from 'vitest'
import {
  EMOTION_TAGS,
  MOOD_GROUPS,
  MOOD_NOTE_MAX,
  MOOD_SCALE,
  emotionTagLabel,
  isMoodScore,
  moodGroupOf,
  moodScoreLabel,
  normalizeMoodCheck,
  normalizeMoodScore,
  parseMoodTags,
  sanitizeMoodTags,
  serializeMoodTags,
} from './emotions'

describe('Katalog', () => {
  it('deckt die Skala 1–5 lückenlos ab', () => {
    expect(MOOD_SCALE.map((s) => s.value)).toEqual([1, 2, 3, 4, 5])
  })

  it('ordnet jedem Skalenwert genau eine Gruppe zu', () => {
    for (const step of MOOD_SCALE) {
      const treffer = MOOD_GROUPS.filter((g) => step.value >= g.min && step.value <= g.max)
      expect(treffer).toHaveLength(1)
    }
  })

  it('hat eindeutige Tag-Schlüssel', () => {
    const keys = EMOTION_TAGS.map((t) => t.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('normalizeMoodScore', () => {
  it('nimmt gültige Werte an', () => {
    expect(normalizeMoodScore(1)).toBe(1)
    expect(normalizeMoodScore(5)).toBe(5)
  })

  it('wandelt Zahlen aus Formularfeldern (Strings) um', () => {
    expect(normalizeMoodScore('3')).toBe(3)
  })

  it('lehnt alles außerhalb der Skala ab', () => {
    for (const v of [0, 6, -1, 2.5, null, undefined, '', 'ruhig', {}, NaN]) {
      expect(normalizeMoodScore(v)).toBeNull()
    }
  })

  it('isMoodScore ist deckungsgleich für Zahlen', () => {
    expect(isMoodScore(3)).toBe(true)
    expect(isMoodScore(3.5)).toBe(false)
    expect(isMoodScore('3')).toBe(false)
  })
})

describe('sanitizeMoodTags', () => {
  it('wirft unbekannte Tags weg — die Liste ist geschlossen', () => {
    expect(sanitizeMoodTags(['fomo', 'euphorie', 'irgendwas'])).toEqual(['fomo'])
  })

  it('entfernt Doppelte und normalisiert Groß-/Kleinschreibung', () => {
    expect(sanitizeMoodTags(['FOMO', 'fomo', ' Fomo '])).toEqual(['fomo'])
  })

  it('bringt die Tags in Katalog-Reihenfolge, unabhängig von der Eingabe', () => {
    // Ohne feste Reihenfolge wären zwei gleich getaggte Trades in der DB
    // unterschiedlich serialisiert und schwerer vergleichbar.
    expect(sanitizeMoodTags(['gleichmut', 'fomo', 'angst'])).toEqual([
      'fomo',
      'angst',
      'gleichmut',
    ])
  })

  it('verträgt Müll ohne zu werfen', () => {
    expect(sanitizeMoodTags(null)).toEqual([])
    expect(sanitizeMoodTags('fomo')).toEqual([])
    expect(sanitizeMoodTags([1, null, {}, 'gier'])).toEqual(['gier'])
  })
})

describe('serializeMoodTags / parseMoodTags', () => {
  it('ist ein Rundlauf ohne Verlust', () => {
    const raw = serializeMoodTags(['gier', 'fomo'])
    expect(parseMoodTags(raw)).toEqual(['fomo', 'gier'])
  })

  it('speichert eine leere Auswahl als null, nicht als "[]"', () => {
    expect(serializeMoodTags([])).toBeNull()
    expect(serializeMoodTags(['unbekannt'])).toBeNull()
  })

  it('liefert bei defektem JSON eine leere Liste statt zu werfen', () => {
    expect(parseMoodTags('{kaputt')).toEqual([])
    expect(parseMoodTags('"fomo"')).toEqual([])
    expect(parseMoodTags(null)).toEqual([])
  })
})

describe('moodGroupOf', () => {
  it('gruppiert nach der Roadmap-Einteilung', () => {
    expect(moodGroupOf(1)).toBe('ruhig')
    expect(moodGroupOf(2)).toBe('ruhig')
    expect(moodGroupOf(3)).toBe('angespannt')
    expect(moodGroupOf(4)).toBe('aufgewuehlt')
    expect(moodGroupOf(5)).toBe('aufgewuehlt')
  })

  it('gibt für fehlende Werte null zurück — Alt-Trades zählen in keiner Gruppe', () => {
    expect(moodGroupOf(null)).toBeNull()
    expect(moodGroupOf(undefined)).toBeNull()
    expect(moodGroupOf(7)).toBeNull()
  })
})

describe('normalizeMoodCheck', () => {
  it('nimmt eine vollständige Momentaufnahme an', () => {
    expect(
      normalizeMoodCheck({ score: 4, tags: ['fomo', 'fomo'], note: '  hektisch  ' }),
    ).toEqual({ score: 4, tags: ['fomo'], note: 'hektisch' })
  })

  it('lässt Tags und Notiz weg — nur die Skala ist Pflicht', () => {
    expect(normalizeMoodCheck({ score: 1, tags: [] })).toEqual({
      score: 1,
      tags: [],
      note: null,
    })
  })

  it('lehnt eine Eingabe ohne gültigen Skalenwert ab', () => {
    // Tags und Notiz allein ergeben keinen auswertbaren Datenpunkt.
    expect(normalizeMoodCheck({ score: null, tags: ['gier'], note: 'viel' })).toBeNull()
    expect(normalizeMoodCheck(null)).toBeNull()
    expect(normalizeMoodCheck(undefined)).toBeNull()
  })

  it('kürzt eine überlange Notiz, statt sie abzulehnen', () => {
    const lang = 'x'.repeat(MOOD_NOTE_MAX + 50)
    expect(normalizeMoodCheck({ score: 2, tags: [], note: lang })!.note).toHaveLength(
      MOOD_NOTE_MAX,
    )
  })

  it('macht aus einer leeren Notiz null, nicht ""', () => {
    expect(normalizeMoodCheck({ score: 2, tags: [], note: '   ' })!.note).toBeNull()
  })
})

describe('Beschriftungen', () => {
  it('moodScoreLabel zeigt Wert und Wort', () => {
    expect(moodScoreLabel(3)).toBe('3 · angespannt')
    expect(moodScoreLabel(null)).toBeNull()
  })

  it('emotionTagLabel gibt unbekannte Schlüssel unverändert zurück', () => {
    expect(emotionTagLabel('fomo')).toBe('FOMO')
    expect(emotionTagLabel('unbekannt')).toBe('unbekannt')
  })
})
