// Monte-Carlo-Simulation über die eigene R-Verteilung (Etappe 7a).
//
// Douglas in Reinform: Eine Verlustserie ist kein Beweis, dass „das System kaputt"
// ist — sie gehört zur Wahrscheinlichkeitsverteilung. Genau das rechnet diese
// Datei aus: aus den bereits abgeschlossenen Trades werden die nächsten Trades
// tausendfach neu gezogen, damit sichtbar wird, welche Verläufe zu den eigenen
// Zahlen schlicht dazugehören.
//
// Bewusst OHNE 'use server', ohne DB-Zugriff, ohne React: reine Funktionen mit
// festem Zufalls-Seed, dadurch deterministisch und direkt testbar
// (`lib/monte-carlo.test.ts`). Die Server Action lädt nur die Zeilen und ruft
// hier hinein — keine zweite Rechenlogik daneben.
//
// Verfahren: **Bootstrap**. Jeder simulierte Trade ist ein zufällig gezogenes
// R-Vielfaches aus dem eigenen Bestand (mit Zurücklegen). Das unterstellt keine
// Normalverteilung und behält die tatsächliche Form der Verteilung inklusive
// Ausreißern — es unterstellt aber, dass die Trades unabhängig voneinander sind
// und aus derselben Verteilung stammen. Beides ist eine Annahme, keine Tatsache;
// die UI muss das sagen.

/** Ab so vielen abgerechneten Trades wird überhaupt simuliert. Darunter wäre die
 *  Verteilung reines Rauschen — lieber „zu wenige Daten" als Scheinpräzision. */
export const MIN_TRADES = 20
/** Wie weit in die Zukunft simuliert wird (Anzahl Trades). */
export const DEFAULT_HORIZON = 50
/** Anzahl simulierter Verläufe. */
export const DEFAULT_RUNS = 10_000
/** Fester Seed: gleiche Eingabe → gleiches Ergebnis (Server und Test). */
export const DEFAULT_SEED = 0x5eed1
/** Ab diesem Rückgang vom Hoch wird die Wahrscheinlichkeit ausgewiesen. */
export const DEFAULT_DRAWDOWN_THRESHOLD_PCT = 20

/** Höchstens so viele Zeilen in der Verlustserien-Tabelle. */
const MAX_STREAK_ROWS = 10
/** Serien, die in weniger als 1 % der Verläufe vorkommen, sind keine Zeile wert. */
const STREAK_CUTOFF = 0.01
/** Serien, die praktisch sicher vorkommen, ebenfalls nicht — „100 %" ist keine Information. */
const STREAK_CEILING = 0.995
/** So viele Zeilen müssen übrig bleiben, sonst wird nichts abgeschnitten. */
const MIN_STREAK_ROWS = 4

export type MonteCarloInput = {
  /** R-Vielfache der entschiedenen, abgerechneten Trades. Reihenfolge egal. */
  rMultiples: number[]
  /**
   * Ø Risiko je Trade als Anteil des eingesetzten Kapitals (0–1) — nur damit
   * lässt sich ein Drawdown in R in einen Prozentsatz des Kontos übersetzen.
   * `null`, wenn es sich nicht ehrlich bestimmen lässt (z. B. reine Demotrades).
   */
  riskFraction?: number | null
  /** Längste tatsächlich erlebte Verlust-Serie — für die Einordnung „ist das normal?". */
  observedLossStreak?: number
  horizon?: number
  runs?: number
  seed?: number
  drawdownThresholdPct?: number
}

/** Kennzahlen der Eingangsverteilung — damit sichtbar ist, worauf die Simulation steht. */
export type MonteCarloSource = {
  /** Anzahl Trades in der Verteilung. */
  trades: number
  /** Anteil Trades mit positivem R, 0–100. */
  winRate: number
  /** Ø R-Vielfaches (Erwartungswert je Trade). */
  expectancy: number
  bestR: number
  worstR: number
}

/** Endergebnis nach `horizon` Trades, in R. */
export type MonteCarloOutcome = {
  p05: number
  p25: number
  median: number
  p75: number
  p95: number
  mean: number
  /** Anteil Verläufe, die im Plus enden, 0–100. */
  probProfit: number
}

/** Größter Rückgang vom Hoch innerhalb eines Verlaufs, in R (immer >= 0). */
export type MonteCarloDrawdown = {
  median: number
  p90: number
  p95: number
  worst: number
}

/** Dieselben Rückgänge in Prozent des Kontos — nur bei bekanntem Risikoanteil. */
export type MonteCarloDrawdownPct = {
  /** Der unterstellte Risikoanteil je Trade in Prozent (Basis der Umrechnung). */
  riskPerTradePct: number
  thresholdPct: number
  /** Anteil Verläufe mit einem Rückgang über der Schwelle, 0–100. */
  probabilityOverThreshold: number
  median: number
  p95: number
}

