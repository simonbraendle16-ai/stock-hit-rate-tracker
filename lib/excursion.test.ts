import { describe, expect, it } from 'vitest'
import {
  aggregateExcursion,
  computeExcursion,
  manualExcursionRun,
  resolveRun,
  MIN_EXCURSION_TRADES,
  type ExcursionEntry,
  type ExcursionInput,
  type ExcursionRun,
} from './excursion'
import type { Candle } from './market-data/types'

const HOUR = 3600

/** Kerze mit Hoch/Tief; Open/Close spielen für MAE/MFE keine Rolle. */
function candle(time: number, low: number, high: number): Candle {
  return { time, open: low, high, low, close: high, volume: 0 }
}

/** Long ab Stunde 1, Ausstieg Ende Stunde 3. Einstieg 100, Stop 90 → 1 R = 10. */
const longTrade: ExcursionInput = {
  direction: 'long',
  entryPrice: 100,
  riskDistance: 10,
  fromSec: 1 * HOUR,
  toSec: 3 * HOUR + 1800,
}

/** Stundenkerzen 0..4; die Kerze bei 0 liegt VOR dem Einstieg. */
const series = [
  candle(0 * HOUR, 70, 130), // vor dem Einstieg — darf nicht zählen
  candle(1 * HOUR, 95, 105),
  candle(2 * HOUR, 94, 112), // Tief −0,6 R, Hoch +1,2 R
  candle(3 * HOUR, 98, 108),
  candle(4 * HOUR, 60, 140), // nach dem Ausstieg — darf nicht zählen
]

const measured = (run: ExcursionRun) => {
  if (!run.measured) throw new Error(`nicht gemessen: ${run.reason}`)
  return run
}

describe('computeExcursion', () => {
  it('misst Gegen- und Mitlauf aus Tief und Hoch der Haltedauer', () => {
    const r = measured(computeExcursion(longTrade, series))
    expect(r.maeR).toBeCloseTo(-0.6) // 94 → 6 Punkte gegen, 6/10
    expect(r.mfeR).toBeCloseTo(1.2) // 112 → 12 Punkte für, 12/10
    expect(r.worstPrice).toBe(94)
    expect(r.bestPrice).toBe(112)
    expect(r.candlesUsed).toBe(3)
    expect(r.coarse).toBe(false)
  })

  it('lässt die angebrochene Einstiegskerze und alles nach dem Ausstieg draußen', () => {
    const r = measured(computeExcursion(longTrade, series))
    // Die Kerze bei 0 (Tief 70) und die bei 4 h (Tief 60) sind extremer als
    // alles im Fenster — sie dürfen die Zahl nicht anfassen.
    expect(r.worstPrice).toBe(94)
    expect(r.bestPrice).toBe(112)
  })

  it('dreht die Richtung bei Short-Positionen um', () => {
    const short: ExcursionInput = { ...longTrade, direction: 'short' }
    const r = measured(computeExcursion(short, series))
    // Für den Short ist das Hoch (112) der Gegenlauf und das Tief (94) der Mitlauf.
    expect(r.maeR).toBeCloseTo(-1.2)
    expect(r.mfeR).toBeCloseTo(0.6)
    expect(r.worstPrice).toBe(112)
    expect(r.bestPrice).toBe(94)
  })

  it('bleibt bei 0 R, wenn der Kurs die Position nie verlassen hat', () => {
    const flat = [candle(0, 100, 100), candle(1 * HOUR, 100, 100), candle(2 * HOUR, 100, 100)]
    const r = measured(computeExcursion({ ...longTrade, toSec: 2 * HOUR }, flat))
    expect(r.maeR).toBe(0)
    expect(r.mfeR).toBe(0)
  })

  it('kennzeichnet eine Messung als grob, wenn die Kerze länger ist als der Trade', () => {
    // 2-Stunden-Trade, aber nur Tageskerzen: das Extrem kann aus Zeit stammen,
    // in der gar keine Position offen war.
    const daily = [candle(0, 90, 130), candle(86_400, 80, 140), candle(2 * 86_400, 95, 105)]
    const intraday: ExcursionInput = {
      ...longTrade,
      fromSec: 86_400,
      toSec: 86_400 + 2 * HOUR,
    }
    const r = measured(computeExcursion(intraday, daily))
    expect(r.candlesUsed).toBe(1)
    expect(r.coarse).toBe(true)
  })

  it('weist fehlende Voraussetzungen mit Grund aus, statt zu raten', () => {
    expect(computeExcursion({ ...longTrade, riskDistance: 0 }, series)).toEqual({
      measured: false,
      reason: 'kein_risiko',
    })
    expect(computeExcursion({ ...longTrade, fromSec: 0 }, series)).toEqual({
      measured: false,
      reason: 'kein_zeitpunkt',
    })
    expect(computeExcursion(longTrade, [])).toEqual({
      measured: false,
      reason: 'keine_kerzen',
    })
    // Reihe beginnt erst nach dem Einstieg → die Kerze mit dem Extrem fehlt womöglich.
    expect(computeExcursion(longTrade, [candle(2 * HOUR, 95, 105)])).toEqual({
      measured: false,
      reason: 'historie_zu_kurz',
    })
  })
})

