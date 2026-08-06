'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BarPrice, IChartApi, ISeriesApi, Logical, SeriesType } from 'lightweight-charts'
import type { Drawing, DrawingPoint } from '@/app/actions/drawings'
import type { Candle } from '@/lib/market-data/types'
import type { DrawTool } from './chart-toolbar'
import { CHART_COLORS } from './colors'
import { barStep, istProjektion, logicalToTime, snapTime, timeToLogical } from '@/lib/chart-coords'
import { preisachsenBreite } from './axis-dom'
import { DEFAULT_FIB, DEFAULT_FIBEXT, fibLinien, normalizeFibStil } from '@/lib/fib-levels'
import { normalizeDrawingStyle, strichArray } from '@/lib/drawing-style'

const WAVE_LABELS: Record<'ew_impulse' | 'ew_correction', string[]> = {
  ew_impulse: ['0', '1', '2', '3', '4', '5'],
  ew_correction: ['0', 'A', 'B', 'C'],
}

/** Tools mit 2 Klick-Punkten. */
const TWO_POINT: DrawTool[] = [
  'trendline',
  'ray',
  'rect',
  'fib',
  'ellipse',
  'arrow',
  'pricerange',
  'daterange',
]
/** Tools mit 3 Klick-Punkten. */
const THREE_POINT: DrawTool[] = ['channel', 'fibext']

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
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  // Der Zähler wird nicht nur zum Neurendern gebraucht, sondern auch als
  // Abhängigkeit der Achsenmessung weiter unten — deshalb steht er hier mit
  // Namen und nicht als weggeworfener erster Wert.
  const [tick, setTick] = useState(0)
  const [pending, setPending] = useState<DrawingPoint[]>([])
  const [hoverPoint, setHoverPoint] = useState<DrawingPoint | null>(null)
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
        } else if (d.type === 'vline') {
          if (Math.abs(P[0].x - x) < SELECT_TOLERANCE) return d.id
        } else if ((d.type === 'trendline' || d.type === 'arrow') && P.length >= 2) {
          if (distToSegment({ x, y }, P[0], P[1]) < SELECT_TOLERANCE) return d.id
        } else if (d.type === 'ray' && P.length >= 2) {
          if (distToSegment({ x, y }, P[0], extendRay(P[0], P[1])) < SELECT_TOLERANCE) return d.id
        } else if (d.type === 'channel' && P.length >= 3) {
          const off = channelOffset(P)
          if (
            distToSegment({ x, y }, P[0], P[1]) < SELECT_TOLERANCE ||
            distToSegment(
              { x, y },
              { x: P[0].x, y: P[0].y + off },
              { x: P[1].x, y: P[1].y + off },
            ) < SELECT_TOLERANCE
          ) {
            return d.id
          }
        } else if (d.type === 'brush' && P.length >= 2) {
          for (let i = 1; i < P.length; i++) {
            if (distToSegment({ x, y }, P[i - 1], P[i]) < SELECT_TOLERANCE) return d.id
          }
        } else if ((d.type === 'ew_impulse' || d.type === 'ew_correction') && P.length >= 2) {
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
    [drawings, toPx, extendRay, series],
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
      const hit = hitTest(x, y)
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

    if (tool === 'hline' || tool === 'vline') {
      onCreate(tool, [point])
      onToolDone()
    } else if (TWO_POINT.includes(tool)) {
      if (pending.length === 0) {
        setPending([point])
      } else {
        onCreate(tool as Drawing['type'], [pending[0], point])
        setPending([])
        onToolDone()
      }
    } else if (THREE_POINT.includes(tool)) {
      const next = [...pending, point]
      if (next.length < 3) {
        setPending(next)
      } else {
        onCreate(tool as Drawing['type'], next)
        setPending([])
        onToolDone()
      }
    } else if (tool === 'ew_impulse' || tool === 'ew_correction') {
      const need = WAVE_LABELS[tool].length
      const next = [...pending, point]
      if (next.length < need) {
        setPending(next)
      } else {
        onCreate(tool, next)
        setPending([])
        onToolDone()
      }
    } else if (tool === 'brush') {
      setBrushPts([point])
      svgRef.current!.setPointerCapture(e.pointerId)
    } else if (tool === 'longpos' || tool === 'shortpos') {
      createPosition(point, tool === 'longpos')
    } else if (tool === 'text') {
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
    } else if (tool === 'measure' && measure && !measure.frozen) {
      setMeasure({ ...measure, b: fromPx(x, y), frozen: false })
    }
  }

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragRef.current) {
      svgRef.current!.releasePointerCapture(e.pointerId)
      dragRef.current = null
    }
    if (tool === 'brush' && brushPts) {
      svgRef.current!.releasePointerCapture(e.pointerId)
      if (brushPts.length >= 2) onCreate('brush', brushPts)
      setBrushPts(null)
      onToolDone()
    }
  }

  // Escape bricht ab, Werkzeugwechsel räumt auf.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPending([])
        setHoverPoint(null)
        setMeasure(null)
        setTextInput(null)
        setBrushPts(null)
        onSelect(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSelect])

  useEffect(() => {
    setPending([])
    setHoverPoint(null)
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
              strokeDasharray={strichArray(stil.dashed)}
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
      d.type === 'fib' || d.type === 'fibext' ? CHART_COLORS.warning : CHART_COLORS.accent,
    )
    const color = stil.color
    const strich = strichArray(stil.dashed)
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
          <line x1={0} y1={P[0].y} x2={width} y2={P[0].y} stroke={color} strokeWidth={selected ? 2 : 1} strokeDasharray={d.style?.dashed ? '4 3' : undefined} />
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
          <line x1={P[0].x} y1={0} x2={P[0].x} y2={height} stroke={color} strokeWidth={selected ? 2 : 1} strokeDasharray={d.style?.dashed ? '4 3' : undefined} />
          {handles}
        </g>
      )
    }
    if (d.type === 'trendline') {
      return (
        <g key={d.id}>
          <line x1={P[0].x} y1={P[0].y} x2={P[1].x} y2={P[1].y} stroke={color} strokeWidth={selected ? 2 : 1.5} strokeDasharray={d.style?.dashed ? '4 3' : undefined} />
          {handles}
        </g>
      )
    }
    if (d.type === 'arrow' && P.length >= 2) {
      const angle = Math.atan2(P[1].y - P[0].y, P[1].x - P[0].x)
      const size = 9
      const tip = P[1]
      const left = {
        x: tip.x - size * Math.cos(angle - Math.PI / 7),
        y: tip.y - size * Math.sin(angle - Math.PI / 7),
      }
      const right = {
        x: tip.x - size * Math.cos(angle + Math.PI / 7),
        y: tip.y - size * Math.sin(angle + Math.PI / 7),
      }
      return (
        <g key={d.id}>
          <line x1={P[0].x} y1={P[0].y} x2={P[1].x} y2={P[1].y} stroke={color} strokeWidth={selected ? 2 : 1.5} />
          <polygon points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`} fill={color} />
          {handles}
        </g>
      )
    }
    if (d.type === 'ray' && P.length >= 2) {
      const end = extendRay(P[0], P[1])
      return (
        <g key={d.id}>
          <line x1={P[0].x} y1={P[0].y} x2={end.x} y2={end.y} stroke={color} strokeWidth={selected ? 2 : 1.5} strokeDasharray={d.style?.dashed ? '4 3' : undefined} />
          {handles}
        </g>
      )
    }
    if (d.type === 'channel' && P.length >= 3) {
      const off = channelOffset(P)
      const a2 = { x: P[0].x, y: P[0].y + off }
      const b2 = { x: P[1].x, y: P[1].y + off }
      return (
        <g key={d.id}>
          <polygon
            points={`${P[0].x},${P[0].y} ${P[1].x},${P[1].y} ${b2.x},${b2.y} ${a2.x},${a2.y}`}
            fill={color}
            fillOpacity={0.06}
          />
          <line x1={P[0].x} y1={P[0].y} x2={P[1].x} y2={P[1].y} stroke={color} strokeWidth={selected ? 2 : 1.5} />
          <line x1={a2.x} y1={a2.y} x2={b2.x} y2={b2.y} stroke={color} strokeWidth={selected ? 2 : 1.5} />
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
    if ((d.type === 'ew_impulse' || d.type === 'ew_correction') && P.length >= 2) {
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
      const x1 = Math.min(P[0].x, P[1].x)
      const y1 = Math.min(P[0].y, P[1].y)
      return (
        <g key={d.id}>
          <rect
            x={x1}
            y={y1}
            width={Math.abs(P[1].x - P[0].x)}
            height={Math.abs(P[1].y - P[0].y)}
            fill={color}
            fillOpacity={0.08}
            stroke={color}
            strokeWidth={selected ? 2 : 1}
          />
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
    return null
  }

  const renderPending = () => {
    // Brush-Vorschau während des Ziehens
    if (tool === 'brush' && brushPts && brushPts.length >= 2) {
      const P = brushPts.map(toPx).filter((p): p is Pt => p != null)
      const path = P.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
      return <path d={path} fill="none" stroke={CHART_COLORS.accent} strokeWidth={1.8} strokeLinecap="round" />
    }

    if (pending.length === 0 || !hoverPoint) return null
    const P = [...pending, hoverPoint].map(toPx)
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

  const renderMeasure = () => {
    if (!measure?.b) return null
    const a = toPx(measure.a)
    const b = toPx(measure.b)
    if (!a || !b) return null
    return renderRangeBox('measure', a, b, measure.a, measure.b, 'price')
  }

  // Nur abfangen, wenn gezeichnet wird oder eine Auswahl aktiv ist — sonst
  // bleibt das SVG durchlässig, damit Pan/Zoom des Charts funktionieren.
  const interactive = tool !== 'cursor' || selectedId != null

  // Im durchlässigen Zustand: Auswahl per Klick auf dem Chart-Wrapper (Events
  // laufen am SVG vorbei zum Chart-Canvas und bubbeln zum Wrapper hoch).
  useEffect(() => {
    if (interactive || drawings.length === 0) return
    const parent = svgRef.current?.parentElement
    if (!parent) return
    const onClick = (e: MouseEvent) => {
      const rect = svgRef.current!.getBoundingClientRect()
      const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top)
      if (hit != null) onSelect(hit)
    }
    parent.addEventListener('click', onClick)
    return () => parent.removeEventListener('click', onClick)
  }, [interactive, drawings.length, hitTest, onSelect])

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
      >
        {drawings.map(renderDrawing)}
        {renderPending()}
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
                onCreate('text', [{ ...textInput.point, text: value }])
              }
              setTextInput(null)
              onToolDone()
            }
            if (e.key === 'Escape') setTextInput(null)
          }}
          onBlur={() => setTextInput(null)}
        />
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
