import { describe, it, expect } from 'vitest'
import {
  retracement,
  validateFibInput,
  fibStats,
  filterFib,
  fibZone,
  fibCsv,
  type FibObservation,
} from './fibonacci'
const input = {
  stockId: 1,
  wave: 'B',
  degree: 'Minor',
  timeframe: '1d',
  observedOn: '2026-01-01',
  status: 'abgeschlossen',
  percent: 61.8,
  anchorStart: null,
  anchorEnd: null,
  extreme: null,
  note: 'Synthetic measurement',
}
const row = (
  percent: number,
  extra: Partial<FibObservation> = {},
): FibObservation => ({
  ...input,
  status: 'abgeschlossen',
  id: crypto.randomUUID(),
  version: 1,
  ticker: 'TEST',
  name: 'Synthetic',
  market: 'aktien',
  percent,
  ...extra,
})
describe('Fibonacci measurement and descriptive statistics', () => {
  it('measures both directions, zero, full correction and overflow', () => {
    expect(retracement(100, 200, 138.2)).toBeCloseTo(61.8)
    expect(retracement(200, 100, 161.8)).toBeCloseTo(61.8)
    expect(retracement(100, 200, 200)).toBe(0)
    expect(retracement(100, 200, 100)).toBe(100)
    expect(retracement(100, 200, 50)).toBe(150)
  })
  it('rejects zero-length, non-finite, negative depths, invalid prices and out of range', () => {
    for (const args of [
      [100, 100, 100],
      [0, 100, 50],
      [100, 200, 201],
      [100, 200, NaN],
      [100, 101, 1],
    ] as const)
      expect(() => retracement(args[0], args[1], args[2])).toThrow()
  })
  it('validates anchored input and rejects contradictory or incomplete values', () => {
    expect(
      validateFibInput({
        ...input,
        percent: null,
        anchorStart: 100,
        anchorEnd: 200,
        extreme: 150,
      }).percent,
    ).toBe(50)
    expect(() =>
      validateFibInput({
        ...input,
        anchorStart: 100,
        anchorEnd: 200,
        extreme: 150,
      }),
    ).toThrow(/widerspricht/)
    expect(() => validateFibInput({ ...input, anchorStart: 100 })).toThrow()
  })
  it('rejects malformed fields, impossible dates, missing provenance, strings and infinity', () => {
    for (const patch of [
      { percent: '61.8' },
      { percent: Infinity },
      { percent: -1 },
      { percent: 501 },
      { observedOn: '2026-02-30' },
      { observedOn: '2999-01-01' },
      { note: ' ' },
      { wave: '5' },
      { degree: 'free' },
      { timeframe: 'anything' },
      { stockId: 0 },
      { other: 'ignored' },
    ])
      expect(() => validateFibInput({ ...input, ...patch })).toThrow()
  })
  it('computes interpolated quartiles and unrounded mean', () => {
    const s = fibStats([row(20), row(40), row(80), row(100)])
    expect(s.n).toBe(4)
    expect(s.mean).toBe(60)
    expect(s.median).toBe(60)
    expect(s.q1).toBe(35)
    expect(s.q3).toBe(85)
  })
  it('keeps running and invalid measurements out of all statistical denominators', () => {
    const s = fibStats([
      row(50),
      row(100, { status: 'laufend' }),
      row(0, { status: 'ungueltig' }),
    ])
    expect(s.n).toBe(1)
    expect(s.mean).toBe(50)
    expect(s.running).toBe(1)
    expect(s.invalid).toBe(1)
    expect(s.zones.find((z) => z.level === 61.8)?.reached).toBe(0)
  })
  it('distinguishes exclusive end zones from cumulative thresholds', () => {
    const s = fibStats([row(61.8), row(100)])
    expect(s.zones.reduce((sum, z) => sum + z.count, 0)).toBe(2)
    expect(s.zones.find((z) => z.level === 61.8)?.reached).toBe(2)
    expect(s.zones.find((z) => z.level === 78.6)?.reached).toBe(1)
    expect(s.modes).toEqual([61.8, 100])
  })
  it('uses higher zone at an exact midpoint and retains >100 depths', () => {
    expect(fibZone((50 + 61.8) / 2)).toBe(4)
    expect(fibStats([row(500)]).modes).toEqual([423.6])
  })
  it('has honest empty and small sample states', () => {
    const s = fibStats([])
    expect(s.mean).toBeNull()
    expect(s.median).toBeNull()
    expect(s.modes).toEqual([])
    expect(s.exploratory).toBe(true)
    expect(
      fibStats(Array.from({ length: 10 }, () => row(50))).exploratory,
    ).toBe(false)
  })
  it('applies every dimension together and inclusive dates', () => {
    const rows = [
      row(50),
      row(70, { market: 'krypto', stockId: 2 }),
      row(80, { wave: '4' }),
      row(90, { degree: 'Primär' }),
      row(100, { timeframe: '1w' }),
    ]
    expect(
      filterFib(rows, {
        stockId: 1,
        market: 'aktien',
        wave: 'B',
        degree: 'Minor',
        timeframe: '1d',
        from: '2026-01-01',
        to: '2026-01-01',
      }),
    ).toHaveLength(1)
    expect(filterFib(rows, { market: 'krypto' })).toHaveLength(1)
    expect(filterFib(rows, { from: '2026-01-02' })).toHaveLength(0)
  })
  it('exports exact depths, quotes and prevents spreadsheet formula execution', () => {
    const csv = fibCsv([row(61.81234, { note: '=SUM(1) "quoted"\nline' })])
    expect(csv).toContain('61.81234')
    expect(csv).toContain("'=SUM(1)")
    expect(csv).toContain('""quoted""')
  })
})
