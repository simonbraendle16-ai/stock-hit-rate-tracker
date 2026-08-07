'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { BarPrice, IChartApi, ISeriesApi, Logical, SeriesType } from 'lightweight-charts'
import type { Drawing, DrawingPoint } from '@/app/actions/drawings'
import type { Candle } from '@/lib/market-data/types'
import type { DrawTool } from './chart-toolbar'
import { CHART_COLORS } from './colors'
import { barStep, istProjektion, logicalToTime, snapTime, timeToLogical } from '@/lib/chart-coords'
import { preisachsenBreite } from './axis-dom'
import { DEFAULT_FIB, DEFAULT_FIBEXT, fibLinien, normalizeFibStil } from '@/lib/fib-levels'
import { normalizeDrawingStyle, strichMuster } from '@/lib/drawing-style'
import {
  gesteAuswerten,
  istZeichenwerkzeug,
  istZug,
  vorschauPunkte,
  werkzeugBleibt,
} from '@/lib/drawing-interaction'
import {
  flaechenForm,
  istLinienTyp,
  linienEnden,
  linienForm,
  type EndCap,
  type Extend,
} from '@/lib/line-form'

type WaveTool = 'ew_impulse' | 'ew_correction' | 'ew_triangle' | 'ew_double' | 'ew_triple'

/**
 * Die fünf Elliott-Zählungen aus TradingView. Der Startpunkt trägt bewusst
 * keine Beschriftung ('0' bzw. leer) — beschriftet werden die Wendepunkte.
 */
const WAVE_LABELS: Record<WaveTool, string[]> = {
  ew_impulse: ['0', '1', '2', '3', '4', '5'],
  ew_correction: ['0', 'A', 'B', 'C'],
  ew_triangle: ['0', 'A', 'B', 'C', 'D', 'E'],
  ew_double: ['0', 'W', 'X', 'Y'],
  ew_triple: ['0', 'W', 'X', 'Y', 'X', 'Z'],
}

const WAVE_TOOLS = Object.keys(WAVE_LABELS) as WaveTool[]
const istWelle = (t: string): t is WaveTool => (WAVE_TOOLS as string[]).includes(t)

/** Fib-Fan: die Anteile, durch die die Strahlen laufen. */
const FIB_FAN = [0.236, 0.382, 0.5, 0.618, 0.786]
/** Fib-Zeitzonen: echte Fibonacci-Zahlen, nicht die Retracement-Anteile. */
const FIB_TIME = [1, 2, 3, 5, 8, 13, 21, 34]
/** Fib-Kreise: Anteile des Radius A→B. */
const FIB_CIRCLE = [0.382, 0.5, 0.618, 1, 1.618]
/** Gann-Box: die klassischen Drittel und die Hälfte. */
const GANN_TEILE = [1 / 3, 0.5, 2 / 3]
const XABCD_LABELS = ['X', 'A', 'B', 'C', 'D']
/** Kopf-Schulter: beschriftet werden nur die Extrempunkte. */
const HS_LABELS = ['', 'LS', '', 'K', '', 'RS', '']

// Die frühere Aufteilung in TWO_POINT/THREE_POINT ist entfallen: Wie viele
// Punkte ein Werkzeug hat UND ob es sich in einer Ziehbewegung aufziehen lässt,
// steht jetzt gemeinsam in `TOOL_SPECS` (`lib/drawing-interaction.ts`). Zwei
// Listen nebeneinander waren die Stelle, an der beim Erweitern regelmäßig eine
// vergessen wurde.

/**
 * Wie nah der Zeiger an einer Zeichnung sein muss, um sie zu treffen.
 *
 * 6 px waren zu knapp: Eine 1,5 px dünne Linie auf Pixelbruchteilen ist damit
 * nur mit ruhiger Hand zu greifen — das war der Grund, warum sich Zeichnungen
 * "nicht anfassen" ließen. TradingView liegt bei rund 8 px.
 */
const SELECT_TOLERANCE = 9 // px
/** Endpunkt-Griffe dürfen großzügiger sein — sie liegen über der Linie. */
const HANDLE_TOLERANCE = 11 // px

/**
 * Zeiger im Radiergummi-Modus: das Werkzeug selbst, damit ohne Blick auf die
 * Leiste klar ist, dass der nächste Klick löscht. Doppelt gezeichnet (dunkel
 * unter hell), damit es auf jedem Chart-Hintergrund lesbar bleibt.
 */
const ERASER_CURSOR = (() => {
  const d = 'm7 21-4.3-4.3a2.4 2.4 0 0 1 0-3.4l9.6-9.6a2.4 2.4 0 0 1 3.4 0l5.6 5.6a2.4 2.4 0 0 1 0 3.4L13 21M22 21H7m-2-10 9 9'
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none">` +
    `<path d="${d}" stroke="#0f1124" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${d}" stroke="#f2607a" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 4 18, crosshair`
})()

interface Pt {
  x: number
  y: number
}

function formatDe(v: number, digits = 4): string {
  return v.toLocaleString('de-DE', { maximumFractionDigits: digits })
}

/**
 * Zeit für das Etikett an der Zeitachse.
 *
 * Der Rasterabstand entscheidet über die Genauigkeit: Bei Tageskerzen ist eine
 * Uhrzeit eine Scheingenauigkeit, bei 15-Minuten-Kerzen ist ein Datum allein
 * nutzlos. Gerechnet in LOKALER Zeit — dieselbe Zeitzone, in der die Achse des
 * Charts beschriftet ist.
 */
function zeitEtikett(time: number, step: number): string {
  const d = new Date(time * 1000)
  const tag = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
  if (step >= 86400) {
    return `${tag}.${String(d.getFullYear()).slice(2)}`
  }
  const uhr = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  return `${tag} ${uhr}`
}

/**
 * SVG-Overlay über dem lightweight-chart: rendert persistente Zeichnungen
 * in Chart-Koordinaten und behandelt Zeichnen, Auswählen, Verschieben und
 * Löschen. AP 10 (S4): voller TradingView-Werkzeugsatz.
 */
