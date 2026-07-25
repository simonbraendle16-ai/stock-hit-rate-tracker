import { describe, expect, it } from 'vitest'
import {
  MAX_SETUP_TAGS,
  SETUP_TAG_MAX_LEN,
  normalizeSetupTag,
  parseSetupTags,
  rankSetupTags,
  sanitizeSetupTags,
  serializeSetupTags,
  setupTagKey,
  setupTagKeys,
  suggestSetupTags,
} from './setups'

describe('setupTagKey', () => {
  it('macht Schreibweisen desselben Setups vergleichbar', () => {
    const keys = ['Breakout', 'breakout', 'BREAKOUT', 'Break-Out', 'Break out', ' Breakout ']
      .map(setupTagKey)
    expect(new Set(keys).size).toBe(1)
    expect(keys[0]).toBe('breakout')
  })

  it('faltet Umlaute deutsch (ä→ae), nicht durch Weglassen der Punkte', () => {
    expect(setupTagKey('Rücksetzer')).toBe('ruecksetzer')
    expect(setupTagKey('Ruecksetzer')).toBe('ruecksetzer')
    expect(setupTagKey('Größe')).toBe('groesse')
  })

  it('zieht kombinierende Akzente auf den Grundbuchstaben zurück', () => {
    // Dieselbe Anzeige, zwei verschiedene Zeichenketten: einmal ein einzelnes
    // Zeichen (U+00E9), einmal e + kombinierender Akzent (U+0301).
    const zerlegt = 'Cafe' + String.fromCharCode(0x301)
    const einZeichen = zerlegt.normalize('NFC')
    expect(zerlegt).not.toBe(einZeichen)
    expect(setupTagKey(zerlegt)).toBe('cafe')
    expect(setupTagKey(einZeichen)).toBe('cafe')
  })

  it('behält Ziffern — „Welle 3" ist ein anderes Setup als „Welle 5"', () => {
    expect(setupTagKey('Welle 3')).toBe('welle3')
    expect(setupTagKey('Welle 3')).not.toBe(setupTagKey('Welle 5'))
  })

  it('gibt null zurück, wenn nichts Verwertbares übrig bleibt', () => {
    expect(setupTagKey('---')).toBeNull()
    expect(setupTagKey('   ')).toBeNull()
    expect(setupTagKey('')).toBeNull()
  })
})

describe('normalizeSetupTag', () => {
  it('zieht Leerraum zusammen und behält die geschriebene Form als Label', () => {
    expect(normalizeSetupTag('  Breakout   Vortageshoch ')).toEqual({
      key: 'breakoutvortageshoch',
      label: 'Breakout Vortageshoch',
    })
  })

  it('begrenzt die Länge', () => {
    const tag = normalizeSetupTag('x'.repeat(SETUP_TAG_MAX_LEN + 20))
    expect(tag?.label.length).toBe(SETUP_TAG_MAX_LEN)
  })

  it('weist Nicht-Zeichenketten und leere Eingaben ab', () => {
    expect(normalizeSetupTag(null)).toBeNull()
    expect(normalizeSetupTag(42)).toBeNull()
    expect(normalizeSetupTag('  ')).toBeNull()
  })
})

describe('sanitizeSetupTags', () => {
  it('entfernt Doppelte über den Schlüssel, nicht über die Schreibweise', () => {
    expect(sanitizeSetupTags(['Breakout', 'breakout', 'BREAK-OUT'])).toEqual(['Breakout'])
  })

  it('behält die Reihenfolge der Eingabe', () => {
    expect(sanitizeSetupTags(['Pullback', 'Breakout'])).toEqual(['Pullback', 'Breakout'])
  })

  it('deckelt bei MAX_SETUP_TAGS', () => {
    const many = ['a1', 'b2', 'c3', 'd4', 'e5']
    expect(sanitizeSetupTags(many)).toHaveLength(MAX_SETUP_TAGS)
    expect(sanitizeSetupTags(many)).toEqual(many.slice(0, MAX_SETUP_TAGS))
  })

  it('überspringt Müll statt die ganze Liste zu verwerfen', () => {
    expect(sanitizeSetupTags(['Breakout', null, 7, '---', 'Pullback'])).toEqual([
      'Breakout',
      'Pullback',
    ])
  })

  it('ergibt [] für alles, was keine Liste ist', () => {
    expect(sanitizeSetupTags('Breakout')).toEqual([])
    expect(sanitizeSetupTags(undefined)).toEqual([])
  })
})