/** Wahrscheinlichkeit, dass im Horizont eine Verlustserie von mindestens `length` vorkommt. */
export type LossStreakOdds = {
  length: number
  /** 0–100. */
  probability: number
}

export type MonteCarloLossStreak = {
  /** Median der längsten Serie je Verlauf — die „normale" Serie. */
  typical: number
  /** Die längste tatsächlich erlebte Serie (aus dem Journal, nicht simuliert). */
  observed: number
  /** Anteil Verläufe mit einer mindestens so langen Serie wie `observed`, 0–100.
   *  `null`, wenn es noch keine erlebte Serie gibt. */
  observedProbability: number | null
  /**
   * Tabelle P(Serie >= k) für aufsteigendes k. Praktisch sichere und praktisch
   * unmögliche Längen fallen weg — sie sind keine Information. Die tatsächlich
   * erlebte Serie steht immer drin, auch wenn sie selten ist.
   */
  odds: LossStreakOdds[]
}

export type MonteCarloStats = {
  /** Erst ab `minTrades` abgerechneten Trades wird simuliert. */
  enough: boolean
  minTrades: number
  horizon: number
  runs: number
  source: MonteCarloSource
  outcome: MonteCarloOutcome
  drawdown: MonteCarloDrawdown
  drawdownPct: MonteCarloDrawdownPct | null
  lossStreak: MonteCarloLossStreak
}

// ---------------------------------------------------------------------------
// Zufall — bewusst selbstgebaut und seed-fest
// ---------------------------------------------------------------------------

/**
 * mulberry32: kleiner, schneller PRNG mit 32-Bit-Zustand. `Math.random()` wäre
 * hier falsch — dieselbe Seite würde bei jedem Aufruf andere Zahlen zeigen, und
 * ein Test könnte nichts festnageln.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Perzentil aus einem AUFSTEIGEND sortierten Feld, linear interpoliert (p in 0–1). */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const idx = (sorted.length - 1) * Math.min(1, Math.max(0, p))
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function describeSample(rs: number[]): MonteCarloSource {
  const trades = rs.length
  if (trades === 0) {
    return { trades: 0, winRate: 0, expectancy: 0, bestR: 0, worstR: 0 }
  }
  const wins = rs.filter((r) => r > 0).length
  const sum = rs.reduce((acc, r) => acc + r, 0)
  return {
    trades,
    winRate: (wins / trades) * 100,
    expectancy: sum / trades,
    bestR: Math.max(...rs),
    worstR: Math.min(...rs),
  }
}

function emptyStats(
  source: MonteCarloSource,
  horizon: number,
  runs: number,
  observedLossStreak: number,
): MonteCarloStats {
  return {
    enough: false,
    minTrades: MIN_TRADES,
    horizon,
    runs,
    source,
    outcome: { p05: 0, p25: 0, median: 0, p75: 0, p95: 0, mean: 0, probProfit: 0 },
    drawdown: { median: 0, p90: 0, p95: 0, worst: 0 },
    drawdownPct: null,
    lossStreak: { typical: 0, observed: observedLossStreak, observedProbability: null, odds: [] },
  }
}

/**
 * Simuliert `runs` mögliche Verläufe über `horizon` Trades, indem aus den
 * eigenen R-Vielfachen mit Zurücklegen gezogen wird.
 *
 * Ergebnis je Verlauf: Endstand in R, größter Rückgang vom Hoch in R und die
 * längste Verlustserie. Aus diesen drei Feldern entstehen alle ausgewiesenen
 * Wahrscheinlichkeiten — es wird nichts geglättet und keine Verteilung
 * unterstellt.
 *
 * Nicht-endliche Eingabewerte werden verworfen (sie kämen aus kaputten Zeilen
 * und würden jede Kennzahl zu `NaN` machen).
 */
