import { describe, expect, it } from 'vitest'
import {
  entryDistance,
  entrySortKey,
  nearestEntryByStock,
  type PlannedEntry,
} from './entry-distance'

describe('entryDistance', () => {
  it('rechnet den Abstand in Prozent des Einstiegs', () => {
    const d = entryDistance(102, 100, 'long')
    expect(d?.pct).toBeCloseTo(2, 10)
    expect(d?.absPct).toBeCloseTo(2, 10)
  })

  it('behält das Vorzeichen: unter dem Einstieg ist negativ', () => {
    const d = entryDistance(98, 100, 'long')
    expect(d?.pct).toBeCloseTo(-2, 10)
    expect(d?.absPct).toBeCloseTo(2, 10)
  })

  it('meldet einen Long als erreicht, sobald der Kurs auf den Einstieg fällt', () => {
    expect(entryDistance(101, 100, 'long')?.reached).toBe(false)
    expect(entryDistance(100, 100, 'long')?.reached).toBe(true)
    expect(entryDistance(99, 100, 'long')?.reached).toBe(true)
  })

  it('dreht die Bedingung bei Short um', () => {
    expect(entryDistance(99, 100, 'short')?.reached).toBe(false)
    expect(entryDistance(100, 100, 'short')?.reached).toBe(true)
    expect(entryDistance(101, 100, 'short')?.reached).toBe(true)
  })

  it('gibt null zurück, statt eine Zahl zu erfinden', () => {
    expect(entryDistance(null, 100, 'long')).toBeNull()
    expect(entryDistance(100, null, 'long')).toBeNull()
    expect(entryDistance(100, 0, 'long')).toBeNull()
    expect(entryDistance(Number.NaN, 100, 'long')).toBeNull()
    expect(entryDistance(100, Number.POSITIVE_INFINITY, 'long')).toBeNull()
  })

  it('verträgt sehr kleine Kurse (Krypto-Altcoins)', () => {
    const d = entryDistance(0.000021, 0.00002, 'long')
    expect(d?.pct).toBeCloseTo(5, 6)
  })
})

describe('nearestEntryByStock', () => {
  const quotes = { 1: { price: 100 }, 2: { price: 50 } }

  function trade(over: Partial<PlannedEntry> = {}): PlannedEntry {
    return { stockId: 1, status: 'geplant', direction: 'long', entryPrice: 95, ...over }
  }

  it('nimmt je Instrument den nächstliegenden Einstieg', () => {
    const map = nearestEntryByStock(
      [trade({ entryPrice: 90 }), trade({ entryPrice: 98 }), trade({ entryPrice: 80 })],
      quotes,
    )
    expect(map.get(1)?.entryPrice).toBe(98)
  })

  it('beachtet nur GEPLANTE Trades', () => {
    const map = nearestEntryByStock(
      [trade({ status: 'aktiv' }), trade({ status: 'abgeschlossen' })],
      quotes,
    )
    expect(map.size).toBe(0)
  })

  it('überspringt Trades ohne Instrument und ohne Kurs', () => {
    const map = nearestEntryByStock(
      [trade({ stockId: null }), trade({ stockId: 99 })],
      quotes,
    )
    expect(map.size).toBe(0)
  })

  it('hält mehrere Instrumente auseinander', () => {
    const map = nearestEntryByStock(
      [trade({ stockId: 1, entryPrice: 95 }), trade({ stockId: 2, entryPrice: 48 })],
      quotes,
    )
    expect(map.get(1)?.entryPrice).toBe(95)
    expect(map.get(2)?.entryPrice).toBe(48)
  })
})

describe('entrySortKey', () => {
  it('stellt erreichte Einstiege ganz nach oben', () => {
    const erreicht = entryDistance(99, 100, 'long')!
    const nah = entryDistance(101, 100, 'long')!
    expect(entrySortKey(erreicht)).toBeLessThan(entrySortKey(nah))
  })

  it('ordnet nahe vor ferne', () => {
    const nah = entryDistance(101, 100, 'long')!
    const fern = entryDistance(120, 100, 'long')!
    expect(entrySortKey(nah)).toBeLessThan(entrySortKey(fern))
  })

  it('schiebt Instrumente ohne Plan ans Ende, ohne sie zu entfernen', () => {
    const fern = entryDistance(200, 100, 'long')!
    expect(entrySortKey(undefined)).toBeGreaterThan(entrySortKey(fern))
    expect(Number.isFinite(entrySortKey(undefined))).toBe(false)
  })
})
