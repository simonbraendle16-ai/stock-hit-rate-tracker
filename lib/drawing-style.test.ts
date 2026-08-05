import { describe, expect, it } from 'vitest'
import { farbeGueltig, normalizeDrawingStyle, strichArray } from './drawing-style'

describe('normalizeDrawingStyle', () => {
  it('liefert bei fehlender Einstellung den Standard', () => {
    const d = normalizeDrawingStyle(null)
    expect(d.width).toBe(1.5)
    expect(d.dashed).toBe(false)
    expect(d.label).toBeNull()
    expect(d.color).toMatch(/^#/)
  })

  it('nimmt die vom Aufrufer gesetzte Standardfarbe', () => {
    expect(normalizeDrawingStyle(null, '#123456').color).toBe('#123456')
  })

  it('lässt keine ungültige Farbe in ein SVG-Attribut', () => {
    expect(normalizeDrawingStyle({ color: 'url(#boese)' }, '#123456').color).toBe('#123456')
    expect(normalizeDrawingStyle({ color: '</style><script>' }, '#123456').color).toBe('#123456')
    expect(normalizeDrawingStyle({ color: '#ff0000' }).color).toBe('#ff0000')
    expect(normalizeDrawingStyle({ color: 'rgba(10, 20, 30, 0.5)' }).color).toBe('rgba(10, 20, 30, 0.5)')
  })

  it('begrenzt die Linienstärke', () => {
    expect(normalizeDrawingStyle({ width: 99 }).width).toBe(6)
    expect(normalizeDrawingStyle({ width: -3 }).width).toBe(0.5)
    expect(normalizeDrawingStyle({ width: Number.NaN }).width).toBe(1.5)
  })

  it('kürzt eine überlange Beschriftung, statt sie zu verwerfen', () => {
    expect(normalizeDrawingStyle({ label: 'x'.repeat(200) }).label).toHaveLength(80)
    expect(normalizeDrawingStyle({ label: '   ' }).label).toBeNull()
  })
})

describe('farbeGueltig', () => {
  it('erkennt Hex und rgba', () => {
    expect(farbeGueltig('#abc')).toBe(true)
    expect(farbeGueltig('#aabbccdd')).toBe(true)
    expect(farbeGueltig('rgb(1,2,3)')).toBe(true)
    expect(farbeGueltig('transparent')).toBe(true)
  })

  it('lehnt alles andere ab', () => {
    expect(farbeGueltig('red')).toBe(false)
    expect(farbeGueltig('')).toBe(false)
    expect(farbeGueltig(42)).toBe(false)
    expect(farbeGueltig(undefined)).toBe(false)
  })
})

describe('strichArray', () => {
  it('liefert nur bei gestrichelt ein Muster', () => {
    expect(strichArray(false)).toBeUndefined()
    expect(strichArray(true)).toBe('5 4')
  })
})
