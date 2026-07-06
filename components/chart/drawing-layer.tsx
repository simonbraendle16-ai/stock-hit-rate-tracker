'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { BarPrice, IChartApi, ISeriesApi, SeriesType, UTCTimestamp } from 'lightweight-charts'
import type { Drawing, DrawingPoint } from '@/app/actions/drawings'
import type { Candle } from '@/lib/market-data/types'
import type { DrawTool } from './chart-toolbar'

/** Fib-Retracement-Levels (Frost & Prechter Standard). */
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
/** Trendbasierte Fib-Extension-Levels (TradingView-Standard). */
const FIBEXT_LEVELS = [0, 0.382, 0.618, 1, 1.382, 1.618, 2, 2.618]

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

const SELECT_TOLERANCE = 6 // px

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
  /** Snap auf O/H/L/C der nächstgelegenen Kerze (TradingView-Magnet). */
  magnet?: boolean
  /** Zeichnungen gesperrt: auswählen ja, verschieben nein. */
  locked?: boolean
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [, setTick] = useState(0)
  const [pending, setPending] = useState<DrawingPoint[]>([])
  const [hoverPoint, setHoverPoint] = useState<DrawingPoint | null>(null)
  const [textInput, setTextInput] = useState<{ point: DrawingPoint; px: Pt } | null>(null)
  const [measure, setMeasure] = useState<{ a: DrawingPoint; b: DrawingPoint | null; frozen: boolean } | null>(null)
  const [brushPts, setBrushPts] = useState<DrawingPoint[] | null>(null)
  const dragRef = useRef<{
    id: number
    pointIndex: number | null // null = ganze Zeichnung (nur Preis-Verschiebung)
    startPoints: DrawingPoint[]
    startY: number
  } | null>(null)

  // Bei Pan/Zoom neu rendern (Koordinaten ändern sich).
  useEffect(() => {
    const ts = chart.timeScale()
    const handler = () => setTick((t) => t + 1)
    ts.subscribeVisibleLogicalRangeChange(handler)
    return () => ts.unsubscribeVisibleLogicalRangeChange(handler)
  }, [chart])

  const toPx = useCallback(
    (p: DrawingPoint): Pt | null => {
      const x = chart.timeScale().timeToCoordinate(p.time as UTCTimestamp)
      const y = series.priceToCoordinate(p.price)
      if (x == null || y == null) return null
      return { x, y }
    },
    [chart, series],
  )

  const fromPx = useCallback(
    (x: number, y: number): DrawingPoint | null => {
      const price = series.coordinateToPrice(y)
      if (price == null || candles.length === 0) return null
      let time = chart.timeScale().coordinateToTime(x) as number | null
      if (time == null) {
        // außerhalb der Daten: auf erste/letzte Kerze klemmen
        const logical = chart.timeScale().coordinateToLogical(x)
        time =
          logical != null && logical < 0
            ? candles[0].time
            : candles[candles.length - 1].time
      } else {
        // auf nächste Kerzenzeit snappen
        let best = candles[0].time
        for (const c of candles) {
          if (Math.abs(c.time - time) < Math.abs(best - time)) best = c.time
        }
        time = best
      }
      // Magnet: Preis auf O/H/L/C der Kerze snappen, wenn nah genug (≤ 14 px).
      if (magnet) {
        const candle = candles.find((c) => c.time === time)
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
    [chart, series, candles, magnet],
  )

  const width = svgRef.current?.clientWidth ?? 0
  const height = svgRef.current?.clientHeight ?? 0

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
      for (const d of drawings) {
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
        } else if (d.type === 'fib' && P.length >= 2) {
          const x1 = Math.min(P[0].x, P[1].x)
          const x2 = Math.max(P[0].x, P[1].x)
          if (x >= x1 - SELECT_TOLERANCE && x <= x2 + SELECT_TOLERANCE) {
            for (const lvl of FIB_LEVELS) {
              const ly = P[0].y + (P[1].y - P[0].y) * lvl
              if (Math.abs(ly - y) < SELECT_TOLERANCE) return d.id
            }
          }
        } else if (d.type === 'fibext' && P.length >= 3) {
          const a = d.points[0].price
          const b = d.points[1].price
          const c = d.points[2].price
          if (x >= P[2].x - SELECT_TOLERANCE) {
            for (const lvl of FIBEXT_LEVELS) {
              const ly = series.priceToCoordinate(c + (b - a) * lvl)
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
    const point = fromPx(x, y)
    if (!point) return

    if (tool === 'cursor') {
      // Endpunkt-Handle der Auswahl treffen? (gesperrt: nur auswählen)
      if (selectedId != null && !locked) {
        const sel = drawings.find((d) => d.id === selectedId)
        if (sel) {
          const pts = sel.points.map(toPx)
          for (let i = 0; i < pts.length; i++) {
            const p = pts[i]
            if (p && Math.hypot(p.x - x, p.y - y) < 8) {
              dragRef.current = { id: sel.id, pointIndex: i, startPoints: sel.points, startY: y }
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
        dragRef.current = { id: hit, pointIndex, startPoints: d.points, startY: y }
        svgRef.current!.setPointerCapture(e.pointerId)
      }
      return
    }

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
        // ganze Zeichnung vertikal verschieben (Preis-Delta)
        const startPrice = series.coordinateToPrice(drag.startY)
        const nowPrice = series.coordinateToPrice(y)
        if (startPrice == null || nowPrice == null) return
        const delta = nowPrice - startPrice
        next = drag.startPoints.map((p) => ({ ...p, price: p.price + delta }))
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
    const col = kind === 'date' ? '#45a8ec' : up ? '#4FBE8C' : '#D8505F'
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

  const renderDrawing = (d: Drawing) => {
    const color = d.style?.color ?? '#45a8ec'
    const pts = d.points.map(toPx)
    if (pts.some((p) => p == null)) return null
    const P = pts as Pt[]
    const selected = d.id === selectedId

    const handles = selected
      ? P.map((p, i) => (
          <circle key={`h${i}`} cx={p.x} cy={p.y} r={4} fill="#f1ece0" stroke={color} />
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
              <circle cx={P[0].x} cy={P[0].y} r={4} fill="#f1ece0" stroke={color} />
              <circle cx={P[P.length - 1].x} cy={P[P.length - 1].y} r={4} fill="#f1ece0" stroke={color} />
            </>
          )}
        </g>
      )
    }
    if ((d.type === 'ew_impulse' || d.type === 'ew_correction') && P.length >= 2) {
      const labels = WAVE_LABELS[d.type]
      const col = d.style?.color ?? '#f1ece0'
      const path = P.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
      return (
        <g key={d.id}>
          <path d={path} fill="none" stroke={col} strokeWidth={selected ? 2 : 1.3} opacity={0.85} />
          {P.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y - 10} r={7} fill="#0b1522" stroke={col} strokeWidth={selected ? 1.5 : 1} />
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
            fill="#4FBE8C"
            opacity={0.14}
            stroke="#4FBE8C"
            strokeWidth={selected ? 1.5 : 0.8}
          />
          {/* Risiko-Zone (rot) */}
          <rect
            x={x1}
            y={Math.min(entryY, stopY)}
            width={x2 - x1}
            height={Math.abs(stopY - entryY)}
            fill="#D8505F"
            opacity={0.14}
            stroke="#D8505F"
            strokeWidth={selected ? 1.5 : 0.8}
          />
          <line x1={x1} y1={entryY} x2={x2} y2={entryY} stroke="#f1ece0" strokeWidth={1} strokeDasharray="4 3" />
          <text x={x1 + 4} y={entryY - 3} fill="#f1ece0" fontSize={9} fontFamily="monospace">
            {long ? 'Long' : 'Short'} Entry {formatDe(entry)} · R:R {rr.toFixed(2)}
          </text>
          <text x={x1 + 4} y={targetY + (targetY < entryY ? 10 : -3)} fill="#4FBE8C" fontSize={9} fontFamily="monospace">
            Target {formatDe(target)} ({formatDe(reward)})
          </text>
          <text x={x1 + 4} y={stopY + (stopY < entryY ? 10 : -3)} fill="#D8505F" fontSize={9} fontFamily="monospace">
            Stop {formatDe(stop)} ({formatDe(risk)})
          </text>
          {handles}
        </g>
      )
    }
    if (d.type === 'fib') {
      const x1 = Math.min(P[0].x, P[1].x)
      const x2 = Math.max(P[0].x, P[1].x)
      const p0 = d.points[0].price
      const p1 = d.points[1].price
      return (
        <g key={d.id}>
          {FIB_LEVELS.map((lvl) => {
            const price = p0 + (p1 - p0) * lvl
            const y = series.priceToCoordinate(price)
            if (y == null) return null
            return (
              <g key={lvl}>
                <line x1={x1} y1={y} x2={x2} y2={y} stroke="#D4AC4E" strokeWidth={lvl === 0 || lvl === 1 ? 1.5 : 1} opacity={lvl === 0.5 ? 0.9 : 0.7} />
                <text x={x2 + 4} y={y + 3} fill="#D4AC4E" fontSize={9} fontFamily="monospace">
                  {lvl.toFixed(3)} · {formatDe(price)}
                </text>
              </g>
            )
          })}
          {handles}
        </g>
      )
    }
    if (d.type === 'fibext' && P.length >= 3) {
      const a = d.points[0].price
      const b = d.points[1].price
      const c = d.points[2].price
      const x1 = P[2].x
      const x2 = Math.max(width - 74, x1 + 60)
      return (
        <g key={d.id}>
          {/* A–B–C-Basislinien */}
          <line x1={P[0].x} y1={P[0].y} x2={P[1].x} y2={P[1].y} stroke="#D4AC4E" strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
          <line x1={P[1].x} y1={P[1].y} x2={P[2].x} y2={P[2].y} stroke="#D4AC4E" strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
          {FIBEXT_LEVELS.map((lvl) => {
            const price = c + (b - a) * lvl
            const y = series.priceToCoordinate(price)
            if (y == null) return null
            return (
              <g key={lvl}>
                <line x1={x1} y1={y} x2={x2} y2={y} stroke="#D4AC4E" strokeWidth={lvl === 1 ? 1.5 : 1} opacity={0.75} />
                <text x={x1 + 4} y={y - 3} fill="#D4AC4E" fontSize={9} fontFamily="monospace">
                  {lvl.toFixed(3)} · {formatDe(price)}
                </text>
              </g>
            )
          })}
          {handles}
        </g>
      )
    }
    if (d.type === 'text') {
      return (
        <g key={d.id}>
          <text x={P[0].x} y={P[0].y} fill={d.style?.color ?? '#f1ece0'} fontSize={11} fontFamily="monospace" textAnchor="middle">
            {d.points[0].text ?? ''}
          </text>
          {selected && (
            <rect x={P[0].x - 42} y={P[0].y - 14} width={84} height={20} fill="none" stroke="#45a8ec" strokeDasharray="3 2" />
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
      return <path d={path} fill="none" stroke="#45a8ec" strokeWidth={1.8} strokeLinecap="round" />
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
          fill="#45a8ec"
          fillOpacity={0.08}
          stroke="#45a8ec"
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
          fill="#45a8ec"
          fillOpacity={0.08}
          stroke="#45a8ec"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      )
    }
    if (tool === 'channel' && Q.length === 3) {
      const off = channelOffset(Q)
      return (
        <g>
          <line x1={Q[0].x} y1={Q[0].y} x2={Q[1].x} y2={Q[1].y} stroke="#45a8ec" strokeWidth={1} strokeDasharray="4 3" />
          <line x1={Q[0].x} y1={Q[0].y + off} x2={Q[1].x} y2={Q[1].y + off} stroke="#45a8ec" strokeWidth={1} strokeDasharray="4 3" />
        </g>
      )
    }
    // Mehrpunkt-Werkzeuge (Elliott, Fib-Ext, Kanal-Basis): Polyline-Vorschau
    if (Q.length > 2 || tool === 'ew_impulse' || tool === 'ew_correction' || tool === 'fibext' || tool === 'channel') {
      const path = Q.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
      return <path d={path} fill="none" stroke="#45a8ec" strokeWidth={1} strokeDasharray="4 3" />
    }
    const end = tool === 'ray' ? extendRay(a, b) : b
    return <line x1={a.x} y1={a.y} x2={end.x} y2={end.y} stroke="#45a8ec" strokeWidth={1} strokeDasharray="4 3" />
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
          cursor: tool === 'cursor' ? 'default' : 'crosshair',
          // Preisachse rechts (~70px) und Zeitachse unten nicht überdecken
          clipPath: 'inset(0 70px 26px 0)',
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