describe('manualExcursionRun', () => {
  it('rechnet eingetragene Kurse in R um', () => {
    const r = measured(manualExcursionRun(longTrade, { worstPrice: 93, bestPrice: 115 }))
    expect(r.maeR).toBeCloseTo(-0.7)
    expect(r.mfeR).toBeCloseTo(1.5)
    expect(r.coarse).toBe(false)
  })

  it('kappt in die falsche Richtung getippte Kurse auf 0, statt sie umzudeuten', () => {
    const r = measured(manualExcursionRun(longTrade, { worstPrice: 120, bestPrice: 80 }))
    expect(r.maeR).toBe(0)
    expect(r.mfeR).toBe(0)
  })

  it('behandelt eine fehlende Seite als „nicht gelaufen"', () => {
    const r = measured(manualExcursionRun(longTrade, { worstPrice: 95, bestPrice: null }))
    expect(r.maeR).toBeCloseTo(-0.5)
    expect(r.mfeR).toBe(0)
  })
})

describe('resolveRun — Messung schlägt Eingabe, außer die Messung ist grob', () => {
  const manual = { worstPrice: 80, bestPrice: 130 }
  // Eine einzige Kerze, die den ganzen Trade umspannt — messbar, aber grob.
  const grobSeries = [candle(1 * HOUR, 95, 105)]

  it('behält eine saubere Messung, auch wenn ein Nachtrag existiert', () => {
    const m = computeExcursion(longTrade, series)
    const { run, source } = resolveRun(longTrade, m, manual)
    expect(source).toBe('kurse')
    expect(measured(run).maeR).toBeCloseTo(-0.6)
  })

  it('lässt den Nachtrag eine grobe Messung überstimmen', () => {
    const grob = computeExcursion(longTrade, grobSeries)
    const { run, source } = resolveRun(longTrade, grob, manual)
    expect(source).toBe('nachgetragen')
    expect(measured(run).maeR).toBeCloseTo(-2)
  })

  it('füllt eine echte Lücke', () => {
    const { run, source } = resolveRun(longTrade, { measured: false, reason: 'keine_kerzen' }, manual)
    expect(source).toBe('nachgetragen')
    expect(run.measured).toBe(true)
  })

  it('lässt eine grobe Messung stehen, wenn nichts nachgetragen ist', () => {
    const grob = computeExcursion(longTrade, grobSeries)
    const { run, source } = resolveRun(longTrade, grob, null)
    expect(source).toBe('kurse')
    expect(measured(run).coarse).toBe(true)
  })
})

function entry(over: Partial<ExcursionEntry> = {}): ExcursionEntry {
  return {
    tradeId: 1,
    ticker: 'TEST',
    label: '01.01.26',
    realR: 1,
    won: true,
    run: { measured: true, maeR: -0.5, mfeR: 2, worstPrice: 95, bestPrice: 120, candlesUsed: 5, coarse: false },
    source: 'kurse',
    resolution: 'Stundenkerzen',
    manual: null,
    ...over,
  }
}