describe('parse/serialize', () => {
  it('sind zueinander invers', () => {
    const raw = serializeSetupTags(['Breakout', 'Pullback'])
    expect(parseSetupTags(raw)).toEqual(['Breakout', 'Pullback'])
  })

  it('speichert eine leere Auswahl als null, nicht als "[]"', () => {
    expect(serializeSetupTags([])).toBeNull()
    expect(serializeSetupTags(['---'])).toBeNull()
  })

  it('verträgt defekte Spaltenwerte', () => {
    expect(parseSetupTags('kein json')).toEqual([])
    expect(parseSetupTags('{"a":1}')).toEqual([])
    expect(parseSetupTags(null)).toEqual([])
  })

  it('säubert auch beim Lesen — Altbestand kann alles enthalten', () => {
    expect(parseSetupTags('["Breakout","breakout","  "]')).toEqual(['Breakout'])
  })

  it('setupTagKeys liefert die Vergleichs-Schlüssel', () => {
    expect(setupTagKeys('["Rücksetzer","Breakout"]')).toEqual(['ruecksetzer', 'breakout'])
    expect(setupTagKeys(null)).toEqual([])
  })
})

describe('suggestSetupTags (Migrationshilfe)', () => {
  it('zerlegt eine Aufzählung in Kandidaten', () => {
    expect(suggestSetupTags('Breakout, Trendfolge / Pullback')).toEqual([
      'Breakout',
      'Trendfolge',
      'Pullback',
    ])
  })

  it('nimmt einen kurzen Freitext als einzelnes Tag', () => {
    expect(suggestSetupTags('Breakout Vortageshoch')).toEqual(['Breakout Vortageshoch'])
  })

  it('schlägt aus einem ganzen Satz nichts vor', () => {
    // Genau der Fall, der einen Backfill unbrauchbar machen würde.
    expect(
      suggestSetupTags('Long, weil der Markt insgesamt sehr stark aussah und die Zahlen kamen'),
    ).toEqual([])
  })

  it('schneidet keinen zu langen Kandidaten auf Tag-Länge zurecht', () => {
    const langesWort = 'x'.repeat(SETUP_TAG_MAX_LEN + 5)
    expect(suggestSetupTags(langesWort)).toEqual([])
  })

  it('liefert keine Doppelten und höchstens MAX_SETUP_TAGS', () => {
    expect(suggestSetupTags('Breakout, breakout, Pullback, Trend, Range')).toEqual([
      'Breakout',
      'Pullback',
      'Trend',
    ])
  })

  it('ist bei leerem Freitext leer', () => {
    expect(suggestSetupTags(null)).toEqual([])
    expect(suggestSetupTags('   ')).toEqual([])
    expect(suggestSetupTags('- / -')).toEqual([])
  })
})

describe('rankSetupTags', () => {
  it('sortiert nach Häufigkeit', () => {
    const ranked = rankSetupTags([
      '["Breakout"]',
      '["Breakout","Pullback"]',
      '["Breakout"]',
      '["Pullback"]',
      '["Range"]',
    ])
    expect(ranked.map((t) => t.label)).toEqual(['Breakout', 'Pullback', 'Range'])
    expect(ranked[0].count).toBe(3)
    expect(ranked[2].count).toBe(1)
  })

  it('fasst Schreibweisen zusammen und zeigt die häufigste an', () => {
    const ranked = rankSetupTags(['["breakout"]', '["Breakout"]', '["Breakout"]'])
    expect(ranked).toHaveLength(1)
    expect(ranked[0]).toMatchObject({ key: 'breakout', label: 'Breakout', count: 3 })
  })

  it('nimmt bei Gleichstand die zuerst gesehene Schreibweise', () => {
    const ranked = rankSetupTags(['["breakout"]', '["Breakout"]'])
    expect(ranked[0].label).toBe('breakout')
  })

  it('verträgt leere und defekte Spalten', () => {
    expect(rankSetupTags([null, undefined, 'kaputt', '[]'])).toEqual([])
  })
})
