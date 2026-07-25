import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HORIZON,
  MIN_TRADES,
  mulberry32,
  percentile,
  simulateFuture,
} from './monte-carlo'

/** `count` Trades mit immer demselben R-Vielfachen. */
function repeat(value: number, count: number): number[] {
  return Array.from({ length: count }, () => value)
}

/** Münzwurf-Verteilung: halb +1 R, halb −1 R (Verlustanteil exakt 50 %). */
function coinFlip(count = 20): number[] {
  return [...repeat(1, count / 2), ...repeat(-1, count / 2)]
}

/**
 * Exakte Wahrscheinlichkeit, dass in `n` unabhängigen Trades mindestens eine
 * Verlustserie der Länge `k` vorkommt (Verlustwahrscheinlichkeit `q`).
 *
 * Geschlossene Gegenrechnung zur Simulation: Zustand = Länge der aktuellen
 * Verluststrecke, alles ab `k` ist absorbierend.
 */
function exactRunProbability(n: number, q: number, k: number): number {
  let dp = new Array<number>(k).fill(0)
  dp[0] = 1
  for (let step = 0; step < n; step++) {
    const next = new Array<number>(k).fill(0)
    for (let j = 0; j < k; j++) {
      if (dp[j] === 0) continue
      next[0] += dp[j] * (1 - q)
      if (j + 1 < k) next[j + 1] += dp[j] * q
      // j + 1 === k → Serie erreicht, fällt aus dem Zustandsraum (absorbierend)
    }
    dp = next
  }
  return 1 - dp.reduce((acc, v) => acc + v, 0)
}