const many = (n: number, over: Partial<ExcursionEntry> = {}) =>
  Array.from({ length: n }, (_, i) => entry({ tradeId: i + 1, ...over }))

describe('aggregateExcursion', () => {
  it('trennt Gewinner und Verlierer und mittelt nur über messbare Trades', () => {
    const s = aggregateExcursion([
      ...many(2, { won: true }),
      ...many(3, { won: false, realR: -1 }),
      entry({ tradeId: 99, won: true, run: { measured: false, reason: 'keine_kerzen' } }),
    ])
    const [gewinner, verlierer, gesamt] = s.buckets
    expect(gewinner.trades).toBe(2) // der nicht messbare Gewinner zählt hier nicht
    expect(verlierer.trades).toBe(3)
    expect(gesamt.trades).toBe(5)
    expect(gewinner.avgExitR).toBeCloseTo(1)
    expect(verlierer.avgExitR).toBeCloseTo(-1)
    expect(s.coverage.decided).toBe(6)
    expect(s.coverage.measured).toBe(5)
  })

  it('zeigt unter der Mindestgröße keine Beobachtung', () => {
    const knapp = aggregateExcursion(many(MIN_EXCURSION_TRADES - 1))
    expect(knapp.buckets[0].enough).toBe(false)
    expect(knapp.observations).toEqual([])
  })

  it('beobachtet zu nahe Ziele, wenn die Gewinner deutlich weiter liefen', () => {
    // MFE +2 R, tatsächlicher Ausstieg +1 R → 1 R Luft.
    const s = aggregateExcursion(many(MIN_EXCURSION_TRADES))
    expect(s.buckets[0].enough).toBe(true)
    expect(s.observations).toContainEqual({ kind: 'ziele', gapR: expect.closeTo(1, 5) })
  })

  it('beobachtet enge Stops nur, wenn die Gewinner wirklich weit gegen dich liefen', () => {
    const eng = aggregateExcursion(
      many(MIN_EXCURSION_TRADES, {
        run: { measured: true, maeR: -0.9, mfeR: 1.2, worstPrice: 91, bestPrice: 112, candlesUsed: 4, coarse: false },
        realR: 1.2,
      }),
    )
    expect(eng.observations.map((o) => o.kind)).toContain('stops')

    const weit = aggregateExcursion(
      many(MIN_EXCURSION_TRADES, {
        run: { measured: true, maeR: -0.1, mfeR: 1.2, worstPrice: 99, bestPrice: 112, candlesUsed: 4, coarse: false },
        realR: 1.2,
      }),
    )
    expect(weit.observations.map((o) => o.kind)).not.toContain('stops')
  })

  it('zählt Lücken nach Grund und grobe Messungen getrennt', () => {
    const s = aggregateExcursion([
      entry({ tradeId: 1 }),
      entry({ tradeId: 2, run: { measured: true, maeR: -1, mfeR: 1, worstPrice: 90, bestPrice: 110, candlesUsed: 1, coarse: true } }),
      entry({ tradeId: 3, source: 'nachgetragen', resolution: null, manual: { worstPrice: 95, bestPrice: null } }),
      entry({ tradeId: 4, run: { measured: false, reason: 'nicht_abgerufen' } }),
      entry({ tradeId: 5, run: { measured: false, reason: 'nicht_abgerufen' } }),
      entry({ tradeId: 6, run: { measured: false, reason: 'kein_zeitpunkt' } }),
    ])
    expect(s.coverage.coarse).toBe(1)
    expect(s.coverage.manual).toBe(1)
    expect(s.coverage.gaps).toEqual([
      { reason: 'nicht_abgerufen', count: 2 },
      { reason: 'kein_zeitpunkt', count: 1 },
    ])
    expect(s.resolutions).toEqual(['Stundenkerzen'])
  })
})
