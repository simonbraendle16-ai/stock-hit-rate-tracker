// Pure Bild-Analyse für den Analyse-Import (AP 6) — kein React, keine DOM-API
// außer den rohen Pixeldaten. Erkennt farbige Horizontallevel, Trendlinien und
// Fib-Retracements in einem TradingView-Screenshot.

export interface DetectedHLine {
  kind: 'hline'
  y: number
  x1: number
  x2: number
  color: string
}

export interface DetectedTrend {
  kind: 'trendline'
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
}

export interface DetectedFib {
  kind: 'fib'
  y0: number // 0%-Level (Pixel)
  y100: number // 100%-Level (Pixel)
  x1: number
  x2: number
}

export type DetectedObject = DetectedHLine | DetectedTrend | DetectedFib

/** Strukturelle Teilmenge von ImageData — so bleibt das Modul in Node testbar. */
export interface PixelData {
  data: Uint8ClampedArray
  width: number
  height: number
}

export const FIB_INNER = [0.236, 0.382, 0.5, 0.618, 0.786]

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** Häufigste (quantisierte) Farbe = Chart-Hintergrund. */
function estimateBackground(d: Uint8ClampedArray, w: number, h: number): [number, number, number] {
  const counts = new Map<number, number>()
  for (let y = 0; y < h; y += 5) {
    for (let x = 0; x < w; x += 5) {
      const i = (y * w + x) * 4
      const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  let best = 0
  let bestKey = 0
  for (const [k, c] of counts) {
    if (c > best) {
      best = c
      bestKey = k
    }
  }
  return [((bestKey >> 8) & 0xf) << 4, ((bestKey >> 4) & 0xf) << 4, (bestKey & 0xf) << 4]
}

function hueOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return 0
  let hue: number
  if (max === r) hue = (60 * (g - b)) / (max - min)
  else if (max === g) hue = 120 + (60 * (b - r)) / (max - min)
  else hue = 240 + (60 * (r - g)) / (max - min)
  return (hue + 360) % 360
}

/**
 * Maske der "Zeichnungs-Pixel": deutlich vom Hintergrund verschieden, farbig
 * (kein Grau/Text/Grid) und keine Kerzenfarbe (Grün/Rot wird verworfen —
 * sonst dominieren die Kerzen jede Erkennung).
 */
function buildMask(d: Uint8ClampedArray, w: number, h: number, bg: [number, number, number]): Uint8Array {
  const mask = new Uint8Array(w * h)
  for (let p = 0; p < w * h; p++) {
    const i = p * 4
    const r = d[i]
    const g = d[i + 1]
    const b = d[i + 2]
    const contrast = Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2])
    if (contrast < 90) continue
    const sat = Math.max(r, g, b) - Math.min(r, g, b)
    if (sat < 28) continue // Grau/Weiß (Text, Achsen) ignorieren
    const hue = hueOf(r, g, b)
    if (sat > 40 && ((hue >= 70 && hue <= 180) || hue <= 15 || hue >= 345)) continue // Kerzen
    mask[p] = 1
  }
  return mask
}

/** Durchschnittsfarbe entlang von Stützpunkten. */
function avgColor(d: Uint8ClampedArray, w: number, pts: [number, number][]): string {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (const [x, y] of pts) {
    const i = (y * w + x) * 4
    r += d[i]
    g += d[i + 1]
    b += d[i + 2]
    n++
  }
  return n === 0 ? '#45a8ec' : rgbToHex(r / n, g / n, b / n)
}

