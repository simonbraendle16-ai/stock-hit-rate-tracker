import { describe, expect, it } from 'vitest'
import {
  MIN_TRAINING_BUCKET,
  MIN_TRAINING_RUNS,
  computeTrainingStats,
  type TrainingRunRow,
} from './training-stats'
import type { TrainingRating } from './training'

let laufendeId = 1

function run(over: Partial<TrainingRunRow> = {}): TrainingRunRow {
  return {
    id: laufendeId++,
    mode: 'frei',
    symbol: 'AAPL',
    timeframe: '1h',
    setupTags: [],
    rating: 'korrekt',
    errorTags: [],
    ratedAt: new Date('2026-08-01T10:00:00Z'),
    ...over,
  }
}

function viele(n: number, rating: TrainingRating, over: Partial<TrainingRunRow> = {}) {
  return Array.from({ length: n }, () => run({ rating, ...over }))
}

describe('computeTrainingStats', () => {
  it('zählt nur bewertete Übungen in die Quote', () => {
    const s = computeTrainingStats([
      ...viele(6, 'korrekt'),
      ...viele(4, 'falsch'),
      run({ rating: null }),
      run({ rating: null }),
    ])
    expect(s.total).toBe(12)
    expect(s.rated).toBe(10)
    expect(s.overall.quote).toBe(60)
  })

  it('zeigt unter der Schwelle keine Quote, aber die Anzahl', () => {
    const s = computeTrainingStats(viele(MIN_TRAINING_RUNS - 1, 'korrekt'))
    expect(s.overall.count).toBe(MIN_TRAINING_RUNS - 1)
    expect(s.overall.quote).toBeNull()
    expect(s.overall.teilQuote).toBeNull()
  })

  it('trennt korrekt, teilweise und falsch', () => {
    const s = computeTrainingStats([
      ...viele(5, 'korrekt'),
      ...viele(3, 'teilweise'),
      ...viele(2, 'falsch'),
    ])
    expect(s.overall).toMatchObject({ korrekt: 5, teilweise: 3, falsch: 2, count: 10 })
    expect(s.overall.quote).toBe(50)
    expect(s.overall.teilQuote).toBe(30)
  })

  it('schlüsselt nach Timeframe auf', () => {
    const s = computeTrainingStats([
      ...viele(MIN_TRAINING_BUCKET, 'korrekt', { timeframe: '15m' }),
      ...viele(2, 'falsch', { timeframe: 'T' }),
    ])
    const m15 = s.byTimeframe.find((r) => r.key === '15m')!
    const tag = s.byTimeframe.find((r) => r.key === 'T')!
    expect(m15.quote).toBe(100)
    expect(tag.count).toBe(2)
    expect(tag.quote).toBeNull()
  })

  it('faltet Setup-Schreibweisen zusammen und zählt Mehrfach-Tags in jede Zeile', () => {
    const s = computeTrainingStats([
      run({ setupTags: ['Breakout', 'Rücksetzer'] }),
      run({ setupTags: ['break-out'], rating: 'falsch' }),
      run({ setupTags: [] }),
    ])
    const breakout = s.bySetup.find((r) => r.key === 'breakout')!
    expect(breakout.count).toBe(2)
    expect(s.bySetup.find((r) => r.key === 'ruecksetzer')!.count).toBe(1)
    expect(s.ohneSetup).toBe(1)
  })

  it('rankt Fehler nach Häufigkeit und trennt die Elliott-Fehler ab', () => {
    const s = computeTrainingStats([
      run({ rating: 'falsch', errorTags: ['falsche_wellenzaehlung', 'stop_zu_eng'] }),
      run({ rating: 'falsch', errorTags: ['falsche_wellenzaehlung'] }),
      run({ rating: 'teilweise', errorTags: ['zu_frueher_einstieg'] }),
    ])
    expect(s.errors[0]).toMatchObject({ id: 'falsche_wellenzaehlung', count: 2 })
    expect(s.errors.map((e) => e.id)).not.toContain('kein_fehler')
    expect(s.elliottErrors.map((e) => e.id)).toEqual(['falsche_wellenzaehlung'])
    expect(s.errors[0].share).toBeCloseTo((2 / 3) * 100)
  })

  it('zählt ein Tag auch bei doppelter Nennung nur einmal', () => {
    const s = computeTrainingStats([
      run({ errorTags: ['stop_zu_eng', 'stop_zu_eng'] as never }),
    ])
    expect(s.errors.find((e) => e.id === 'stop_zu_eng')!.count).toBe(1)
  })

  it('sortiert den Verlauf nach Bewertungszeitpunkt und zählt die Serie', () => {
    const s = computeTrainingStats([
      run({ rating: 'falsch', ratedAt: new Date('2026-07-01T10:00:00Z') }),
      run({ rating: 'korrekt', ratedAt: new Date('2026-07-02T10:00:00Z') }),
      run({ rating: 'korrekt', ratedAt: new Date('2026-07-03T10:00:00Z') }),
    ])
    expect(s.timeline.map((t) => t.rating)).toEqual(['falsch', 'korrekt', 'korrekt'])
    expect(s.streak).toBe(2)
  })

  it('bleibt auf einer leeren Liste stabil', () => {
    const s = computeTrainingStats([])
    expect(s).toMatchObject({ total: 0, rated: 0, streak: 0, ohneSetup: 0 })
    expect(s.overall.quote).toBeNull()
    expect(s.errors).toEqual([])
    expect(s.bySetup).toEqual([])
  })
})