export function simulateFuture(input: MonteCarloInput): MonteCarloStats {
  const horizon = Math.max(1, Math.floor(input.horizon ?? DEFAULT_HORIZON))
  const runs = Math.max(1, Math.floor(input.runs ?? DEFAULT_RUNS))
  const seed = input.seed ?? DEFAULT_SEED
  const thresholdPct = input.drawdownThresholdPct ?? DEFAULT_DRAWDOWN_THRESHOLD_PCT
  const observed = Math.max(0, Math.floor(input.observedLossStreak ?? 0))

  const rs = input.rMultiples.filter((r) => Number.isFinite(r))
  const source = describeSample(rs)
  if (rs.length < MIN_TRADES) return emptyStats(source, horizon, runs, observed)

  const rand = mulberry32(seed)
  const n = rs.length

  const finals = new Float64Array(runs)
  const drawdowns = new Float64Array(runs)
  // Längste Verlustserie je Verlauf — als Histogramm, der Index ist die Länge.
  const streakCounts = new Array<number>(horizon + 1).fill(0)

  for (let run = 0; run < runs; run++) {
    let cum = 0
    let peak = 0
    let maxDrawdown = 0
    let streak = 0
    let maxStreak = 0

    for (let i = 0; i < horizon; i++) {
      const r = rs[Math.floor(rand() * n) % n]
      cum += r
      if (cum > peak) peak = cum
      const dd = peak - cum
      if (dd > maxDrawdown) maxDrawdown = dd
      if (r < 0) {
        streak++
        if (streak > maxStreak) maxStreak = streak
      } else {
        streak = 0
      }
    }

    finals[run] = cum
    drawdowns[run] = maxDrawdown
    streakCounts[maxStreak]++
  }

  const sortedFinals = Array.from(finals).sort((a, b) => a - b)
  const sortedDd = Array.from(drawdowns).sort((a, b) => a - b)

  let profitable = 0
  for (const v of finals) if (v > 0) profitable++
  let sum = 0
  for (const v of finals) sum += v

  const outcome: MonteCarloOutcome = {
    p05: percentile(sortedFinals, 0.05),
    p25: percentile(sortedFinals, 0.25),
    median: percentile(sortedFinals, 0.5),
    p75: percentile(sortedFinals, 0.75),
    p95: percentile(sortedFinals, 0.95),
    mean: sum / runs,
    probProfit: (profitable / runs) * 100,
  }

  const drawdown: MonteCarloDrawdown = {
    median: percentile(sortedDd, 0.5),
    p90: percentile(sortedDd, 0.9),
    p95: percentile(sortedDd, 0.95),
    worst: sortedDd[sortedDd.length - 1],
  }

  // Prozent-Umrechnung nur mit bekanntem Risikoanteil je Trade. Sie unterstellt
  // gleichbleibenden Einsatz (kein Zinseszins) — dieselbe Annahme, unter der
  // auch die Equity-Kurve der App rechnet. Die UI schreibt sie hin.
  const riskFraction =
    input.riskFraction != null && Number.isFinite(input.riskFraction) && input.riskFraction > 0
      ? input.riskFraction
      : null

  let drawdownPct: MonteCarloDrawdownPct | null = null
  if (riskFraction) {
    // Ein Drawdown von X R kostet X × Risikoanteil des Kontos.
    const rNeeded = thresholdPct / (riskFraction * 100)
    let over = 0
    for (const dd of drawdowns) if (dd >= rNeeded) over++
    drawdownPct = {
      riskPerTradePct: riskFraction * 100,
      thresholdPct,
      probabilityOverThreshold: (over / runs) * 100,
      median: drawdown.median * riskFraction * 100,
      p95: drawdown.p95 * riskFraction * 100,
    }
  }

  // P(längste Serie >= k) — von hinten aufsummiert.
  const atLeast = new Array<number>(horizon + 2).fill(0)
  for (let k = horizon; k >= 0; k--) atLeast[k] = atLeast[k + 1] + streakCounts[k]

  const all: LossStreakOdds[] = []
  for (let k = 1; k <= horizon; k++) {
    const p = atLeast[k] / runs
    if (p < STREAK_CUTOFF) break
    all.push({ length: k, probability: p * 100 })
  }

  // Die vorderen Zeilen sind bei jeder halbwegs normalen Verteilung „100 %" und
  // verdrängen genau die Längen, wegen derer man hinschaut. Sie fallen weg,
  // solange genug Zeilen übrig bleiben — bei entarteten Verteilungen (nur
  // Verlierer) bleibt die Tabelle lieber vollständig als leer.
  const firstUncertain = all.findIndex((o) => o.probability < STREAK_CEILING * 100)
  const start =
    firstUncertain > 0 && all.length - firstUncertain >= MIN_STREAK_ROWS ? firstUncertain : 0
  const odds = all.slice(start, start + MAX_STREAK_ROWS)
  // Die erlebte Serie gehört immer in die Tabelle, auch wenn sie selten ist —
  // sonst fehlt genau die Zeile, wegen der man hinschaut.
  if (observed > 0 && observed <= horizon && !odds.some((o) => o.length === observed)) {
    odds.push({ length: observed, probability: (atLeast[observed] / runs) * 100 })
    odds.sort((a, b) => a.length - b.length)
  }

  // Median der längsten Serie: die kleinste Länge, die in mindestens der Hälfte
  // der Verläufe erreicht wird.
  let typical = 0
  for (let k = horizon; k >= 1; k--) {
    if (atLeast[k] / runs >= 0.5) {
      typical = k
      break
    }
  }

  return {
    enough: true,
    minTrades: MIN_TRADES,
    horizon,
    runs,
    source,
    outcome,
    drawdown,
    drawdownPct,
    lossStreak: {
      typical,
      observed,
      observedProbability:
        observed > 0 ? (atLeast[Math.min(observed, horizon + 1)] / runs) * 100 : null,
      odds,
    },
  }
}