export function DrawingLayer({
  chart,
  series,
  candles,
  drawings,
  tool,
  onToolDone,
  selectedId,
  onSelect,
  onCreate,
  onUpdate,
  onDelete,
  magnet = false,
  locked = false,
  keepTool = false,
  onClone,
  onOpenStyle,
  onLockedChange,
  onSelectionBox,
}: {
  chart: IChartApi
  series: ISeriesApi<SeriesType>
  candles: Candle[]
  drawings: Drawing[]
  tool: DrawTool
  onToolDone: () => void
  selectedId: number | null
  onSelect: (id: number | null) => void
  onCreate: (type: Drawing['type'], points: DrawingPoint[]) => void
  onUpdate: (id: number, points: DrawingPoint[]) => void
  /** Radiergummi — entfernt die angeklickte Zeichnung. */
  onDelete?: (id: number) => void
  /** Snap auf O/H/L/C der nächstgelegenen Kerze (TradingView-Magnet). */
  magnet?: boolean
  /** Zeichnungen gesperrt: auswählen ja, verschieben nein. */
  locked?: boolean
  /** Das Werkzeug bleibt nach einer fertigen Zeichnung aktiv. */
  keepTool?: boolean
  /** Eine Zeichnung verdoppeln (Rechtsklick-Menü und Strg+D). */
  onClone?: (id: number) => void
  /** Den Stil-Dialog zu einer Zeichnung öffnen (Rechtsklick → Einstellungen). */
  onOpenStyle?: (id: number) => void
  /** Zeichnungen sperren/entsperren (Rechtsklick-Menü). */
  onLockedChange?: (v: boolean) => void
  /**
   * Wo die ausgewählte Zeichnung im FENSTER liegt — daran hängt die schwebende
   * Stil-Leiste. Sie wird hier gemeldet und nicht draußen gerechnet, weil nur
   * diese Ebene die Umrechnung Zeit/Kurs → Pixel besitzt.
   */
  onSelectionBox?: (box: { left: number; top: number; right: number; bottom: number } | null) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  // Der Zähler wird nicht nur zum Neurendern gebraucht, sondern auch als
  // Abhängigkeit der Achsenmessung weiter unten — deshalb steht er hier mit
  // Namen und nicht als weggeworfener erster Wert.
  const [tick, setTick] = useState(0)
  const [pending, setPending] = useState<DrawingPoint[]>([])
  const [hoverPoint, setHoverPoint] = useState<DrawingPoint | null>(null)
  /**
   * Die laufende Zeigergeste mit einem Zeichenwerkzeug.
   *
   * Sie liegt bewusst im State und nicht in einem Ref: Die Vorschau muss beim
   * Ziehen mitlaufen, und ohne Rendern sieht man beim Aufziehen einer Linie
   * nichts — genau das war der Grund, warum sich das Zeichnen wie Raten
   * anfühlte. `gezogen` schlägt höchstens einmal je Geste um, kostet also
   * genau ein zusätzliches Rendern.
   */
  const [zug, setZug] = useState<{
    start: DrawingPoint
    startPx: Pt
    gezogen: boolean
  } | null>(null)
  /** Was unter dem Zeiger liegt (nur im Auswahl-Modus). */
  const [hoverId, setHoverId] = useState<number | null>(null)
  /** Das offene Rechtsklick-Menü: welche Zeichnung, an welcher Fensterstelle. */
  const [kontext, setKontext] = useState<{ id: number; x: number; y: number } | null>(null)
  const [textInput, setTextInput] = useState<{ point: DrawingPoint; px: Pt } | null>(null)
  const [measure, setMeasure] = useState<{ a: DrawingPoint; b: DrawingPoint | null; frozen: boolean } | null>(null)
  const [brushPts, setBrushPts] = useState<DrawingPoint[] | null>(null)
  const dragRef = useRef<{
    id: number
    pointIndex: number | null // null = ganze Zeichnung (Zeit UND Preis)
    startPoints: DrawingPoint[]
    startX: number
    startY: number
  } | null>(null)

  // Bei Pan/Zoom neu rendern (Koordinaten ändern sich).
  useEffect(() => {
    const ts = chart.timeScale()
    const handler = () => setTick((t) => t + 1)
    ts.subscribeVisibleLogicalRangeChange(handler)
    return () => ts.unsubscribeVisibleLogicalRangeChange(handler)
  }, [chart])

  // Zeitraster der aktuell gelieferten Kerzen. Über den logischen Index läuft
  // ALLES — siehe `lib/chart-coords.ts` für den Grund (Zeichnen in die Zukunft,
  // Überleben des Zurückspulens).
  const times = useMemo(() => candles.map((c) => c.time), [candles])
  const step = useMemo(() => barStep(times), [times])
  const candleByTime = useMemo(() => {
    const m = new Map<number, Candle>()
    for (const c of candles) m.set(c.time, c)
    return m
  }, [candles])

  const toPx = useCallback(
    (p: DrawingPoint): Pt | null => {
      const logical = timeToLogical(times, step, p.time)
      const x = chart.timeScale().logicalToCoordinate(logical as Logical)
      const y = series.priceToCoordinate(p.price)
      if (x == null || y == null) return null
      return { x, y }
    },
    [chart, series, times, step],
  )

  const fromPx = useCallback(
    (x: number, y: number): DrawingPoint | null => {
      const price = series.coordinateToPrice(y)
      if (price == null || times.length === 0) return null

      // Auf den nächsten Balken schnappen — auch RECHTS vom letzten. Vorher
      // wurde hier auf die letzte Kerze geklemmt; damit war jede Projektion in
      // die Zukunft unmöglich, also das meiste, wofür man im Replay zeichnet.
      const logical = chart.timeScale().coordinateToLogical(x)
      const time =
        logical != null
          ? logicalToTime(times, step, Math.round(logical))
          : snapTime(times, step, times[times.length - 1])

      // Magnet: Preis auf O/H/L/C der Kerze schnappen, wenn nah genug (≤ 14 px).
      // Hinter der letzten Kerze gibt es nichts zum Anziehen — dort gilt der
      // Kurs unter dem Zeiger.
      if (magnet) {
        const candle = candleByTime.get(time)
        if (candle) {
          let bestPrice: number = price
          let bestDist = 14
          for (const p of [candle.open, candle.high, candle.low, candle.close]) {
            const py = series.priceToCoordinate(p as BarPrice)
            if (py != null && Math.abs(py - y) < bestDist) {
              bestDist = Math.abs(py - y)
              bestPrice = p
            }
          }
          return { time, price: bestPrice }
        }
      }
      return { time, price }
    },
    [chart, series, times, step, candleByTime, magnet],
  )

  const width = svgRef.current?.clientWidth ?? 0
  const height = svgRef.current?.clientHeight ?? 0

  // Die echten Maße der Achsen. Sie ändern sich mit der Länge der Kurse (und
  // mit dem Ausblenden der Zeitachse in verdeckten Übungen). Der Aufschlag von
  // 1 px verhindert, dass die Zeichenebene die Achsenlinie selbst überlappt.
  //
  // Die Breite kommt aus dem DOM (`preisachsenBreite`): `priceScale().width()`
  // liefert in diesem Chart 0 — und 0 hieß hier „die Achse ist keinen Pixel
  // breit", also lag die Zeichenebene über der ganzen Preisachse und schluckte
  // die Klicks zum Ziehen.
  //
  // Gemessen wird BEWUSST nicht bei jedem Rendern: `getBoundingClientRect`
  // erzwingt ein Layout, und diese Ebene rendert bei jeder Bewegung der
  // Zeitachse neu — im Replay also laufend. Das reichte, um die Seite
  // einfrieren zu lassen. `tick` steigt bei genau diesen Bewegungen, die
  // Messung hängt daran und passiert damit höchstens einmal je Änderung.
  const { achsenBreite, achsenHoehe } = useMemo(() => {
    let hoehe = 26
    try {
      hoehe = Math.round(chart.timeScale().height()) + 1
    } catch {
      // Ein Chart ohne Zeitachse darf das Zeichnen nicht kosten.
    }
    return {
      achsenBreite: preisachsenBreite(svgRef.current?.parentElement) + 1,
      achsenHoehe: hoehe,
    }
    // `tick` und `width` sind die Auslöser: Beide ändern sich genau dann, wenn
    // sich die Achsen bewegt haben können.
  }, [chart, tick, width])

  /**
   * Den Platz der Auswahl nach draußen melden — für die schwebende Stil-Leiste.
   *
   * Läuft bei jedem `tick`, also bei jeder Bewegung der Zeitachse, ABER nur
   * solange etwas ausgewählt ist. Das ist der Grund für die Wache oben: Diese
   * Ebene rendert im Replay laufend neu, und `getBoundingClientRect` erzwingt
   * ein Layout — ungebremst hat genau das die Seite schon einmal einfrieren
   * lassen (siehe Kommentar an `achsenBreite`). Eine Messung je Änderung ist
   * tragbar, eine je Zeichnung wäre es nicht.
   */
  useEffect(() => {
    if (!onSelectionBox) return
    const svg = svgRef.current
    const d = selectedId == null ? null : drawings.find((x) => x.id === selectedId)
    if (!svg || !d) {
      onSelectionBox(null)
      return
    }
    const pts = d.points.map(toPx)
    if (pts.length === 0 || pts.some((p) => p == null)) {
      onSelectionBox(null)
      return
    }
    const P = pts as Pt[]
    const r = svg.getBoundingClientRect()
    const xs = P.map((p) => p.x)
    const ys = P.map((p) => p.y)
    // Auf den sichtbaren Chart geklemmt: Eine Zeichnung darf zur Hälfte aus dem
    // Bild laufen — ihre Leiste nicht, sonst zeigt sie ins Nichts.
    const nutz = { breite: Math.max(0, r.width - achsenBreite), hoehe: Math.max(0, r.height - achsenHoehe) }
    onSelectionBox({
      left: r.left + Math.max(0, Math.min(...xs)),
      right: r.left + Math.min(nutz.breite, Math.max(...xs)),
      top: r.top + Math.max(0, Math.min(...ys)),
      bottom: r.top + Math.min(nutz.hoehe, Math.max(...ys)),
    })
  }, [selectedId, drawings, tick, width, height, toPx, onSelectionBox, achsenBreite, achsenHoehe])

  /** Strahl: von a durch b bis zum Canvas-Rand verlängern. */
  const extendRay = useCallback(
    (a: Pt, b: Pt): Pt => {
      const dx = b.x - a.x
      const dy = b.y - a.y
      if (dx === 0 && dy === 0) return b
      const ts: number[] = []
      if (dx !== 0) ts.push(dx > 0 ? (width - a.x) / dx : -a.x / dx)
      if (dy !== 0) ts.push(dy > 0 ? (height - a.y) / dy : -a.y / dy)
      const positive = ts.filter((t) => t > 0)
      const t = Math.max(1, positive.length ? Math.min(...positive) : 1)
      return { x: a.x + dx * t, y: a.y + dy * t }
    },
    [width, height],
  )

  /**
   * Die Enden der Kanal-Basislinie nach `extend`.
   *
   * Läuft über dieselbe reine Funktion wie jede andere Linie (`linienEnden`),
   * damit „nach rechts verlängern" am Kanal nicht etwas anderes bedeutet als an
   * der Trendlinie. Die Parallele erbt die Enden über denselben Versatz — sonst
   * liefen die beiden Linien unterschiedlich weit und der Kanal wäre schief.
   */
  const kanalEnden = useCallback(
    (a: Pt, b: Pt, extend: Extend) => linienEnden(a, b, extend, (q, r) => extendRay(q, r)),
    [extendRay],
  )

  /** Kanal: Parallel-Linie durch P2 zur Basis P0–P1 (gleiche Steigung). */
  const channelOffset = (P: Pt[]): number => {
    const dx = P[1].x - P[0].x || 1
    const slope = (P[1].y - P[0].y) / dx
    const yOnBase = P[0].y + slope * (P[2].x - P[0].x)
    return P[2].y - yOnBase
  }

  // ---- Interaktion ----------------------------------------------------------

  const hitTest = useCallback(
    (x: number, y: number): number | null => {
      // Von hinten nach vorn: Gezeichnet wird in Reihenfolge, die zuletzt
      // angelegte Zeichnung liegt also OBEN. Vorher gewann die älteste, und
      // man erwischte bei überlappenden Linien zuverlässig die falsche —
      // sichtbar oben lag eine andere als die, die sich auswählen ließ.
      for (let i = drawings.length - 1; i >= 0; i--) {
        const d = drawings[i]
        const pts = d.points.map(toPx)
        if (pts.some((p) => p == null)) continue
        const P = pts as Pt[]
        if (d.type === 'hline') {
          if (Math.abs(P[0].y - y) < SELECT_TOLERANCE) return d.id
        } else if (d.type === 'hray') {
          if (Math.abs(P[0].y - y) < SELECT_TOLERANCE && x >= P[0].x - SELECT_TOLERANCE) {
            return d.id
          }
        } else if (d.type === 'vline') {
          if (Math.abs(P[0].x - x) < SELECT_TOLERANCE) return d.id
        } else if (d.type === 'crossline') {
          if (
            Math.abs(P[0].y - y) < SELECT_TOLERANCE ||
            Math.abs(P[0].x - x) < SELECT_TOLERANCE
          ) {
            return d.id
          }
        } else if (istLinienTyp(d.type) && P.length >= 2) {
          // Getroffen wird über DIESELBE Form, die auch gezeichnet wird — sonst
          // ließe sich ein verlängerter Teil sehen, aber nicht anklicken.
          const { von, bis } = linienEnden(
            P[0],
            P[1],
            linienForm(d.type, d.style).extend,
            (q, r) => extendRay(q, r),
          )
          if (distToSegment({ x, y }, von, bis) < SELECT_TOLERANCE) return d.id
        } else if (d.type === 'trendangle' && P.length >= 2) {
          if (distToSegment({ x, y }, P[0], P[1]) < SELECT_TOLERANCE) return d.id
        } else if (d.type === 'channel' && P.length >= 3) {
          // Getroffen wird über DIESELBEN Enden, die auch gezeichnet werden —
          // sonst ließe sich ein verlängerter Kanal sehen, aber nicht anfassen.
          const form = flaechenForm(d.type, d.style)
          const { von: a1, bis: b1 } = kanalEnden(P[0], P[1], form.extend)
          const off = channelOffset(P)
          const a2 = { x: a1.x, y: a1.y + off }
          const b2 = { x: b1.x, y: b1.y + off }
          const strecken: [Pt, Pt][] = [
            [a1, b1],
            [a2, b2],
          ]
          if (form.middleLine) {
            strecken.push([
              { x: a1.x, y: (a1.y + a2.y) / 2 },
              { x: b1.x, y: (b1.y + b2.y) / 2 },
            ])
          }
          if (strecken.some(([p, q]) => distToSegment({ x, y }, p, q) < SELECT_TOLERANCE)) {
            return d.id
          }
        } else if (d.type === 'brush' && P.length >= 2) {
          for (let i = 1; i < P.length; i++) {
            if (distToSegment({ x, y }, P[i - 1], P[i]) < SELECT_TOLERANCE) return d.id
          }
        } else if (istWelle(d.type) && P.length >= 2) {
          for (let i = 1; i < P.length; i++) {
            if (distToSegment({ x, y }, P[i - 1], P[i]) < SELECT_TOLERANCE + 2) return d.id
          }
        } else if (d.type === 'ellipse' && P.length >= 2) {
          const cx = (P[0].x + P[1].x) / 2
          const cy = (P[0].y + P[1].y) / 2
          const rx = Math.abs(P[1].x - P[0].x) / 2 || 1
          const ry = Math.abs(P[1].y - P[0].y) / 2 || 1
          const v = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
          if (Math.abs(v - 1) < 0.2) return d.id
        } else if (
          (d.type === 'rect' || d.type === 'pricerange' || d.type === 'daterange') &&
          P.length >= 2
        ) {
          const x1 = Math.min(P[0].x, P[1].x)
          const x2 = Math.max(P[0].x, P[1].x)
          const y1 = Math.min(P[0].y, P[1].y)
          const y2 = Math.max(P[0].y, P[1].y)
          const inX = x >= x1 - SELECT_TOLERANCE && x <= x2 + SELECT_TOLERANCE
          const inY = y >= y1 - SELECT_TOLERANCE && y <= y2 + SELECT_TOLERANCE
          if (d.type === 'rect') {
            const nearEdge =
              (inY && (Math.abs(x - x1) < SELECT_TOLERANCE || Math.abs(x - x2) < SELECT_TOLERANCE)) ||
              (inX && (Math.abs(y - y1) < SELECT_TOLERANCE || Math.abs(y - y2) < SELECT_TOLERANCE))
            if (nearEdge) return d.id
          } else if (inX && inY) {
            return d.id
          }
        } else if ((d.type === 'longpos' || d.type === 'shortpos') && P.length >= 3) {
          const x1 = P[0].x
          const x2 = Math.max(P[1].x, P[2].x, P[0].x + 90)
          const ys = [P[0].y, P[1].y, P[2].y]
          const y1 = Math.min(...ys)
          const y2 = Math.max(...ys)
          if (x >= x1 - SELECT_TOLERANCE && x <= x2 + SELECT_TOLERANCE && y >= y1 - SELECT_TOLERANCE && y <= y2 + SELECT_TOLERANCE) {
            return d.id
          }
        } else if ((d.type === 'fib' || d.type === 'fibext') && P.length >= 2) {
          // Getroffen wird über DIESELBEN Levels, die auch gezeichnet werden —
          // sonst ließe sich ein selbst ergänztes Level sehen, aber nicht
          // anklicken, und das Werkzeug fühlte sich weiter kaputt an.
          const ext = d.type === 'fibext'
          if (ext && P.length < 3) continue
          const stil = normalizeFibStil(d.style?.fib, ext ? DEFAULT_FIBEXT : DEFAULT_FIB)
          // Dieselbe Ausrichtung wie beim Zeichnen (siehe `renderFib`): beim
          // Retracement liegt 0 am zweiten Klick. Stünden hier andere Werte,
          // träfe man neben die Linien, die man sieht.
          const von = ext ? d.points[2].price : d.points[1].price
          const bis = ext
            ? d.points[2].price + (d.points[1].price - d.points[0].price)
            : d.points[0].price
          const x1 = ext ? P[2].x : Math.min(P[0].x, P[1].x)
          const x2 = stil.verlaengern
            ? width
            : ext
              ? width
              : Math.max(P[0].x, P[1].x)
          if (x >= x1 - SELECT_TOLERANCE && x <= x2 + SELECT_TOLERANCE) {
            for (const l of fibLinien(stil, von, bis)) {
              const ly = series.priceToCoordinate(l.preis)
              if (ly != null && Math.abs(ly - y) < SELECT_TOLERANCE) return d.id
            }
          }
        } else if (d.type === 'text') {
          if (Math.abs(P[0].x - x) < 40 && Math.abs(P[0].y - y) < 14) return d.id
        }
      }
      return null
    },
    [drawings, toPx, extendRay, kanalEnden, series],
  )

  /** Long/Short-Position: Defaults beim Platzieren (2 % Risiko, 2R Ziel). */
  const createPosition = (point: DrawingPoint, long: boolean) => {
    const entry = point.price
    const stop = long ? entry * 0.98 : entry * 1.02
    const target = long ? entry * 1.04 : entry * 0.96
    const idx = candles.findIndex((c) => c.time === point.time)
    const rightIdx = Math.min(candles.length - 1, (idx < 0 ? candles.length - 1 : idx) + 20)
    const t2 = candles[rightIdx].time
    onCreate(long ? 'longpos' : 'shortpos', [
      { time: point.time, price: entry },
      { time: t2, price: stop },
      { time: t2, price: target },
    ])
    onToolDone()
  }

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // Auswählen und Radieren brauchen NUR Pixel — sie fragen `hitTest`, und der
    // rechnet in Bildschirmkoordinaten.
    //
    // Vorher stand hier ein `fromPx(...); if (!point) return` VOR beiden
    // Zweigen. `fromPx` gibt aber null zurück, sobald der Zeiger auf einer
    // Höhe liegt, für die die Serie keinen Kurs kennt — über einer
    // Indikator-Pane, über oder unter der Kursfläche, oder bevor Kerzen da
    // sind. In genau diesen Bereichen ließ sich deshalb weder etwas anklicken
    // noch wegradieren, obwohl die Zeichnung sichtbar dort lag. Das ist der
    // Grund, warum sich die Werkzeuge „mal so, mal so" angefühlt haben.
    //
    // Einen Chart-Punkt braucht erst, wer etwas NEUES setzt — der wird unten
    // geholt.

    // Radiergummi: trifft der Klick eine Zeichnung, ist sie weg. Der Modus
    // bleibt an, damit mehrere Zeichnungen hintereinander wegkönnen.
    if (tool === 'eraser') {
      if (locked) return
      const treffer = hitTest(x, y)
      if (treffer != null) onDelete?.(treffer)
      return
    }

    if (tool === 'cursor') {
      // Endpunkt-Handle der Auswahl treffen? (gesperrt: nur auswählen)
      if (selectedId != null && !locked) {
        const sel = drawings.find((d) => d.id === selectedId)
        if (sel) {
          const pts = sel.points.map(toPx)
          for (let i = 0; i < pts.length; i++) {
            const p = pts[i]
            if (p && Math.hypot(p.x - x, p.y - y) < HANDLE_TOLERANCE) {
              dragRef.current = {
                id: sel.id,
                pointIndex: i,
                startPoints: sel.points,
                startX: x,
                startY: y,
              }
              svgRef.current!.setPointerCapture(e.pointerId)
              return
            }
          }
        }
      }
      // Der genaue Treffertest entscheidet; kommt er zu keinem Ergebnis, gilt
      // die Zeichnung, über deren Greifzone der Zeiger steht. Ohne diesen
      // Rückfall ginge ein Klick verloren, der sichtbar auf einer Zeichnung
      // sitzt — etwa in der Fläche eines Fib-Gitters.
      const hit = hitTest(x, y) ?? hoverId
      onSelect(hit)
      if (hit != null && !locked) {
        const d = drawings.find((dd) => dd.id === hit)!
        // Vertikale: Ganzkörper-Drag verschiebt nur den Preis (unsichtbar) —
        // deshalb direkt den Punkt selbst ziehen (Zeit + Preis).
        const pointIndex = d.type === 'vline' ? 0 : null
        dragRef.current = { id: hit, pointIndex, startPoints: d.points, startX: x, startY: y }
        svgRef.current!.setPointerCapture(e.pointerId)
      }
      return
    }

    // Ab hier wird etwas Neues gesetzt — dafür braucht es einen Chart-Punkt.
    const point = fromPx(x, y)
    if (!point) return

    // Ein Zeichenwerkzeug beginnt hier NUR die Geste. Ob daraus ein Klick oder
    // ein Zug wird, entscheidet erst das Loslassen — deshalb wird an dieser
    // Stelle nichts mehr angelegt. Vorher setzte jeder Druck sofort einen
    // Punkt, und damit war ein Aufziehen in einer Bewegung gar nicht möglich:
    // Eine Trendlinie kostete zwei getrennte Klicks, ein Elliott-Zug sechs.
    if (istZeichenwerkzeug(tool)) {
      setZug({ start: point, startPx: { x, y }, gezogen: false })
      setHoverPoint(point)
      svgRef.current!.setPointerCapture(e.pointerId)
      return
    }

    if (tool === 'brush') {
      setBrushPts([point])
      svgRef.current!.setPointerCapture(e.pointerId)
    } else if (tool === 'longpos' || tool === 'shortpos') {
      createPosition(point, tool === 'longpos')
    } else if (tool === 'text' || tool === 'callout') {
      // Beide brauchen einen Text, bevor es sie gibt — deshalb derselbe Ablauf
      // und nicht die Gestenauswertung.
      setTextInput({ point, px: { x, y } })
    } else if (tool === 'measure') {
      if (!measure || measure.frozen) {
        setMeasure({ a: point, b: null, frozen: false })
      } else {
        setMeasure({ ...measure, b: point, frozen: true })
      }
    }
  }

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const drag = dragRef.current
    if (drag) {
      const point = fromPx(x, y)
      if (!point) return
      let next: DrawingPoint[]
      if (drag.pointIndex != null) {
        next = drag.startPoints.map((p, i) =>
          i === drag.pointIndex ? { ...p, time: point.time, price: point.price } : p,
        )
      } else {
        // Ganze Zeichnung verschieben — in BEIDE Richtungen. Vorher wanderte
        // nur der Preis mit; waagerecht ließ sich eine fertige Linie gar nicht
        // versetzen, was das Anfassen praktisch unbrauchbar machte.
        const startPrice = series.coordinateToPrice(drag.startY)
        const nowPrice = series.coordinateToPrice(y)
        if (startPrice == null || nowPrice == null) return
        const delta = nowPrice - startPrice

        // Waagerecht wird in BALKEN verschoben, nicht in Pixeln: Ein Punkt muss
        // auf einer Rasterposition landen, sonst hat er keinen Platz auf der
        // Achse. Gerechnet wird über den logischen Index, nicht über einen
        // Treffer in der Kerzenliste — sonst ließe sich eine Zeichnung, die
        // einen Punkt in der Zukunft hat, waagerecht gar nicht mehr bewegen.
        const ls = chart.timeScale().coordinateToLogical(drag.startX)
        const ln = chart.timeScale().coordinateToLogical(x)
        let versatz = ls != null && ln != null ? Math.round(ln - ls) : 0

        // Der Versatz wird EINMAL für die ganze Zeichnung begrenzt. Würde jeder
        // Punkt für sich an den Rand geklemmt, liefe der vordere Punkt weiter
        // als der hintere — die Zeichnung würde sich beim Schieben verformen.
        // Nach links ist die erste Kerze die Grenze; nach rechts gibt es keine,
        // die Projektion darf beliebig weit vorlaufen.
        const idx = drag.startPoints.map((p) => Math.round(timeToLogical(times, step, p.time)))
        if (versatz !== 0) {
          versatz = Math.max(-Math.min(...idx), versatz)
        }

        next = drag.startPoints.map((p, k) => {
          const price = p.price + delta
          if (versatz === 0) return { ...p, price }
          return { time: logicalToTime(times, step, idx[k] + versatz), price }
        })
      }
      onUpdate(drag.id, next)
      return
    }

    // Die laufende Zeichengeste: Vorschau mitziehen und einmalig festhalten,
    // dass aus dem Druck ein Zug geworden ist.
    if (zug) {
      const point = fromPx(x, y)
      if (!point) return
      setHoverPoint(point)
      if (!zug.gezogen && istZug(zug.startPx, { x, y })) {
        setZug({ ...zug, gezogen: true })
      }
      return
    }

    if (tool === 'brush' && brushPts) {
      const point = fromPx(x, y)
      if (!point) return
      const lastPx = toPx(brushPts[brushPts.length - 1])
      if (!lastPx || Math.hypot(lastPx.x - x, lastPx.y - y) > 4) {
        setBrushPts((p) => (p && p.length < 480 ? [...p, point] : p))
      }
      return
    }

    if (pending.length >= 1) {
      setHoverPoint(fromPx(x, y))
    } else if (istZeichenwerkzeug(tool)) {
      // Auch beim bloßen Überfahren, nicht erst beim Ziehen: In TradingView
      // steht der Kurs unter dem Zeiger DAUERHAFT an der Achse, sobald ein
      // Werkzeug gewählt ist (an SBUX nachgesehen: „96,54" am Fadenkreuz, ohne
      // gedrückte Maustaste). Man setzt den ersten Punkt sonst blind und
      // korrigiert hinterher — bei einem Stop ist genau das der Unterschied
      // zwischen Plan und Ungefähr.
      setHoverPoint(fromPx(x, y))
    } else if (tool === 'measure' && measure && !measure.frozen) {
      setMeasure({ ...measure, b: fromPx(x, y), frozen: false })
    } else if (tool === 'cursor') {
      // Rückmeldung beim Überfahren: Ohne sie ist einer Zeichnung nicht
      // anzusehen, dass sie greifbar ist — man klickt, trifft nicht und hält
      // das Werkzeug für kaputt.
      const treffer = hitTest(x, y)
      setHoverId((h) => (h === treffer ? h : treffer))
    }
  }

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragRef.current) {
      svgRef.current!.releasePointerCapture(e.pointerId)
      dragRef.current = null
    }

    // Hier fällt die Entscheidung Klick oder Zug — beides führt durch dieselbe
    // reine Funktion (`lib/drawing-interaction.ts`), damit es nicht wieder zwei
    // Meinungen darüber gibt, wann eine Zeichnung fertig ist.
    if (zug) {
      svgRef.current!.releasePointerCapture(e.pointerId)
      const rect = svgRef.current!.getBoundingClientRect()
      const ende = fromPx(e.clientX - rect.left, e.clientY - rect.top) ?? zug.start
      const ergebnis = gesteAuswerten(tool, pending, zug.start, ende, zug.gezogen)
      setZug(null)
      if (ergebnis.art === 'anlegen') {
        onCreate(tool as Drawing['type'], ergebnis.punkte)
        setPending([])
        setHoverPoint(null)
        // Das Werkzeug bleibt auf Wunsch aktiv. Vorher sprang es IMMER auf den
        // Zeiger zurück — wer fünf Niveaus einzeichnen wollte, griff fünfmal
        // in die Leiste.
        if (!werkzeugBleibt(tool, keepTool)) onToolDone()
      } else if (ergebnis.art === 'weiter') {
        setPending(ergebnis.punkte)
      }
      return
    }

    if (tool === 'brush' && brushPts) {
      svgRef.current!.releasePointerCapture(e.pointerId)
      if (brushPts.length >= 2) onCreate('brush', brushPts)
      setBrushPts(null)
      onToolDone()
    }
  }

  // Escape bricht ab, Entf löscht die Auswahl, Werkzeugwechsel räumt auf.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // In einem Eingabefeld gehört die Tastatur dem Feld. Der Schutz fehlte
      // hier bisher; mit der Entf-Taste wäre das nicht mehr harmlos gewesen —
      // ein Druck im Notizfeld hätte eine Zeichnung gelöscht.
      const ziel = e.target as HTMLElement | null
      const tag = ziel?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ziel?.isContentEditable) {
        return
      }

      if (e.key === 'Delete' && selectedId != null && !locked) {
        e.preventDefault()
        onDelete?.(selectedId)
        onSelect(null)
        return
      }

      // Strg+D klont — dieselbe Belegung wie in TradingView.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && selectedId != null && !locked) {
        e.preventDefault()
        onClone?.(selectedId)
        return
      }

      if (e.key === 'Escape') {
        setPending([])
        setHoverPoint(null)
        setZug(null)
        setMeasure(null)
        setTextInput(null)
        setBrushPts(null)
        setKontext(null)
        onSelect(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSelect, selectedId, locked, onDelete, onClone])

  useEffect(() => {
    setPending([])
    setHoverPoint(null)
    setZug(null)
    setHoverId(null)
    setBrushPts(null)
    if (tool !== 'measure') setMeasure(null)
    if (tool !== 'text') setTextInput(null)
  }, [tool])

  // ---- Rendering ------------------------------------------------------------

  /** Box + Delta-Beschriftung (Preis-Range persistent & Mess-Werkzeug). */
  const renderRangeBox = (
    key: string | number,
    a: Pt,
    b: Pt,
    pa: DrawingPoint,
    pb: DrawingPoint,
    kind: 'price' | 'date',
    selected?: boolean,
  ) => {
    const dPrice = pb.price - pa.price
    const dPct = (dPrice / pa.price) * 100
    const up = dPrice >= 0
    const col = kind === 'date' ? CHART_COLORS.accent : up ? CHART_COLORS.up : CHART_COLORS.down
    let label: string
    if (kind === 'price') {
      label = `${up ? '+' : ''}${formatDe(dPrice)} (${up ? '+' : ''}${dPct.toFixed(2)}%)`
    } else {
      const t1 = Math.min(pa.time, pb.time)
      const t2 = Math.max(pa.time, pb.time)
      const bars = candles.filter((c) => c.time >= t1 && c.time <= t2).length
      const secs = t2 - t1
      const dur = secs >= 172800 ? `${Math.round(secs / 86400)} Tage` : `${Math.round(secs / 3600)} h`
      label = `${bars} Balken · ${dur}`
    }
    return (
      <g key={key}>
        <rect
          x={Math.min(a.x, b.x)}
          y={Math.min(a.y, b.y)}
          width={Math.abs(b.x - a.x)}
          height={Math.abs(b.y - a.y)}
          fill={col}
          opacity={0.12}
          stroke={col}
          strokeWidth={selected ? 2 : 1}
        />
        <text x={(a.x + b.x) / 2} y={Math.min(a.y, b.y) - 6} fill={col} fontSize={10} fontFamily="monospace" textAnchor="middle">
          {label}
        </text>
      </g>
    )
  }

  /**
   * Fibonacci zeichnen — Retracement und Extension über denselben Weg.
   *
   * Zwei Dinge, die vorher fehlten und das Werkzeug unbrauchbar gemacht haben:
   * Die Linien laufen jetzt **nach rechts weiter** (sonst sieht man nie, wo der
   * Kurs, der noch kommt, auf ein Level trifft), und die Beschriftung sitzt am
   * LINKEN Ende. Rechts lag sie unter der Preisachse, die die Zeichenebene per
   * `clipPath` freihält — sie war damit oft schlicht abgeschnitten.
   */
  const renderFib = (
    d: Drawing,
    P: Pt[],
    stil: ReturnType<typeof normalizeDrawingStyle>,
    opt: {
      von: number
      bis: number
      linkeKante: number
      rechteKante: number
      basis: React.ReactNode
      handles: React.ReactNode
    },
  ) => {
    const fib = normalizeFibStil(
      d.style?.fib,
      d.type === 'fibext' ? DEFAULT_FIBEXT : DEFAULT_FIB,
    )
    const linien = fibLinien({ ...fib, farbe: stil.color }, opt.von, opt.bis)
    // Rechter Rand des zeichenbaren Bereichs: Die Preisachse bleibt per
    // clipPath frei, dorthin zu zeichnen wäre unsichtbar.
    const rand = Math.max(opt.linkeKante + 40, width - achsenBreite - 4)
    const x2 = fib.verlaengern ? rand : Math.max(opt.rechteKante, opt.linkeKante + 40)
    const x1 = opt.linkeKante

    const mitY = linien.flatMap((l) => {
      const y = series.priceToCoordinate(l.preis)
      return y == null ? [] : [{ l, y: y as number }]
    })

    return (
      <g key={d.id}>
        {opt.basis}
        {/* Flächen zwischen benachbarten Levels — zuerst, damit die Linien darüber liegen. */}
        {fib.flaeche &&
          mitY.slice(0, -1).map((e, i) => (
            <rect
              key={`f${e.l.wert}`}
              x={x1}
              y={Math.min(e.y, mitY[i + 1].y)}
              width={Math.max(0, x2 - x1)}
              height={Math.abs(mitY[i + 1].y - e.y)}
              fill={e.l.farbe}
              opacity={i % 2 === 0 ? 0.07 : 0.03}
            />
          ))}
        {mitY.map(({ l, y }) => (
          <g key={l.wert}>
            <line
              x1={x1}
              y1={y}
              x2={x2}
              y2={y}
              stroke={l.farbe}
              strokeWidth={l.betont ? stil.width + 0.5 : stil.width}
              strokeDasharray={strichMuster(stil.strich, stil.width)}
              opacity={l.betont ? 0.95 : 0.75}
            />
            {l.label && (
              <text
                x={x1 + 4}
                y={y - 3}
                fill={l.farbe}
                fontSize={9}
                fontFamily="monospace"
                opacity={0.95}
              >
                {l.label}
              </text>
            )}
          </g>
        ))}
        {opt.handles}
      </g>
    )
  }

  const renderDrawing = (d: Drawing) => {
    // Gelesen wird immer normalisiert — was in der Datenbank steht, ist
    // ungeprüft und darf nicht ungefiltert in ein SVG-Attribut.
    const stil = normalizeDrawingStyle(
      d.style,
      // Alles Fibonacci trägt dieselbe Farbe — sonst sähen Retracement und Fan
      // im selben Chart nach zwei verschiedenen Dingen aus.
      d.type.startsWith('fib') ? CHART_COLORS.warning : CHART_COLORS.accent,
    )
    const color = stil.color
    const strich = strichMuster(stil.strich, stil.width)
    const pts = d.points.map(toPx)
    if (pts.some((p) => p == null)) return null
    const P = pts as Pt[]
    const selected = d.id === selectedId
    /** Ausgewähltes wird kräftiger — sonst sieht man nicht, was man greift. */
    const sw = (grund = stil.width) => (selected ? grund + 0.75 : grund)

    const handles = selected
      ? P.map((p, i) => (
          <circle key={`h${i}`} cx={p.x} cy={p.y} r={4} fill={CHART_COLORS.foreground} stroke={color} />
        ))
      : null

    if (d.type === 'hline') {
      return (
        <g key={d.id}>
          <line x1={0} y1={P[0].y} x2={width} y2={P[0].y} stroke={color} strokeWidth={sw()} strokeLinecap="round" strokeDasharray={strich} />
          <text x={4} y={P[0].y - 4} fill={color} fontSize={10} fontFamily="monospace">
            {d.style?.label ?? formatDe(d.points[0].price, 6)}
          </text>
          {handles}
        </g>
      )
    }
    if (d.type === 'vline') {
      return (
        <g key={d.id}>
          <line x1={P[0].x} y1={0} x2={P[0].x} y2={height} stroke={color} strokeWidth={sw()} strokeLinecap="round" strokeDasharray={strich} />
          {handles}
        </g>
      )
    }
    /**
     * EIN Renderer für alle Linien-Werkzeuge.
     *
     * Vorher standen hier drei fast gleiche Blöcke für `trendline`, `arrow` und
     * `ray` (und weiter unten zwei weitere für `extendedline` und `infoline`).
     * Ob eine Linie verlängert wird, eine Spitze trägt oder Kennzahlen zeigt,
     * ist ab hier eine EIGENSCHAFT und kein eigener Typ mehr — nachträglich
     * änderbar, genau wie in TradingViews Einstellungsdialog.
     */
    if (istLinienTyp(d.type) && P.length >= 2) {
      const form = linienForm(d.type, d.style)
      const { von, bis } = linienEnden(P[0], P[1], form.extend, (q, r) => extendRay(q, r))

      /** Pfeilspitze oder Punkt an einem Ende, ausgerichtet auf die Linie. */
      const kappe = (an: Pt, richtungVon: Pt, art: EndCap, key: string) => {
        if (art === 'none') return null
        if (art === 'dot') {
          return <circle key={key} cx={an.x} cy={an.y} r={3.5} fill={color} />
        }
        const w = Math.atan2(an.y - richtungVon.y, an.x - richtungVon.x)
        const g = 9
        const l = { x: an.x - g * Math.cos(w - Math.PI / 7), y: an.y - g * Math.sin(w - Math.PI / 7) }
        const r = { x: an.x - g * Math.cos(w + Math.PI / 7), y: an.y - g * Math.sin(w + Math.PI / 7) }
        return (
          <polygon key={key} points={`${an.x},${an.y} ${l.x},${l.y} ${r.x},${r.y}`} fill={color} />
        )
      }

      let kennzahlen: React.ReactNode = null
      if (form.stats) {
        const a = d.points[0]
        const b = d.points[1]
        const delta = b.price - a.price
        const proz = a.price !== 0 ? (delta / a.price) * 100 : 0
        const balken = Math.abs(
          Math.round(timeToLogical(times, step, b.time)) -
            Math.round(timeToLogical(times, step, a.time)),
        )
        const txt = `${delta >= 0 ? '+' : ''}${formatDe(delta, 4)} · ${proz >= 0 ? '+' : ''}${proz.toFixed(2)} % · ${balken} B`
        const mx = (P[0].x + P[1].x) / 2
        const my = (P[0].y + P[1].y) / 2
        kennzahlen = (
          <g>
            <rect x={mx - txt.length * 3.1 - 5} y={my - 18} width={txt.length * 6.2 + 10} height={16} rx={3} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={0.8} />
            <text x={mx} y={my - 6} fill={color} fontSize={10} fontFamily="monospace" textAnchor="middle">
              {txt}
            </text>
          </g>
        )
      }

      const etikett = (p: Pt, preis: number, key: string) => (
        <g key={key}>
          <rect x={p.x + 6} y={p.y - 8} width={formatDe(preis, 4).length * 6.2 + 8} height={16} rx={3} fill={color} fillOpacity={0.2} stroke={color} strokeWidth={0.7} />
          <text x={p.x + 10} y={p.y + 4} fill={color} fontSize={9.5} fontFamily="monospace">
            {formatDe(preis, 4)}
          </text>
        </g>
      )

      const mitte = { x: (P[0].x + P[1].x) / 2, y: (P[0].y + P[1].y) / 2 }

      return (
        <g key={d.id}>
          <line x1={von.x} y1={von.y} x2={bis.x} y2={bis.y} stroke={color} strokeWidth={sw()} strokeDasharray={strich} />
          {kappe(P[0], P[1], form.leftEnd, 'k0')}
          {kappe(P[1], P[0], form.rightEnd, 'k1')}
          {kennzahlen}
          {form.priceLabels && etikett(P[0], d.points[0].price, 'e0')}
          {form.priceLabels && etikett(P[1], d.points[1].price, 'e1')}
          {form.middlePoint && (
            <circle cx={mitte.x} cy={mitte.y} r={3} fill={CHART_COLORS.foreground} stroke={color} />
          )}
          {handles}
        </g>
      )
    }
    if (d.type === 'channel' && P.length >= 3) {
      // Der Kanal trägt seit der TradingView-Recherche dieselbe Flächenform wie
      // das Rechteck: Verlängern, Rahmen, Füllung, Mittellinie. Vorher war er
      // fest verdrahtet — zwei Linien, immer gefüllt, die er auch dann nicht
      // verlassen konnte, wenn man nur die Mitte handeln wollte.
      const form = flaechenForm(d.type, d.style)
      const { von: a1, bis: b1 } = kanalEnden(P[0], P[1], form.extend)
      const off = channelOffset(P)
      const a2 = { x: a1.x, y: a1.y + off }
      const b2 = { x: b1.x, y: b1.y + off }
      const mitte = (p: Pt, q: Pt) => ({ x: p.x, y: (p.y + q.y) / 2 })
      const m1 = mitte(a1, a2)
      const m2 = mitte(b1, b2)
      return (
        <g key={d.id}>
          {form.background && (
            <polygon
              points={`${a1.x},${a1.y} ${b1.x},${b1.y} ${b2.x},${b2.y} ${a2.x},${a2.y}`}
              fill={color}
              fillOpacity={0.06}
            />
          )}
          {form.middleLine && (
            <line
              x1={m1.x}
              y1={m1.y}
              x2={m2.x}
              y2={m2.y}
              stroke={color}
              strokeWidth={Math.max(1, stil.width - 0.5)}
              strokeDasharray="5 4"
              opacity={0.7}
            />
          )}
          {form.border && (
            <>
              <line x1={a1.x} y1={a1.y} x2={b1.x} y2={b1.y} stroke={color} strokeWidth={sw()} strokeLinecap="round" strokeDasharray={strich} />
              <line x1={a2.x} y1={a2.y} x2={b2.x} y2={b2.y} stroke={color} strokeWidth={sw()} strokeLinecap="round" strokeDasharray={strich} />
            </>
          )}
          {handles}
        </g>
      )
    }
    if (d.type === 'brush' && P.length >= 2) {
      const path = P.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
      return (
        <g key={d.id}>
          <path d={path} fill="none" stroke={color} strokeWidth={selected ? 2.5 : 1.8} strokeLinecap="round" strokeLinejoin="round" />
          {selected && (
            <>
              <circle cx={P[0].x} cy={P[0].y} r={4} fill={CHART_COLORS.foreground} stroke={color} />
              <circle cx={P[P.length - 1].x} cy={P[P.length - 1].y} r={4} fill={CHART_COLORS.foreground} stroke={color} />
            </>
          )}
        </g>
      )
    }
    if (istWelle(d.type) && P.length >= 2) {
      const labels = WAVE_LABELS[d.type]
      const col = d.style?.color ?? CHART_COLORS.foreground
      const path = P.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
      return (
        <g key={d.id}>
          <path d={path} fill="none" stroke={col} strokeWidth={selected ? 2 : 1.3} opacity={0.85} />
          {P.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y - 10} r={7} fill={CHART_COLORS.background} stroke={col} strokeWidth={selected ? 1.5 : 1} />
              <text x={p.x} y={p.y - 7} fill={col} fontSize={9} fontFamily="monospace" textAnchor="middle">
                {labels[i] ?? '?'}
              </text>
            </g>
          ))}
          {handles}
        </g>
      )
    }
    if (d.type === 'ellipse' && P.length >= 2) {
      return (
        <g key={d.id}>
          <ellipse
            cx={(P[0].x + P[1].x) / 2}
            cy={(P[0].y + P[1].y) / 2}
            rx={Math.abs(P[1].x - P[0].x) / 2}
            ry={Math.abs(P[1].y - P[0].y) / 2}
            fill={color}
            fillOpacity={0.08}
            stroke={color}
            strokeWidth={selected ? 2 : 1}
          />
          {handles}
        </g>
      )
    }
    if (d.type === 'rect' && P.length >= 2) {
      // Form nach TradingViews Rechteck-Dialog: Erweitern · Grenze · Mittlere
      // Linie · Hintergrund. Vorher war die Füllung fest verdrahtet — damit
      // ließ sich ein Rechteck weder als reine Zone noch als reiner Rahmen
      // benutzen.
      const ff = flaechenForm(d.type, d.style)
      const x1 = Math.min(P[0].x, P[1].x)
      const y1 = Math.min(P[0].y, P[1].y)
      const bw = Math.abs(P[1].x - P[0].x)
      const bh = Math.abs(P[1].y - P[0].y)
      // Verlängert wird waagerecht — eine Zone gilt ab ihrem Rand weiter, nicht
      // nach oben oder unten.
      const vx1 = ff.extend === 'left' || ff.extend === 'both' ? 0 : x1
      const vx2 = ff.extend === 'right' || ff.extend === 'both' ? width : x1 + bw
      return (
        <g key={d.id}>
          <rect
            x={vx1}
            y={y1}
            width={Math.max(0, vx2 - vx1)}
            height={bh}
            fill={ff.background ? color : 'none'}
            fillOpacity={ff.background ? 0.08 : 0}
            stroke={ff.border ? color : 'none'}
            strokeWidth={selected ? 2 : 1}
            strokeDasharray={strich}
          />
          {ff.middleLine && (
            <line x1={vx1} y1={y1 + bh / 2} x2={vx2} y2={y1 + bh / 2} stroke={color} strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
          )}
          {handles}
        </g>
      )
    }
    if (d.type === 'pricerange' && P.length >= 2) {
      return (
        <g key={d.id}>
          {renderRangeBox('box', P[0], P[1], d.points[0], d.points[1], 'price', selected)}
          {handles}
        </g>
      )
    }
    if (d.type === 'daterange' && P.length >= 2) {
      return (
        <g key={d.id}>
          {renderRangeBox('box', P[0], P[1], d.points[0], d.points[1], 'date', selected)}
          {handles}
        </g>
      )
    }
    if ((d.type === 'longpos' || d.type === 'shortpos') && P.length >= 3) {
      const long = d.type === 'longpos'
      const entry = d.points[0].price
      const stop = d.points[1].price
      const target = d.points[2].price
      const x1 = P[0].x
      const x2 = Math.max(P[1].x, P[2].x, P[0].x + 90)
      const entryY = P[0].y
      const stopY = P[1].y
      const targetY = P[2].y
      const risk = Math.abs(entry - stop)
      const reward = Math.abs(target - entry)
      const rr = risk > 0 ? reward / risk : 0
      return (
        <g key={d.id}>
          {/* Ziel-Zone (grün) */}
          <rect
            x={x1}
            y={Math.min(entryY, targetY)}
            width={x2 - x1}
            height={Math.abs(targetY - entryY)}
            fill={CHART_COLORS.up}
            opacity={0.14}
            stroke={CHART_COLORS.up}
            strokeWidth={selected ? 1.5 : 0.8}
          />
          {/* Risiko-Zone (rot) */}
          <rect
            x={x1}
            y={Math.min(entryY, stopY)}
            width={x2 - x1}
            height={Math.abs(stopY - entryY)}
            fill={CHART_COLORS.down}
            opacity={0.14}
            stroke={CHART_COLORS.down}
            strokeWidth={selected ? 1.5 : 0.8}
          />
          <line x1={x1} y1={entryY} x2={x2} y2={entryY} stroke={CHART_COLORS.foreground} strokeWidth={1} strokeDasharray="4 3" />
          <text x={x1 + 4} y={entryY - 3} fill={CHART_COLORS.foreground} fontSize={9} fontFamily="monospace">
            {long ? 'Long' : 'Short'} Entry {formatDe(entry)} · R:R {rr.toFixed(2)}
          </text>
          <text x={x1 + 4} y={targetY + (targetY < entryY ? 10 : -3)} fill={CHART_COLORS.up} fontSize={9} fontFamily="monospace">
            Target {formatDe(target)} ({formatDe(reward)})
          </text>
          <text x={x1 + 4} y={stopY + (stopY < entryY ? 10 : -3)} fill={CHART_COLORS.down} fontSize={9} fontFamily="monospace">
            Stop {formatDe(stop)} ({formatDe(risk)})
          </text>
          {handles}
        </g>
      )
    }
    if (d.type === 'fib' && P.length >= 2) {
      return renderFib(d, P, stil, {
        // TradingView-Konvention: 0 liegt am ZWEITEN Klick (dem Ende der
        // gemessenen Bewegung), 1 am ersten. Vorher war es umgekehrt — dann
        // steht „0,618" dort, wo der Trader 0,382 liest, und das Werkzeug
        // liefert bei jedem Retracement die falsche Marke. Die Formel selbst
        // (`fibLinien`) bleibt unberührt: Sie bildet immer von → 0 und
        // bis → 1 ab; welcher Klick welcher ist, entscheidet der Aufrufer.
        von: d.points[1].price,
        bis: d.points[0].price,
        linkeKante: Math.min(P[0].x, P[1].x),
        rechteKante: Math.max(P[0].x, P[1].x),
        basis: null,
        handles,
      })
    }
    if (d.type === 'fibext' && P.length >= 3) {
      const [a, b, c] = [d.points[0].price, d.points[1].price, d.points[2].price]
      return renderFib(d, P, stil, {
        // Ursprung C, Spanne B−A — dieselbe Formel wie beim Retracement,
        // siehe `lib/fib-levels.ts`.
        von: c,
        bis: c + (b - a),
        linkeKante: P[2].x,
        rechteKante: P[2].x,
        basis: (
          <>
            <line x1={P[0].x} y1={P[0].y} x2={P[1].x} y2={P[1].y} stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.55} />
            <line x1={P[1].x} y1={P[1].y} x2={P[2].x} y2={P[2].y} stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.55} />
          </>
        ),
        handles,
      })
    }
    if (d.type === 'text') {
      return (
        <g key={d.id}>
          <text x={P[0].x} y={P[0].y} fill={d.style?.color ?? CHART_COLORS.foreground} fontSize={11} fontFamily="monospace" textAnchor="middle">
            {d.points[0].text ?? ''}
          </text>
          {selected && (
            <rect x={P[0].x - 42} y={P[0].y - 14} width={84} height={20} fill="none" stroke={CHART_COLORS.accent} strokeDasharray="3 2" />
          )}
        </g>
      )
    }

    // ---- Werkzeuge aus dem TradingView-Satz, die bis hierher fehlten --------

    if (d.type === 'hray') {
      // Vom Punkt nach RECHTS — der Unterschied zur waagerechten Linie ist,
      // dass sie die Vergangenheit nicht behauptet.
      return (
        <g key={d.id}>
          <line x1={P[0].x} y1={P[0].y} x2={width} y2={P[0].y} stroke={color} strokeWidth={sw(1)} strokeDasharray={strich} />
          <text x={P[0].x + 4} y={P[0].y - 4} fill={color} fontSize={10} fontFamily="monospace">
            {d.style?.label ?? formatDe(d.points[0].price, 6)}
          </text>
          {handles}
        </g>
      )
    }

    if (d.type === 'crossline') {
      return (
        <g key={d.id}>
          <line x1={0} y1={P[0].y} x2={width} y2={P[0].y} stroke={color} strokeWidth={sw(1)} strokeDasharray={strich} opacity={0.9} />
          <line x1={P[0].x} y1={0} x2={P[0].x} y2={height} stroke={color} strokeWidth={sw(1)} strokeDasharray={strich} opacity={0.9} />
          <text x={P[0].x + 4} y={P[0].y - 4} fill={color} fontSize={10} fontFamily="monospace">
            {d.style?.label ?? formatDe(d.points[0].price, 6)}
          </text>
          {handles}
        </g>
      )
    }

    if (d.type === 'trendangle' && P.length >= 2) {
      // Der Winkel wird in PIXELN gemessen, nicht in Kurs je Zeit — genau wie
      // bei TradingView. Ein Winkel in Dateneinheiten hätte keine Bedeutung:
      // Er hinge am Zoom, und 45° wären je nach Ausschnitt etwas anderes.
      const dx = P[1].x - P[0].x
      const dy = P[1].y - P[0].y
      const grad = (-Math.atan2(dy, dx) * 180) / Math.PI
      const r = 34
      const ende = { x: P[0].x + Math.min(r, Math.abs(dx) || r) * Math.sign(dx || 1), y: P[0].y }
      return (
        <g key={d.id}>
          <line x1={P[0].x} y1={P[0].y} x2={P[1].x} y2={P[1].y} stroke={color} strokeWidth={sw(1.5)} strokeDasharray={strich} />
          {/* Die Waagerechte als Bezug — ohne sie ist nicht zu sehen, wogegen
              gemessen wird. */}
          <line x1={P[0].x} y1={P[0].y} x2={ende.x} y2={ende.y} stroke={color} strokeWidth={0.8} strokeDasharray="3 3" opacity={0.6} />
          <text x={P[0].x + (dx >= 0 ? 8 : -8)} y={P[0].y - 8} fill={color} fontSize={10} fontFamily="monospace" textAnchor={dx >= 0 ? 'start' : 'end'}>
            {grad.toFixed(1)}°
          </text>
          {handles}
        </g>
      )
    }

    if (d.type === 'fibfan' && P.length >= 2) {
      const [a, b] = P
      return (
        <g key={d.id}>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
          {FIB_FAN.map((r) => {
            const ziel = { x: b.x, y: a.y + (b.y - a.y) * r }
            const e = extendRay(a, ziel)
            return (
              <g key={r}>
                <line x1={a.x} y1={a.y} x2={e.x} y2={e.y} stroke={color} strokeWidth={sw(1)} strokeDasharray={strich} opacity={0.85} />
                <text x={ziel.x + 3} y={ziel.y - 2} fill={color} fontSize={9} fontFamily="monospace" opacity={0.85}>
                  {r}
                </text>
              </g>
            )
          })}
          {handles}
        </g>
      )
    }

    if (d.type === 'fibtime' && P.length >= 2) {
      const dx = P[1].x - P[0].x
      return (
        <g key={d.id}>
          {FIB_TIME.map((f) => {
            const x = P[0].x + dx * f
            // Was aus dem Bild läuft, wird nicht gezeichnet — sonst stünden bei
            // einem kleinen Grundabstand vierzig Linien übereinander am Rand.
            if (x < -2 || x > width + 2) return null
            return (
              <g key={f}>
                <line x1={x} y1={0} x2={x} y2={height} stroke={color} strokeWidth={sw(1)} strokeDasharray={strich} opacity={0.75} />
                <text x={x + 3} y={12} fill={color} fontSize={9} fontFamily="monospace" opacity={0.85}>
                  {f}
                </text>
              </g>
            )
          })}
          {handles}
        </g>
      )
    }

    if (d.type === 'fibcircle' && P.length >= 2) {
      // Ellipsen statt Kreisen: Waagerecht zählt Zeit, senkrecht Preis — ein
      // echter Kreis in Pixeln wäre in den Daten keiner.
      const rx = Math.abs(P[1].x - P[0].x)
      const ry = Math.abs(P[1].y - P[0].y)
      return (
        <g key={d.id}>
          {FIB_CIRCLE.map((r) => (
            <ellipse key={r} cx={P[0].x} cy={P[0].y} rx={rx * r} ry={ry * r} fill="none" stroke={color} strokeWidth={sw(1)} strokeDasharray={strich} opacity={0.8} />
          ))}
          <line x1={P[0].x} y1={P[0].y} x2={P[1].x} y2={P[1].y} stroke={color} strokeWidth={1} opacity={0.5} />
          {handles}
        </g>
      )
    }

    if (d.type === 'gannbox' && P.length >= 2) {
      const x1 = Math.min(P[0].x, P[1].x)
      const x2 = Math.max(P[0].x, P[1].x)
      const y1 = Math.min(P[0].y, P[1].y)
      const y2 = Math.max(P[0].y, P[1].y)
      const bw = x2 - x1
      const bh = y2 - y1
      return (
        <g key={d.id}>
          <rect x={x1} y={y1} width={bw} height={bh} fill={color} fillOpacity={0.05} stroke={color} strokeWidth={sw(1)} />
          {GANN_TEILE.map((f) => (
            <g key={f}>
              <line x1={x1} y1={y1 + bh * f} x2={x2} y2={y1 + bh * f} stroke={color} strokeWidth={0.8} strokeDasharray="3 3" opacity={0.55} />
              <line x1={x1 + bw * f} y1={y1} x2={x1 + bw * f} y2={y2} stroke={color} strokeWidth={0.8} strokeDasharray="3 3" opacity={0.55} />
            </g>
          ))}
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={1} opacity={0.7} />
          <line x1={x1} y1={y2} x2={x2} y2={y1} stroke={color} strokeWidth={1} opacity={0.7} />
          {handles}
        </g>
      )
    }

    if (d.type === 'pitchfork' && P.length >= 3) {
      // Reihenfolge der Punkte: Die Ziehbewegung setzt die Basis B→C, der
      // dritte Klick den Scheitel A (siehe TOOL_SPECS).
      const B = P[0]
      const C = P[1]
      const A = P[2]
      const M = { x: (B.x + C.x) / 2, y: (B.y + C.y) / 2 }
      const mEnd = extendRay(A, M)
      const dx = mEnd.x - A.x
      const dy = mEnd.y - A.y
      return (
        <g key={d.id}>
          <line x1={B.x} y1={B.y} x2={C.x} y2={C.y} stroke={color} strokeWidth={sw(1)} opacity={0.7} />
          <line x1={A.x} y1={A.y} x2={mEnd.x} y2={mEnd.y} stroke={color} strokeWidth={sw(1.6)} />
          <line x1={B.x} y1={B.y} x2={B.x + dx} y2={B.y + dy} stroke={color} strokeWidth={sw(1)} strokeDasharray={strich} opacity={0.9} />
          <line x1={C.x} y1={C.y} x2={C.x + dx} y2={C.y + dy} stroke={color} strokeWidth={sw(1)} strokeDasharray={strich} opacity={0.9} />
          {handles}
        </g>
      )
    }

    if (d.type === 'xabcd' && P.length >= 2) {
      const pfad = P.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
      return (
        <g key={d.id}>
          <path d={pfad} fill="none" stroke={color} strokeWidth={sw(1.6)} strokeDasharray={strich} />
          {/* Die beiden Sehnen X–B und A–C: an ihnen liest man die Verhältnisse
              ab, um die es beim harmonischen Muster überhaupt geht. */}
          {P.length >= 3 && (
            <line x1={P[0].x} y1={P[0].y} x2={P[2].x} y2={P[2].y} stroke={color} strokeWidth={0.8} strokeDasharray="3 3" opacity={0.55} />
          )}
          {P.length >= 4 && (
            <line x1={P[1].x} y1={P[1].y} x2={P[3].x} y2={P[3].y} stroke={color} strokeWidth={0.8} strokeDasharray="3 3" opacity={0.55} />
          )}
          {P.length >= 5 && (
            <line x1={P[2].x} y1={P[2].y} x2={P[4].x} y2={P[4].y} stroke={color} strokeWidth={0.8} strokeDasharray="3 3" opacity={0.55} />
          )}
          {P.map((p, i) => (
            <text key={i} x={p.x + 4} y={p.y - 4} fill={color} fontSize={10} fontFamily="monospace" fontWeight="bold">
              {XABCD_LABELS[i] ?? ''}
            </text>
          ))}
          {handles}
        </g>
      )
    }

    if (d.type === 'headshoulders' && P.length >= 2) {
      const pfad = P.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
      // Die Nackenlinie durch die beiden Täler ist der eigentliche Inhalt des
      // Musters — an ihr hängt der Bruch, nicht am Kopf.
      const nacken = P.length >= 5 ? extendRay(P[2], P[4]) : null
      return (
        <g key={d.id}>
          <path d={pfad} fill="none" stroke={color} strokeWidth={sw(1.6)} strokeDasharray={strich} />
          {nacken && (
            <line x1={P[2].x} y1={P[2].y} x2={nacken.x} y2={nacken.y} stroke={color} strokeWidth={sw(1.2)} strokeDasharray="5 3" opacity={0.9} />
          )}
          {P.map((p, i) =>
            HS_LABELS[i] ? (
              <text key={i} x={p.x} y={p.y - 6} fill={color} fontSize={10} fontFamily="monospace" fontWeight="bold" textAnchor="middle">
                {HS_LABELS[i]}
              </text>
            ) : null,
          )}
          {handles}
        </g>
      )
    }

    if (d.type === 'pricelabel') {
      const txt = d.style?.label ?? formatDe(d.points[0].price, 6)
      const bw = txt.length * 6.2 + 12
      return (
        <g key={d.id}>
          <line x1={P[0].x} y1={P[0].y} x2={P[0].x + 10} y2={P[0].y} stroke={color} strokeWidth={sw(1)} />
          <rect x={P[0].x + 10} y={P[0].y - 9} width={bw} height={18} rx={3} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={sw(1)} />
          <text x={P[0].x + 16} y={P[0].y + 4} fill={color} fontSize={10} fontFamily="monospace">
            {txt}
          </text>
          {handles}
        </g>
      )
    }

    if (d.type === 'marker') {
      const x = P[0].x
      const y = P[0].y
      return (
        <g key={d.id}>
          <line x1={x} y1={y} x2={x} y2={y - 20} stroke={color} strokeWidth={sw(1.4)} />
          <path d={`M${x},${y - 20} L${x + 15},${y - 15.5} L${x},${y - 11} Z`} fill={color} />
          <circle cx={x} cy={y} r={2.5} fill={color} />
          {handles}
        </g>
      )
    }

    if (d.type === 'callout') {
      const txt = d.points[0].text ?? ''
      const bw = Math.max(44, txt.length * 6.2 + 14)
      const bx = P[0].x + 14
      const by = P[0].y - 38
      return (
        <g key={d.id}>
          <path d={`M${P[0].x},${P[0].y} L${bx},${by + 24} L${bx + 10},${by + 15}`} fill="none" stroke={color} strokeWidth={sw(1)} />
          <rect x={bx} y={by} width={bw} height={22} rx={4} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={sw(1)} />
          <text x={bx + 7} y={by + 15} fill={CHART_COLORS.foreground} fontSize={10} fontFamily="monospace">
            {txt}
          </text>
          {handles}
        </g>
      )
    }

    return null
  }

  const renderPending = () => {
    // Brush-Vorschau während des Ziehens
    if (tool === 'brush' && brushPts && brushPts.length >= 2) {
      const P = brushPts.map(toPx).filter((p): p is Pt => p != null)
      const path = P.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
      return <path d={path} fill="none" stroke={CHART_COLORS.accent} strokeWidth={1.8} strokeLinecap="round" />
    }

    // Die Vorschau folgt jetzt derselben Quelle wie das Anlegen. Vorher hing
    // sie allein an `pending` — beim Aufziehen in einer Geste steht dort aber
    // noch nichts, und man hätte blind gezogen.
    const V = vorschauPunkte(tool, pending, zug?.start ?? null, hoverPoint, zug?.gezogen ?? false)
    if (V.length < 2) return null
    const P = V.map(toPx)
    if (P.some((p) => p == null)) return null
    const Q = P as Pt[]
    const a = Q[Q.length - 2]
    const b = Q[Q.length - 1]

    if (tool === 'rect' || tool === 'pricerange' || tool === 'daterange') {
      return (
        <rect
          x={Math.min(a.x, b.x)}
          y={Math.min(a.y, b.y)}
          width={Math.abs(b.x - a.x)}
          height={Math.abs(b.y - a.y)}
          fill={CHART_COLORS.accent}
          fillOpacity={0.08}
          stroke={CHART_COLORS.accent}
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      )
    }
    if (tool === 'ellipse') {
      return (
        <ellipse
          cx={(a.x + b.x) / 2}
          cy={(a.y + b.y) / 2}
          rx={Math.abs(b.x - a.x) / 2}
          ry={Math.abs(b.y - a.y) / 2}
          fill={CHART_COLORS.accent}
          fillOpacity={0.08}
          stroke={CHART_COLORS.accent}
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      )
    }
    if (tool === 'channel' && Q.length === 3) {
      const off = channelOffset(Q)
      return (
        <g>
          <line x1={Q[0].x} y1={Q[0].y} x2={Q[1].x} y2={Q[1].y} stroke={CHART_COLORS.accent} strokeWidth={1} strokeDasharray="4 3" />
          <line x1={Q[0].x} y1={Q[0].y + off} x2={Q[1].x} y2={Q[1].y + off} stroke={CHART_COLORS.accent} strokeWidth={1} strokeDasharray="4 3" />
        </g>
      )
    }
    // Mehrpunkt-Werkzeuge (Elliott, Fib-Ext, Kanal-Basis): Polyline-Vorschau
    if (Q.length > 2 || tool === 'ew_impulse' || tool === 'ew_correction' || tool === 'fibext' || tool === 'channel') {
      const path = Q.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
      return <path d={path} fill="none" stroke={CHART_COLORS.accent} strokeWidth={1} strokeDasharray="4 3" />
    }
    const end = tool === 'ray' ? extendRay(a, b) : b
    return <line x1={a.x} y1={a.y} x2={end.x} y2={end.y} stroke={CHART_COLORS.accent} strokeWidth={1} strokeDasharray="4 3" />
  }

  /**
   * Kurs-Etiketten an der Preisachse, solange gezeichnet wird.
   *
   * Abgeschaut bei TradingView: Dort werden beim Ziehen einer Linie der
   * Startpreis UND der Preis unter dem Zeiger an der Achse hervorgehoben. Ohne
   * das zieht man auf gut Glück und liest den Kurs erst hinterher ab — was
   * genau der Grund ist, warum man einen Stop lieber abtippt, statt ihn zu
   * setzen. Die gestrichelte Hilfslinie zeigt dazu die Höhe über die ganze
   * Breite.
   */
  const renderVorschauAchsen = () => {
    const punkte = [zug?.start, hoverPoint].filter(
      (p): p is DrawingPoint => p != null && istZeichenwerkzeug(tool),
    )
    if (punkte.length === 0 || width === 0) return null
    // Der Startpunkt ist beim reinen Überfahren noch keiner — dann steht nur
    // der Zeigerpreis da.
    const gesehen = new Set<number>()
    return (
      <g style={{ pointerEvents: 'none' }}>
        {/* Die Zeitachse trägt dasselbe Etikett — auch das ist aus TradingView
            übernommen (dort erscheinen beim Ziehen BEIDE Achsen-Etiketten).
            Ohne die Zeit weiß man beim Setzen eines Punktes in die Zukunft
            nicht, wo man landet; die Balken sind an der Achse nicht zählbar.
            Nur der Zeigerpunkt, nicht der Startpunkt: zwei Etiketten auf einer
            schmalen Achse überlappen sich. */}
        {(() => {
          const p = hoverPoint ?? zug?.start
          const px = p ? toPx(p) : null
          if (!p || !px || achsenHoehe <= 2) return null
          const txt = zeitEtikett(p.time, step)
          const bw = txt.length * 6.4 + 10
          const bx = Math.max(0, Math.min(px.x - bw / 2, width - achsenBreite - bw))
          const by = height - achsenHoehe + 2
          return (
            <g>
              <line
                x1={px.x}
                y1={0}
                x2={px.x}
                y2={height - achsenHoehe}
                stroke={CHART_COLORS.accent}
                strokeWidth={0.8}
                strokeDasharray="3 4"
                opacity={0.55}
              />
              <rect x={bx} y={by} width={bw} height={17} rx={3} fill={CHART_COLORS.accent} />
              <text
                x={bx + bw / 2}
                y={by + 12}
                fill={CHART_COLORS.background}
                fontSize={10}
                fontFamily="monospace"
                textAnchor="middle"
              >
                {txt}
              </text>
            </g>
          )
        })()}
        {punkte.map((p, i) => {
          if (gesehen.has(p.price)) return null
          gesehen.add(p.price)
          const px = toPx(p)
          if (!px) return null
          const txt = formatDe(p.price, 4)
          const bw = txt.length * 6.4 + 10
          const x = Math.max(0, width - achsenBreite - bw - 2)
          return (
            <g key={i}>
              <line
                x1={0}
                y1={px.y}
                x2={width - achsenBreite}
                y2={px.y}
                stroke={CHART_COLORS.accent}
                strokeWidth={0.8}
                strokeDasharray="3 4"
                opacity={i === 0 ? 0.45 : 0.75}
              />
              <rect x={x} y={px.y - 9} width={bw} height={18} rx={3} fill={CHART_COLORS.accent} opacity={i === 0 ? 0.7 : 1} />
              <text x={x + bw / 2} y={px.y + 4} fill={CHART_COLORS.background} fontSize={10} fontFamily="monospace" textAnchor="middle">
                {txt}
              </text>
            </g>
          )
        })}
      </g>
    )
  }

  const renderMeasure = () => {
    if (!measure?.b) return null
    const a = toPx(measure.a)
    const b = toPx(measure.b)
    if (!a || !b) return null
    return renderRangeBox('measure', a, b, measure.a, measure.b, 'price')
  }

  /**
   * Wie breit die unsichtbare Greifzone um eine Zeichnung ist.
   *
   * Sie ist der Kern des Umbaus. Vorher gab es sie nicht, und daraus folgten
   * zwei Übel, die sich gegenseitig bedingten:
   *
   * 1. **Ohne Auswahl war die ganze Ebene durchlässig** (`pointerEvents:
   *    'none'`), damit Pan und Zoom des Charts funktionieren. Damit kam nie ein
   *    Zeigerereignis an — kein Überfahren, keine Anfasser, keine Rückmeldung.
   *    Ausgewählt wurde über einen Umweg-Listener am Elternknoten, der erst
   *    beim `click` feuert.
   * 2. **Mit Auswahl lag die Ebene über dem GANZEN Chart** und schluckte alles.
   *    Solange etwas ausgewählt war, ließ sich der Chart nicht mehr schieben.
   *
   * Jetzt ist das SVG im Auswahl-Modus durchlässig und nur diese Zonen fangen
   * Ereignisse: Über einer Zeichnung gehört der Zeiger der Zeichnung, daneben
   * dem Chart. Genau so verhält sich TradingView.
   */
  const HIT_ZONE = 20

  const zonenEreignisse = (id: number) => ({
    onPointerEnter: () => setHoverId(id),
    onPointerLeave: () => setHoverId((h) => (h === id ? null : h)),
  })

  /** Die unsichtbare Greifzone einer Zeichnung. */
  const renderHitZone = (d: Drawing) => {
    const pts = d.points.map(toPx)
    if (pts.some((p) => p == null)) return null
    const P = pts as Pt[]
    const strich = {
      fill: 'none',
      stroke: 'transparent',
      strokeWidth: HIT_ZONE,
      strokeLinejoin: 'round' as const,
      strokeLinecap: 'round' as const,
      style: { pointerEvents: 'stroke' as const, cursor: locked ? 'pointer' : 'move' },
      ...zonenEreignisse(d.id),
    }

    if (d.type === 'hline') {
      return <line key={`z${d.id}`} {...strich} x1={0} y1={P[0].y} x2={width} y2={P[0].y} />
    }
    if (d.type === 'hray') {
      return <line key={`z${d.id}`} {...strich} x1={P[0].x} y1={P[0].y} x2={width} y2={P[0].y} />
    }
    if (d.type === 'vline') {
      return <line key={`z${d.id}`} {...strich} x1={P[0].x} y1={0} x2={P[0].x} y2={height} />
    }
    if (d.type === 'crossline') {
      // Beide Achsen greifbar — sonst fasst man die senkrechte Hälfte nie an.
      return (
        <g key={`z${d.id}`}>
          <line {...strich} x1={0} y1={P[0].y} x2={width} y2={P[0].y} />
          <line {...strich} x1={P[0].x} y1={0} x2={P[0].x} y2={height} />
        </g>
      )
    }
    if (istLinienTyp(d.type) && P.length >= 2) {
      // Dieselbe Form wie beim Zeichnen und beim Treffertest.
      const { von, bis } = linienEnden(
        P[0],
        P[1],
        linienForm(d.type, d.style).extend,
        (q, r) => extendRay(q, r),
      )
      return <line key={`z${d.id}`} {...strich} x1={von.x} y1={von.y} x2={bis.x} y2={bis.y} />
    }
    // Flächige Werkzeuge: überall hineinfassen können, nicht nur am Rand.
    if (
      d.type === 'rect' ||
      d.type === 'ellipse' ||
      d.type === 'pricerange' ||
      d.type === 'daterange' ||
      d.type === 'longpos' ||
      d.type === 'shortpos' ||
      d.type === 'fib' ||
      d.type === 'fibext'
    ) {
      const xs = P.map((p) => p.x)
      const ys = P.map((p) => p.y)
      const x1 = Math.min(...xs) - 6
      const y1 = Math.min(...ys) - 6
      return (
        <rect
          key={`z${d.id}`}
          x={x1}
          y={y1}
          width={Math.max(...xs) - Math.min(...xs) + 12}
          height={Math.max(...ys) - Math.min(...ys) + 12}
          fill="transparent"
          stroke="none"
          style={{ pointerEvents: 'all', cursor: locked ? 'pointer' : 'move' }}
          {...zonenEreignisse(d.id)}
        />
      )
    }
    // Alles Übrige ist ein Streckenzug (Trendlinie, Pfeil, Kanal, Freihand,
    // Wellenzüge, Text-Anker).
    const pfad = P.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(
      ' ',
    )
    return <path key={`z${d.id}`} {...strich} d={pfad} />
  }

  /**
   * Fängt die Ebene selbst Ereignisse ab?
   *
   * Beim Zeichnen ja — dort gehört jeder Punkt des Charts dem Werkzeug. Im
   * Auswahl-Modus nein: Dort entscheiden die Greifzonen oben, und der Chart
   * bleibt schiebbar.
   */
  const interactive = tool !== 'cursor'

  return (
    <>
      <svg
        ref={svgRef}
        className="absolute inset-0 z-10 h-full w-full"
        style={{
          pointerEvents: interactive ? 'auto' : 'none',
          cursor:
            tool === 'cursor' ? 'default' : tool === 'eraser' ? ERASER_CURSOR : 'crosshair',
          // Preisachse rechts und Zeitachse unten nicht überdecken — sonst
          // liegt die Zeichenebene darüber und schluckt die Klicks, mit denen
          // man die Achsen zieht. Genau daran scheiterte das Zoomen auf der
          // PREISSKALA: Hier stand vorher ein fester Wert von 70 px, die Achse
          // ist bei langen Kursen (63.533,80) aber breiter — der Rest lag unter
          // dem SVG und ließ sich nicht anfassen. Deshalb werden die echten
          // Maße beim Chart erfragt, nicht geschätzt.
          clipPath: `inset(0 ${achsenBreite}px ${achsenHoehe}px 0)`,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          // Sonst bliebe das Achsen-Etikett am letzten Ort stehen und
          // behauptete einen Kurs, auf den niemand mehr zeigt. Während einer
          // laufenden Geste oder eines offenen Mehrpunkt-Werkzeugs bleibt es —
          // dort gehört der Punkt zur Zeichnung, nicht zum Zeiger.
          if (!zug && pending.length === 0) setHoverPoint(null)
        }}
        onContextMenu={(e) => {
          // Nur über einer Zeichnung — sonst gehört das Rechtsklick-Menü dem
          // Browser, und man käme im Chart nicht mehr an „Bild speichern".
          const r = svgRef.current!.getBoundingClientRect()
          const treffer = hitTest(e.clientX - r.left, e.clientY - r.top) ?? hoverId
          if (treffer == null) return
          e.preventDefault()
          onSelect(treffer)
          setKontext({ id: treffer, x: e.clientX, y: e.clientY })
        }}
      >
        {drawings.map(renderDrawing)}
        {/* Die Greifzonen liegen ÜBER den Zeichnungen, damit die oberste
            Zeichnung auch die ist, die man anfasst — und sie sind die einzigen
            Elemente, die im Auswahl-Modus Ereignisse fangen. */}
        {tool === 'cursor' && <g>{drawings.map(renderHitZone)}</g>}
        {renderPending()}
        {renderVorschauAchsen()}
        {renderMeasure()}
        {height > 0 && null}
      </svg>
      {textInput && (
        <input
          autoFocus
          className="input-ocean absolute z-20 h-7 w-40 rounded px-2 font-mono text-xs"
          style={{ left: textInput.px.x - 80, top: textInput.px.y - 14 }}
          placeholder="Notiz + Enter"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const value = (e.target as HTMLInputElement).value.trim()
              if (value) {
                onCreate(tool === 'callout' ? 'callout' : 'text', [
                  { ...textInput.point, text: value },
                ])
              }
              setTextInput(null)
              if (!werkzeugBleibt(tool, keepTool)) onToolDone()
            }
            if (e.key === 'Escape') setTextInput(null)
          }}
          onBlur={() => setTextInput(null)}
        />
      )}

      {/* Rechtsklick-Menü — nachgebaut nach TradingViews Kontextmenü an einer
          Zeichnung (Einstellungen · Klon · Sperren · Entfernen).

          Es hängt am <body> und trägt `position` INLINE. Beides ist nötig, und
          beides hat in diesem Projekt schon einmal Zeit gekostet:
          (1) `.rise-in` lässt am Panel ein `transform: matrix(1,0,0,1,0,0)`
              stehen — ein Element mit transform ist der Bezugsrahmen für
              `fixed`, das Menü richtete sich also nach dem Panel statt nach dem
              Fenster.
          (2) `body > * { position: relative }` in globals.css liegt außerhalb
              der Tailwind-Layer und schlägt die Utility `.fixed` unabhängig von
              der Spezifität. */}
      {kontext &&
        createPortal(
          <>
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 59 }}
              onPointerDown={() => setKontext(null)}
              onContextMenu={(e) => {
                e.preventDefault()
                setKontext(null)
              }}
              aria-hidden
            />
            <div
              className="panel-raised flex w-52 flex-col gap-0.5 p-1.5"
              style={{
                position: 'fixed',
                zIndex: 60,
                // Am rechten und unteren Rand einklappen, sonst läuft das Menü
                // aus dem Bild.
                left: Math.min(kontext.x, window.innerWidth - 220),
                top: Math.min(kontext.y, window.innerHeight - 190),
              }}
            >
              {[
                {
                  label: 'Einstellungen …',
                  hint: '',
                  aktion: () => onOpenStyle?.(kontext.id),
                  aus: !onOpenStyle,
                },
                {
                  label: 'Klonen',
                  hint: 'Strg+D',
                  aktion: () => onClone?.(kontext.id),
                  aus: !onClone || locked,
                },
                {
                  label: locked ? 'Zeichnungen entsperren' : 'Zeichnungen sperren',
                  hint: '',
                  aktion: () => onLockedChange?.(!locked),
                  aus: !onLockedChange,
                },
              ]
                .filter((e) => !e.aus)
                .map((e) => (
                  <button
                    key={e.label}
                    type="button"
                    className="flex h-7 items-center justify-between rounded px-2 text-left font-mono text-[11px] hover:bg-muted"
                    onClick={() => {
                      e.aktion()
                      setKontext(null)
                    }}
                  >
                    <span>{e.label}</span>
                    {e.hint && <span className="opacity-50">{e.hint}</span>}
                  </button>
                ))}
              <div className="my-0.5 h-px bg-border" />
              <button
                type="button"
                className="flex h-7 items-center justify-between rounded px-2 text-left font-mono text-[11px] text-destructive hover:bg-muted disabled:opacity-40"
                disabled={locked}
                onClick={() => {
                  onDelete?.(kontext.id)
                  onSelect(null)
                  setKontext(null)
                }}
              >
                <span>Entfernen</span>
                <span className="opacity-50">Entf</span>
              </button>
            </div>
          </>,
          document.body,
        )}
    </>
  )
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  let t = lenSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}