/** Horizontale Level: Zeilen mit langem, fast lückenlosem Farb-Lauf. */
function detectHLines(mask: Uint8Array, d: Uint8ClampedArray, w: number, h: number): DetectedHLine[] {
  const rows: { y: number; x1: number; x2: number }[] = []
  for (let y = 0; y < h; y++) {
    let bestLen = 0
    let bestX1 = 0
    let bestX2 = 0
    let runStart = -1
    let gap = 0
    for (let x = 0; x <= w; x++) {
      const on = x < w && mask[y * w + x] === 1
      if (on) {
        if (runStart < 0) runStart = x
        gap = 0
      } else if (runStart >= 0) {
        gap++
        if (gap > 4 || x === w) {
          const end = x - gap
          if (end - runStart > bestLen) {
            bestLen = end - runStart
            bestX1 = runStart
            bestX2 = end
          }
          runStart = -1
          gap = 0
        }
      }
    }
    if (bestLen >= w * 0.3) rows.push({ y, x1: bestX1, x2: bestX2 })
  }
  // Benachbarte Zeilen (Linienstärke) zu einer Linie zusammenfassen.
  const lines: DetectedHLine[] = []
  let group: typeof rows = []
  const flush = () => {
    if (group.length === 0) return
    const y = Math.round(group.reduce((s, r) => s + r.y, 0) / group.length)
    const x1 = Math.min(...group.map((r) => r.x1))
    const x2 = Math.max(...group.map((r) => r.x2))
    const samples: [number, number][] = []
    for (let x = x1; x < x2; x += 7) samples.push([x, y])
    lines.push({ kind: 'hline', y, x1, x2, color: avgColor(d, w, samples) })
    group = []
  }
  for (const r of rows) {
    // Nur direkt angrenzende Zeilen sind dieselbe Linie — bei größerem Abstand
    // sind es zwei eigenständige Level (z. B. Fib-Level dicht beieinander).
    if (group.length > 0 && r.y - group[group.length - 1].y > 1) flush()
    group.push(r)
  }
  flush()
  return lines
}

/**
 * Fib-Retracement erkennen: Gruppe von Horizontallinien, deren Abstände den
 * Fibonacci-Ratios entsprechen. Gefundene Gruppen werden aus den HLines entfernt.
 */
export function groupFib(hlines: DetectedHLine[]): { fibs: DetectedFib[]; rest: DetectedHLine[] } {
  if (hlines.length < 4) return { fibs: [], rest: hlines }
  const sorted = [...hlines].sort((a, b) => a.y - b.y)
  for (let i = 0; i < sorted.length; i++) {
    for (let j = sorted.length - 1; j > i + 2; j--) {
      const y0 = sorted[i].y
      const y100 = sorted[j].y
      const span = y100 - y0
      if (span < 40) continue
      const used = new Set([i, j])
      let matches = 0
      for (const lvl of FIB_INNER) {
        const target = y0 + span * lvl
        const idx = sorted.findIndex((l, k) => !used.has(k) && Math.abs(l.y - target) <= span * 0.02)
        if (idx >= 0) {
          used.add(idx)
          matches++
        }
      }
      if (matches >= 3) {
        const members = [...used].map((k) => sorted[k])
        const fib: DetectedFib = {
          kind: 'fib',
          y0,
          y100,
          x1: Math.min(...members.map((m) => m.x1)),
          x2: Math.max(...members.map((m) => m.x2)),
        }
        const rest = sorted.filter((_, k) => !used.has(k))
        const deeper = groupFib(rest)
        return { fibs: [fib, ...deeper.fibs], rest: deeper.rest }
      }
    }
  }
  return { fibs: [], rest: hlines }
}

