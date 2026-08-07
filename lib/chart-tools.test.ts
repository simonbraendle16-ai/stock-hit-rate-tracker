import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOOL_PREFS,
  MAX_FAVORITES,
  isDefaultToolPrefs,
  moveFavorite,
  normalizeToolPrefs,
  toggleFavorite,
} from './chart-tools'

describe('normalizeToolPrefs', () => {
  it('gibt ohne Eintrag den Auslieferungszustand', () => {
    expect(normalizeToolPrefs(null)).toEqual(DEFAULT_TOOL_PREFS)
    expect(normalizeToolPrefs(undefined)).toEqual(DEFAULT_TOOL_PREFS)
  })

  it('überlebt kaputtes JSON, statt die Leiste zu kosten', () => {
    expect(normalizeToolPrefs('{nicht json')).toEqual(DEFAULT_TOOL_PREFS)
    expect(normalizeToolPrefs('[1,2,3]')).toEqual(DEFAULT_TOOL_PREFS)
    expect(normalizeToolPrefs(42)).toEqual(DEFAULT_TOOL_PREFS)
  })

  it('liest eine gespeicherte Liste als JSON-Text', () => {
    const p = normalizeToolPrefs('{"favorites":["ray","rect"],"keepTool":true}')
    expect(p.favorites).toEqual(['ray', 'rect'])
    expect(p.keepTool).toBe(true)
    expect(p.magnet).toBe(DEFAULT_TOOL_PREFS.magnet)
  })

  it('wirft Unsinn einzeln raus, nicht die ganze Liste', () => {
    const p = normalizeToolPrefs({
      favorites: ['trendline', 42, '', 'BÖSE', 'ray', null, 'trendline'],
    })
    expect(p.favorites).toEqual(['trendline', 'ray'])
  })

  it('nimmt eine LEER gespeicherte Liste ernst', () => {
    // „Keine Favoriten" ist eine Aussage, kein fehlender Wert — sonst käme die
    // Leiste nach dem Abwählen des letzten Sterns wieder zurück.
    expect(normalizeToolPrefs({ favorites: [] }).favorites).toEqual([])
  })

  it('deckelt die Zahl der Favoriten', () => {
    const viele = Array.from({ length: 40 }, (_, i) => `tool_${i}`)
    expect(normalizeToolPrefs({ favorites: viele }).favorites).toHaveLength(MAX_FAVORITES)
  })

  it('lässt heute unbekannte Werkzeuge stehen', () => {
    // Die Werkzeugliste wächst (Pitchfork, Gann …). Eine Formprüfung darf
    // Einträge nicht wegwerfen, nur weil die Leiste sie gerade nicht kennt.
    expect(normalizeToolPrefs({ favorites: ['pitchfork', 'gannbox'] }).favorites).toEqual([
      'pitchfork',
      'gannbox',
    ])
  })

  it('nimmt Schalter nur als echte Booleans', () => {
    const p = normalizeToolPrefs({ keepTool: 'ja', magnet: 1 })
    expect(p.keepTool).toBe(DEFAULT_TOOL_PREFS.keepTool)
    expect(p.magnet).toBe(DEFAULT_TOOL_PREFS.magnet)
  })
})

describe('toggleFavorite', () => {
  it('setzt und entfernt den Stern', () => {
    expect(toggleFavorite(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleFavorite(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('hängt neue Favoriten hinten an', () => {
    // Die Reihenfolge ist eine Gewohnheit; ein neuer Eintrag darf sie nicht
    // durcheinanderbringen.
    expect(toggleFavorite(['a', 'b', 'c'], 'd')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('nimmt über der Grenze nichts mehr auf', () => {
    const voll = Array.from({ length: MAX_FAVORITES }, (_, i) => `t${i}`)
    expect(toggleFavorite(voll, 'neu')).toEqual(voll)
    // Entfernen geht trotzdem.
    expect(toggleFavorite(voll, 't0')).toHaveLength(MAX_FAVORITES - 1)
  })
})

describe('moveFavorite', () => {
  it('schiebt einen Eintrag an eine andere Stelle', () => {
    expect(moveFavorite(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveFavorite(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })

  it('lässt die Liste bei unsinnigen Angaben unverändert', () => {
    expect(moveFavorite(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
    expect(moveFavorite(['a', 'b'], 5, 0)).toEqual(['a', 'b'])
    expect(moveFavorite(['a', 'b'], -1, 0)).toEqual(['a', 'b'])
  })

  it('klemmt ein Ziel jenseits des Endes ans Ende', () => {
    expect(moveFavorite(['a', 'b', 'c'], 0, 99)).toEqual(['b', 'c', 'a'])
  })
})

describe('isDefaultToolPrefs', () => {
  it('erkennt den Auslieferungszustand', () => {
    expect(isDefaultToolPrefs(DEFAULT_TOOL_PREFS)).toBe(true)
    expect(isDefaultToolPrefs({ ...DEFAULT_TOOL_PREFS, keepTool: true })).toBe(false)
    expect(isDefaultToolPrefs({ ...DEFAULT_TOOL_PREFS, favorites: ['ray'] })).toBe(false)
  })
})