describe('mulberry32', () => {
  it('liefert bei gleichem Seed dieselbe Folge', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('liefert bei anderem Seed eine andere Folge', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    expect(a()).not.toBe(b())
  })

  it('bleibt im Intervall [0, 1)', () => {
    const rand = mulberry32(7)
    for (let i = 0; i < 5000; i++) {
      const v = rand()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('streut gleichmäßig über die Ziehungsindizes', () => {
    // Ohne Gleichverteilung wäre jede Bootstrap-Ziehung verzerrt.
    const rand = mulberry32(99)
    const buckets = new Array<number>(10).fill(0)
    const draws = 100_000
    for (let i = 0; i < draws; i++) buckets[Math.floor(rand() * 10)]++
    for (const b of buckets) {
      expect(Math.abs(b - draws / 10) / (draws / 10)).toBeLessThan(0.05)
    }
  })
})

describe('percentile', () => {
  it('greift auf Rändern und Mitte richtig zu', () => {
    const xs = [0, 1, 2, 3, 4]
    expect(percentile(xs, 0)).toBe(0)
    expect(percentile(xs, 1)).toBe(4)
    expect(percentile(xs, 0.5)).toBe(2)
  })

  it('interpoliert zwischen zwei Werten', () => {
    expect(percentile([0, 10], 0.5)).toBe(5)
    expect(percentile([0, 10], 0.25)).toBe(2.5)
  })

  it('verkraftet leere und einelementige Felder', () => {
    expect(percentile([], 0.5)).toBe(0)
    expect(percentile([3], 0.9)).toBe(3)
  })
})

describe('simulateFuture — zu wenige Daten', () => {
  it('simuliert nicht unter der Mindestzahl, beschreibt die Stichprobe aber trotzdem', () => {
    const stats = simulateFuture({ rMultiples: repeat(1, MIN_TRADES - 1) })
    expect(stats.enough).toBe(false)
    expect(stats.minTrades).toBe(MIN_TRADES)
    expect(stats.source.trades).toBe(MIN_TRADES - 1)
    expect(stats.source.expectancy).toBe(1)
    expect(stats.outcome.median).toBe(0)
    expect(stats.drawdownPct).toBeNull()
  })

  it('leere Eingabe ergibt keine NaN-Werte', () => {
    const stats = simulateFuture({ rMultiples: [] })
    expect(stats.enough).toBe(false)
    expect(stats.source).toEqual({ trades: 0, winRate: 0, expectancy: 0, bestR: 0, worstR: 0 })
    expect(Number.isNaN(stats.outcome.mean)).toBe(false)
  })

  it('verwirft nicht-endliche Werte, statt sie durchzurechnen', () => {
    const withJunk = [...repeat(1, MIN_TRADES), NaN, Infinity]
    const clean = simulateFuture({ rMultiples: withJunk, runs: 200 })
    expect(clean.source.trades).toBe(MIN_TRADES)
    expect(Number.isFinite(clean.outcome.median)).toBe(true)

    // Fallen dadurch zu viele Werte weg, wird ehrlich nicht simuliert.
    const tooFew = simulateFuture({ rMultiples: [...repeat(1, MIN_TRADES - 1), NaN] })
    expect(tooFew.enough).toBe(false)
  })
})

describe('simulateFuture — Determinismus', () => {
  it('gleiche Eingabe und gleicher Seed ergeben exakt dasselbe Ergebnis', () => {
    const input = { rMultiples: coinFlip(), runs: 2000 }
    expect(simulateFuture(input)).toEqual(simulateFuture(input))
  })

  it('ein anderer Seed ergibt ein anderes, aber ähnliches Ergebnis', () => {
    const rs = [...repeat(2, 8), ...repeat(-1, 12)]
    const a = simulateFuture({ rMultiples: rs, runs: 5000, seed: 1 })
    const b = simulateFuture({ rMultiples: rs, runs: 5000, seed: 2 })
    expect(a.outcome.mean).not.toBe(b.outcome.mean)
    // Zwei Läufe derselben Verteilung dürfen sich nur im Rauschen unterscheiden.
    expect(Math.abs(a.outcome.mean - b.outcome.mean)).toBeLessThan(0.5)
    expect(Math.abs(a.outcome.probProfit - b.outcome.probProfit)).toBeLessThan(3)
  })
})

describe('simulateFuture — analytisch nachrechenbare Randfälle', () => {
  it('nur Gewinner: kein Rückgang, keine Verlustserie, Endstand = Horizont × R', () => {
    const stats = simulateFuture({ rMultiples: repeat(2, MIN_TRADES), runs: 500, horizon: 50 })
    expect(stats.enough).toBe(true)
    expect(stats.outcome.median).toBe(100)
    expect(stats.outcome.p05).toBe(100)
    expect(stats.outcome.probProfit).toBe(100)
    expect(stats.drawdown.worst).toBe(0)
    expect(stats.lossStreak.typical).toBe(0)
    expect(stats.lossStreak.odds).toEqual([])
  })

  it('nur Verlierer: jeder Verlauf ist eine durchgehende Serie', () => {
    const stats = simulateFuture({ rMultiples: repeat(-1, MIN_TRADES), runs: 500, horizon: 20 })
    expect(stats.outcome.median).toBe(-20)
    expect(stats.outcome.probProfit).toBe(0)
    expect(stats.drawdown.median).toBe(20)
    expect(stats.lossStreak.typical).toBe(20)
    expect(stats.lossStreak.odds[0]).toEqual({ length: 1, probability: 100 })
  })

  it('trifft die exakte Verlustserien-Wahrscheinlichkeit eines fairen Münzwurfs', () => {
    const horizon = 50
    const stats = simulateFuture({ rMultiples: coinFlip(), runs: 10_000, horizon })

    for (const row of stats.lossStreak.odds) {
      const exact = exactRunProbability(horizon, 0.5, row.length) * 100
      // 10.000 Verläufe → Standardfehler unter 0,5 Prozentpunkten.
      expect(Math.abs(row.probability - exact)).toBeLessThan(2)
    }
    // Die Tabelle muss die interessanten Längen überhaupt enthalten.
    expect(stats.lossStreak.odds.map((o) => o.length)).toContain(6)
  })

  it('trifft die exakte Wahrscheinlichkeit auch bei schiefer Verteilung', () => {
    // 25 % Treffer à +3 R, 75 % Verluste à −1 R (Erwartungswert 0).
    const rs = [...repeat(3, 5), ...repeat(-1, 15)]
    const horizon = 40
    const stats = simulateFuture({ rMultiples: rs, runs: 10_000, horizon, seed: 4242 })

    for (const row of stats.lossStreak.odds) {
      const exact = exactRunProbability(horizon, 0.75, row.length) * 100
      expect(Math.abs(row.probability - exact)).toBeLessThan(2)
    }
    expect(Math.abs(stats.outcome.mean)).toBeLessThan(1.5) // Erwartungswert 0 je Trade
  })

  it('Perzentile sind monoton und der Median folgt dem Erwartungswert', () => {
    const rs = [...repeat(2, 8), ...repeat(-1, 12)] // Erwartungswert +0,2 R je Trade
    const stats = simulateFuture({ rMultiples: rs, runs: 10_000, horizon: DEFAULT_HORIZON })

    expect(stats.outcome.p05).toBeLessThanOrEqual(stats.outcome.p25)
    expect(stats.outcome.p25).toBeLessThanOrEqual(stats.outcome.median)
    expect(stats.outcome.median).toBeLessThanOrEqual(stats.outcome.p75)
    expect(stats.outcome.p75).toBeLessThanOrEqual(stats.outcome.p95)
    expect(stats.drawdown.median).toBeLessThanOrEqual(stats.drawdown.p90)
    expect(stats.drawdown.p90).toBeLessThanOrEqual(stats.drawdown.p95)
    expect(stats.drawdown.p95).toBeLessThanOrEqual(stats.drawdown.worst)

    // Ø 0,2 R × 50 Trades = 10 R
    expect(Math.abs(stats.outcome.mean - 10)).toBeLessThan(0.5)
    expect(stats.source.expectancy).toBeCloseTo(0.2, 10)
    expect(stats.source.winRate).toBe(40)
    expect(stats.source.bestR).toBe(2)
    expect(stats.source.worstR).toBe(-1)
  })
})

describe('simulateFuture — Rückgang in Prozent', () => {
  const rs = [...repeat(2, 8), ...repeat(-1, 12)]

  it('rechnet R in Kontoprozent um, wenn der Risikoanteil bekannt ist', () => {
    const stats = simulateFuture({ rMultiples: rs, riskFraction: 0.01, runs: 5000 })
    expect(stats.drawdownPct).not.toBeNull()
    expect(stats.drawdownPct!.riskPerTradePct).toBe(1)
    // 1 % Risiko je Trade → 1 R Rückgang = 1 % Konto
    expect(stats.drawdownPct!.median).toBeCloseTo(stats.drawdown.median, 10)
    expect(stats.drawdownPct!.p95).toBeCloseTo(stats.drawdown.p95, 10)
  })

  it('doppeltes Risiko je Trade verdoppelt den Rückgang in Prozent', () => {
    const einfach = simulateFuture({ rMultiples: rs, riskFraction: 0.01, runs: 5000 })
    const doppelt = simulateFuture({ rMultiples: rs, riskFraction: 0.02, runs: 5000 })
    expect(doppelt.drawdownPct!.median).toBeCloseTo(einfach.drawdownPct!.median * 2, 10)
    expect(doppelt.drawdownPct!.probabilityOverThreshold).toBeGreaterThanOrEqual(
      einfach.drawdownPct!.probabilityOverThreshold,
    )
  })

  it('ohne belastbaren Risikoanteil bleibt die Prozentangabe weg', () => {
    for (const riskFraction of [null, undefined, 0, -0.5, NaN]) {
      expect(simulateFuture({ rMultiples: rs, riskFraction, runs: 200 }).drawdownPct).toBeNull()
    }
  })

  it('die Schwelle ist einstellbar und eine höhere Schwelle wird seltener gerissen', () => {
    const zwanzig = simulateFuture({ rMultiples: rs, riskFraction: 0.01, runs: 5000 })
    const vierzig = simulateFuture({
      rMultiples: rs,
      riskFraction: 0.01,
      runs: 5000,
      drawdownThresholdPct: 40,
    })
    expect(vierzig.drawdownPct!.thresholdPct).toBe(40)
    expect(vierzig.drawdownPct!.probabilityOverThreshold).toBeLessThanOrEqual(
      zwanzig.drawdownPct!.probabilityOverThreshold,
    )
  })
})

describe('simulateFuture — erlebte Verlustserie einordnen', () => {
  const rs = coinFlip()

  it('nimmt die erlebte Serie in die Tabelle auf, auch wenn sie selten ist', () => {
    const stats = simulateFuture({ rMultiples: rs, observedLossStreak: 12, runs: 5000 })
    const row = stats.lossStreak.odds.find((o) => o.length === 12)
    expect(row).toBeDefined()
    expect(stats.lossStreak.observed).toBe(12)
    expect(stats.lossStreak.observedProbability).toBeCloseTo(row!.probability, 10)
    // Tabelle bleibt aufsteigend sortiert
    const lengths = stats.lossStreak.odds.map((o) => o.length)
    expect([...lengths].sort((a, b) => a - b)).toEqual(lengths)
  })

  it('lässt praktisch sichere Längen weg — „100 %" ist keine Information', () => {
    const stats = simulateFuture({ rMultiples: rs, runs: 10_000, horizon: 50 })
    expect(stats.lossStreak.odds.length).toBeGreaterThanOrEqual(4)
    // Erste Zeile ist die erste, die überhaupt eine Aussage trägt.
    expect(stats.lossStreak.odds[0].probability).toBeLessThan(99.5)
    // Die informativen Längen sind dadurch überhaupt in der Tabelle.
    const lengths = stats.lossStreak.odds.map((o) => o.length)
    expect(lengths).toContain(7)
    expect(lengths).toContain(9)
  })

  it('schneidet bei entarteten Verteilungen nichts ab, statt leer zu bleiben', () => {
    // Nur Verlierer: JEDE Länge kommt in 100 % der Verläufe vor.
    const stats = simulateFuture({ rMultiples: repeat(-1, MIN_TRADES), runs: 500, horizon: 8 })
    expect(stats.lossStreak.odds.length).toBeGreaterThan(0)
    expect(stats.lossStreak.odds[0]).toEqual({ length: 1, probability: 100 })
  })

  it('eine längere Serie ist nie wahrscheinlicher als eine kürzere', () => {
    const stats = simulateFuture({ rMultiples: rs, runs: 5000 })
    for (let i = 1; i < stats.lossStreak.odds.length; i++) {
      expect(stats.lossStreak.odds[i].probability).toBeLessThanOrEqual(
        stats.lossStreak.odds[i - 1].probability,
      )
    }
  })

  it('ohne erlebte Serie gibt es keine Einordnung statt einer 0-Aussage', () => {
    expect(simulateFuture({ rMultiples: rs, runs: 500 }).lossStreak.observedProbability).toBeNull()
  })

  it('eine Serie jenseits des Horizonts ist unmöglich, nicht „selten"', () => {
    const stats = simulateFuture({ rMultiples: rs, runs: 500, horizon: 10, observedLossStreak: 11 })
    expect(stats.lossStreak.observedProbability).toBe(0)
  })
})