/** Trendlinien via Hough-Transformation (Vertikale ≈ Kerzen werden ignoriert). */
function detectTrendlines(
  mask: Uint8Array,
  d: Uint8ClampedArray,
  w: number,
  h: number,
  hlines: DetectedHLine[],
): DetectedTrend[] {
  // HLine-Zeilen aus der Maske nehmen, damit sie nicht doppelt erkannt werden.
  const m = new Uint8Array(mask)
  for (const l of hlines) {
    for (let dy = -2; dy <= 2; dy++) {
      const y = l.y + dy
      if (y < 0 || y >= h) continue
      m.fill(0, y * w, y * w + w)
    }
  }

  // Winkel der LINIE: ±4°–75° (0° = horizontal schon erledigt, >75° = Kerzen).
  const angles: number[] = []
  for (let a = -75; a <= 75; a++) if (Math.abs(a) >= 4) angles.push((a * Math.PI) / 180)
  const rhoStep = 2
  const rhoMax = Math.ceil(Math.hypot(w, h))
  const rhoCount = Math.ceil((2 * rhoMax) / rhoStep)
  const acc = new Int32Array(angles.length * rhoCount)
  const sin = angles.map(Math.sin)
  const cos = angles.map(Math.cos)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (m[y * w + x] !== 1) continue
      for (let a = 0; a < angles.length; a++) {
        // Normalenform: x·sin(θ) − y·cos(θ) = ρ  (θ = Linienwinkel)
        const rho = x * sin[a] - y * cos[a]
        const ri = Math.round((rho + rhoMax) / rhoStep)
        acc[a * rhoCount + ri]++
      }
    }
  }

  // Peaks einsammeln (greedy, mit Mindestabstand in θ/ρ).
  const peaks: { a: number; ri: number; votes: number }[] = []
  for (let a = 0; a < angles.length; a++) {
    for (let ri = 0; ri < rhoCount; ri++) {
      const v = acc[a * rhoCount + ri]
      if (v >= 60) peaks.push({ a, ri, votes: v })
    }
  }
  peaks.sort((p, q) => q.votes - p.votes)
  const accepted: typeof peaks = []
  for (const p of peaks) {
    if (accepted.length >= 8) break
    if (accepted.some((q) => Math.abs(q.a - p.a) < 6 && Math.abs(q.ri - p.ri) < 8)) continue
    accepted.push(p)
  }

  // Für jeden Peak das tatsächliche Segment (längster Lauf) auf der Linie suchen.
  const trends: DetectedTrend[] = []
  for (const p of accepted) {
    const theta = angles[p.a]
    const rho = p.ri * rhoStep - rhoMax
    // Linie: x·sin−y·cos=ρ → Punkt (ρ·sin, −ρ·cos), Richtung (cos, sin)
    const px = rho * Math.sin(theta)
    const py = -rho * Math.cos(theta)
    const dirX = Math.cos(theta)
    const dirY = Math.sin(theta)
    const tMax = Math.ceil(Math.hypot(w, h))
    let best: [number, number] | null = null
    let runStart: number | null = null
    let gap = 0
    for (let t = -tMax; t <= tMax; t++) {
      const x = Math.round(px + dirX * t)
      const y = Math.round(py + dirY * t)
      let on = false
      if (x >= 0 && x < w && y >= 0 && y < h) {
        outer: for (let oy = -2; oy <= 2; oy++) {
          for (let ox = -2; ox <= 2; ox++) {
            const xx = x + ox
            const yy = y + oy
            if (xx >= 0 && xx < w && yy >= 0 && yy < h && m[yy * w + xx] === 1) {
              on = true
              break outer
            }
          }
        }
      }
      if (on) {
        if (runStart == null) runStart = t
        gap = 0
      } else if (runStart != null) {
        gap++
        if (gap > 8 || t === tMax) {
          const end = t - gap
          if (!best || end - runStart > best[1] - best[0]) best = [runStart, end]
          runStart = null
          gap = 0
        }
      }
    }
    if (runStart != null) {
      const end = tMax
      if (!best || end - runStart > best[1] - best[0]) best = [runStart, end]
    }
    if (!best || best[1] - best[0] < 70) continue
    // Farbe nur an echten Maskenpixeln messen — sonst mischt sich Hintergrund rein.
    const samples: [number, number][] = []
    for (let t = best[0]; t <= best[1]; t += 3) {
      const sx = Math.round(px + dirX * t)
      const sy = Math.round(py + dirY * t)
      if (sx >= 0 && sx < w && sy >= 0 && sy < h && m[sy * w + sx] === 1) samples.push([sx, sy])
    }
    trends.push({
      kind: 'trendline',
      x1: Math.round(px + dirX * best[0]),
      y1: Math.round(py + dirY * best[0]),
      x2: Math.round(px + dirX * best[1]),
      y2: Math.round(py + dirY * best[1]),
      color: avgColor(d, w, samples),
    })
  }

  // Duplikate derselben physischen Linie aussortieren: kürzere Segmente, deren
  // Endpunkte nahe an einem bereits akzeptierten Segment liegen, verwerfen.
  trends.sort((a, b) => Math.hypot(b.x2 - b.x1, b.y2 - b.y1) - Math.hypot(a.x2 - a.x1, a.y2 - a.y1))
  const unique: DetectedTrend[] = []
  for (const t of trends) {
    const dup = unique.some(
      (u) =>
        distToSegment(t.x1, t.y1, u.x1, u.y1, u.x2, u.y2) < 12 &&
        distToSegment(t.x2, t.y2, u.x1, u.y1, u.x2, u.y2) < 12,
    )
    if (!dup) unique.push(t)
  }
  return unique
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

export function detectAll(imageData: PixelData): DetectedObject[] {
  const { data, width: w, height: h } = imageData
  const bg = estimateBackground(data, w, h)
  const mask = buildMask(data, w, h, bg)
  const hlinesRaw = detectHLines(mask, data, w, h)
  const { fibs, rest } = groupFib(hlinesRaw)
  const trends = detectTrendlines(mask, data, w, h, hlinesRaw)
  return [...fibs, ...rest, ...trends]
}
