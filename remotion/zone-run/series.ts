/**
 * Die Kursreihe der Motion-Graphik — rein, deterministisch, ohne Zufall zur
 * Renderzeit. Jeder Render ergibt exakt dieselben Kerzen; nur so ist die
 * Loop-Naht (Frame 420 == Frame 0) überhaupt möglich.
 *
 * Dramaturgie nach dem Douglas-Filter aus CLAUDE.md: erst steht der Plan,
 * dann läuft der Kurs. Setup 1 erreicht seine Zielzone, Setup 2 läuft in den
 * Stop. Es wird bewusst keine Trefferquote von 100 % gezeigt.
 */

export type Candle = {
  index: number
  open: number
  high: number
  low: number
  close: number
}

export type Setup = {
  /** Kerzen-Index, ab dem der Plan gilt (Einstieg). */
  entryIndex: number
  entry: number
  stop: number
  /** Zielzone als [unten, oben]. */
  zone: readonly [number, number]
  outcome: 'ziel' | 'stop'
  label: string
}

export const CANDLE_COUNT = 108

/**
 * Stützstellen des Kursverlaufs (Kerzen-Index → Preis). Dazwischen wird weich
 * interpoliert, darüber liegt gesiebtes Rauschen — organisch, aber geführt.
 */
const KEYFRAMES: readonly (readonly [number, number])[] = [
  [0, 99.0],
  [12, 102.0],
  [24, 96.6],
  [34, 97.4], // Einstieg Setup 1
  [44, 100.6],
  [52, 104.4],
  [58, 108.6], // erreicht die Zielzone von Setup 1
  [63, 110.8],
  [68, 109.4],
  [72, 106.2], // Einstieg Setup 2
  [80, 108.6], // läuft kurz an, dreht dann
  [88, 107.2],
  [96, 104.4],
  [104, 102.0], // unterschreitet den Stop von Setup 2
  [107, 101.2],
] as const

export const SETUPS: readonly Setup[] = [
  {
    entryIndex: 34,
    entry: 97.4,
    stop: 94.0,
    zone: [108, 112],
    outcome: 'ziel',
    label: 'Ziel erreicht',
  },
  {
    entryIndex: 72,
    entry: 106.2,
    stop: 102.5,
    zone: [116, 120],
    outcome: 'stop',
    label: 'Stop — Plan befolgt',
  },
] as const

/** Deterministischer PRNG (mulberry32) — gleicher Seed, gleiche Reihe. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

/** Weich interpolierter Basispreis an einer beliebigen Kerzen-Position. */
function basePriceAt(index: number): number {
  const first = KEYFRAMES[0]
  const last = KEYFRAMES[KEYFRAMES.length - 1]
  if (index <= first[0]) return first[1]
  if (index >= last[0]) return last[1]

  for (let k = 0; k < KEYFRAMES.length - 1; k++) {
    const [x0, y0] = KEYFRAMES[k]
    const [x1, y1] = KEYFRAMES[k + 1]
    if (index >= x0 && index <= x1) {
      const t = smoothstep((index - x0) / (x1 - x0))
      return y0 + (y1 - y0) * t
    }
  }
  return last[1]
}

/** Baut die vollständige Kerzenreihe. Immer identisch. */
export function buildSeries(): Candle[] {
  const rnd = mulberry32(20260724)
  const candles: Candle[] = []
  let previousClose = basePriceAt(0) - 0.4

  for (let index = 0; index < CANDLE_COUNT; index++) {
    const base = basePriceAt(index)
    const close = base + (rnd() - 0.5) * 1.05
    const open = previousClose + (rnd() - 0.5) * 0.4
    const high = Math.max(open, close) + rnd() * 0.75
    const low = Math.min(open, close) - rnd() * 0.75
    candles.push({ index, open, high, low, close })
    previousClose = close
  }

  return candles
}

/**
 * Der Kerzen-Index, an dem sich das Setup auflöst — aus den echten Daten
 * gelesen, nicht geraten: erste Kerze, deren Hoch die Zielzone berührt bzw.
 * deren Tief den Stop unterschreitet. Gibt `null`, wenn es nie eintritt.
 */
export function resolutionIndex(candles: Candle[], setup: Setup): number | null {
  for (const candle of candles) {
    if (candle.index <= setup.entryIndex) continue
    if (setup.outcome === 'ziel' && candle.high >= setup.zone[0]) return candle.index
    if (setup.outcome === 'stop' && candle.low <= setup.stop) return candle.index
  }
  return null
}

/**
 * Der Auftritts-Fahrplan der Kerzen: Frame → sichtbare Kerzenanzahl.
 * Die Plateaus sind die Momente, in denen der Plan gezeichnet wird —
 * der Kurs hält an, solange Entry, Stop und Zielzone entstehen.
 */
const SCHEDULE: readonly (readonly [number, number])[] = [
  [14, 0], // Gitter steht, erste Kerze setzt an
  [60, 34], // Historie von Setup 1 ist da
  [86, 34], // Plateau: Plan 1 wird gezeichnet
  [182, 61], // Setup 1 läuft in die Zielzone
  [206, 72], // Übergang zur Historie von Setup 2
  [248, 72], // Plateau: Plan 2 wird gezeichnet
  [372, CANDLE_COUNT], // Setup 2 läuft in den Stop
  [420, CANDLE_COUNT],
] as const

/** Wie viele Kerzen sind bei diesem Frame sichtbar (gebrochen = die letzte wächst). */
export function visibleCandlesAt(frame: number): number {
  const first = SCHEDULE[0]
  const last = SCHEDULE[SCHEDULE.length - 1]
  if (frame <= first[0]) return 0
  if (frame >= last[0]) return last[1]

  for (let k = 0; k < SCHEDULE.length - 1; k++) {
    const [f0, c0] = SCHEDULE[k]
    const [f1, c1] = SCHEDULE[k + 1]
    if (frame >= f0 && frame <= f1) {
      if (c1 === c0) return c0
      return c0 + ((c1 - c0) * (frame - f0)) / (f1 - f0)
    }
  }
  return last[1]
}

/**
 * Die Umkehrung: bei welchem Frame ist diese Kerze fertig aufgebaut?
 * Wird gebraucht, um die Ergebnis-Labels exakt auf die auslösende Kerze zu
 * legen, statt sie auf gut Glück zu timen.
 */
export function frameForCandle(count: number): number {
  const last = SCHEDULE[SCHEDULE.length - 1]
  for (let k = 0; k < SCHEDULE.length - 1; k++) {
    const [f0, c0] = SCHEDULE[k]
    const [f1, c1] = SCHEDULE[k + 1]
    if (c1 > c0 && count >= c0 && count <= c1) {
      return f0 + ((count - c0) * (f1 - f0)) / (c1 - c0)
    }
  }
  return last[0]
}
