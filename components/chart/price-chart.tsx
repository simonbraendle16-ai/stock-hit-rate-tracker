'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import { useCandles } from './use-candles'
import { ChartToolbar, type DrawTool } from './chart-toolbar'
import { DrawingLayer } from './drawing-layer'
import { AnalysisImport } from './analysis-import'
import { IndicatorMenu } from './indicator-menu'
import {
  computeIndicator,
  DEFAULT_INDICATORS,
  loadIndicatorConfig,
  saveIndicatorConfig,
  type IndicatorConfig,
} from './indicators'
import {
  createDrawing,
  updateDrawing,
  deleteDrawing,
  deleteAllDrawings,
  type Drawing,
  type DrawingPoint,
} from '@/app/actions/drawings'
import type { Interval } from '@/lib/market-data/types'
import { Button } from '@/components/ui/button'
import { Camera, Loader2, Maximize2, Minimize2 } from 'lucide-react'
import { toast } from 'sonner'

/** Preislinie aus dem Trading-Plan (Entry/Stop/Target/Invalidation) — AP 3. */
export interface PlanLine {
  price: number
  color: string
  title: string
  dashed?: boolean
}

/** Assessment-Marker auf der Zeitachse — AP 3. */
export interface ChartMarker {
  /** Unix-Sekunden */
  time: number
  kind: 'richtig' | 'falsch' | 'neutral'
  text: string
}

const TIMEFRAMES: Record<string, { interval: Interval; days: number | null }> = {
  '15m': { interval: '15min', days: 3 },
  '30m': { interval: '30min', days: 6 },
  '1h': { interval: '1h', days: 14 },
  '4h': { interval: '4h', days: 60 },
  T: { interval: '1day', days: 365 },
  W: { interval: '1week', days: null },
  M: { interval: '1month', days: null },
}

/** Chart-Darstellung (TradingView-Parität, AP 9). */
type ChartStyle = 'candles' | 'bars' | 'line' | 'area'

const CHART_STYLES: { id: ChartStyle; label: string }[] = [
  { id: 'candles', label: 'Kerzen' },
  { id: 'bars', label: 'Balken' },
  { id: 'line', label: 'Linie' },
  { id: 'area', label: 'Fläche' },
]

interface ChartPalette {
  text: string
  grid: string
  border: string
  up: string
  down: string
  /** Linien-/Flächen-Serie + Crosshair-Label */
  accent: string
  /** Chart-Hintergrund ('transparent' = Karte scheint durch) */
  bg: string
}

// App-Schema „Privatbank-Nacht“ (Default)
const DARK: ChartPalette = {
  text: '#8fa3b8',
  grid: 'rgba(143, 163, 184, 0.08)',
  border: 'rgba(143, 163, 184, 0.15)',
  up: '#4FBE8C',
  down: '#D8505F',
  accent: '#45a8ec',
  bg: 'transparent',
}

const LIGHT: ChartPalette = {
  text: '#5b6b7c',
  grid: 'rgba(91, 107, 124, 0.10)',
  border: 'rgba(91, 107, 124, 0.25)',
  up: '#1f9e6d',
  down: '#c93a4a',
  accent: '#45a8ec',
  bg: 'transparent',
}

// TradingView-Schema (Original-Farben, AP 9): BG #131722, Kerzen #089981/#F23645
const TV_DARK: ChartPalette = {
  text: '#B2B5BE',
  grid: 'rgba(42, 46, 57, 0.6)',
  border: 'rgba(178, 181, 190, 0.2)',
  up: '#089981',
  down: '#F23645',
  accent: '#2962FF',
  bg: '#131722',
}

const TV_LIGHT: ChartPalette = {
  text: '#131722',
  grid: 'rgba(42, 46, 57, 0.08)',
  border: 'rgba(19, 23, 34, 0.2)',
  up: '#089981',
  down: '#F23645',
  accent: '#2962FF',
  bg: '#ffffff',
}

const COLOR_SCHEME_KEY = 'chart-color-scheme'

export function PriceChart({
  symbol,
  market,
  planLines = [],
  markers = [],
  stockId,
  initialDrawings = [],
}: {
  symbol: string
  market: string
  planLines?: PlanLine[]
  markers?: ChartMarker[]
  /** Wenn gesetzt: Zeichenwerkzeuge aktiv, Zeichnungen persistent je Instrument (AP 5). */
  stockId?: number
  initialDrawings?: Drawing[]
}) {
  const [timeframe, setTimeframe] = useState<keyof typeof TIMEFRAMES>('T')
  const { interval, days } = TIMEFRAMES[timeframe]
  const { candles, loading, error, errorCode } = useCandles(symbol, market, interval)

  const containerRef = useRef<HTMLDivElement>(null)
  const containerWrapRef = useRef<HTMLDivElement>(null)
  const legendRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null)
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const [chartReady, setChartReady] = useState(false)
  // Zählt hoch, wenn die Hauptserie neu erzeugt wird (Chart-Typ/Theme-Wechsel),
  // damit Daten-/Overlay-Effekte auf die neue Serie nachziehen.
  const [seriesVersion, setSeriesVersion] = useState(0)
  const [chartStyle, setChartStyle] = useState<ChartStyle>('candles')
  const [logScale, setLogScale] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const { resolvedTheme } = useTheme()
  const [colorScheme, setColorScheme] = useState<'app' | 'tv'>('app')
  const palette =
    colorScheme === 'tv'
      ? resolvedTheme === 'light'
        ? TV_LIGHT
        : TV_DARK
      : resolvedTheme === 'light'
        ? LIGHT
        : DARK

  // Gemerktes Farbschema erst nach dem Mount laden (kein SSR-Mismatch).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(COLOR_SCHEME_KEY)
      if (saved === 'tv' || saved === 'app') setColorScheme(saved)
    } catch {
      /* localStorage gesperrt — Default bleibt */
    }
  }, [])

  const handleColorSchemeToggle = useCallback(() => {
    setColorScheme((s) => {
      const next = s === 'tv' ? 'app' : 'tv'
      try {
        window.localStorage.setItem(COLOR_SCHEME_KEY, next)
      } catch {
        /* localStorage gesperrt — gilt dann nur für die Sitzung */
      }
      return next
    })
  }, [])

  // ---- Zeichenwerkzeuge (AP 5 + AP 9) --------------------------------------
  const [tool, setTool] = useState<DrawTool>('cursor')
  const [drawings, setDrawings] = useState<Drawing[]>(initialDrawings)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [drawError, setDrawError] = useState<string | null>(null)
  const [magnet, setMagnet] = useState(false)
  const [drawingsLocked, setDrawingsLocked] = useState(false)
  const [drawingsVisible, setDrawingsVisible] = useState(true)

  // Werkzeugwahl blendet ausgeblendete Zeichnungen automatisch wieder ein.
  const handleToolChange = useCallback((t: DrawTool) => {
    setTool(t)
    if (t !== 'cursor') setDrawingsVisible(true)
  }, [])

  const handleDeleteAll = useCallback(() => {
    if (stockId == null) return
    setSelectedId(null)
    setDrawings([])
    deleteAllDrawings(stockId).catch(() =>
      setDrawError('Zeichnungen konnten nicht gelöscht werden.'),
    )
  }, [stockId])
  // Debounce-Timer je Zeichnung, damit Verschieben nicht jede Mausbewegung speichert.
  const persistTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const handleCreate = useCallback(
    (type: Drawing['type'], points: DrawingPoint[]) => {
      if (stockId == null) return
      setDrawError(null)
      createDrawing({ stockId, type, points })
        .then((d) => {
          setDrawings((ds) => [...ds, d])
          setSelectedId(d.id)
        })
        .catch(() => setDrawError('Zeichnung konnte nicht gespeichert werden.'))
    },
    [stockId],
  )

  const handleUpdate = useCallback((id: number, points: DrawingPoint[]) => {
    setDrawings((ds) => ds.map((d) => (d.id === id ? { ...d, points } : d)))
    const timers = persistTimers.current
    const prev = timers.get(id)
    if (prev) clearTimeout(prev)
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id)
        updateDrawing({ id, points }).catch(() =>
          setDrawError('Zeichnung konnte nicht gespeichert werden.'),
        )
      }, 500),
    )
  }, [])

  const handleDeleteSelected = useCallback(() => {
    if (selectedId == null) return
    const id = selectedId
    setSelectedId(null)
    setDrawings((ds) => ds.filter((d) => d.id !== id))
    deleteDrawing(id).catch(() => setDrawError('Zeichnung konnte nicht gelöscht werden.'))
  }, [selectedId])

  // Entf/Backspace löscht die Auswahl (nicht, wenn gerade ein Input fokussiert ist).
  useEffect(() => {
    if (selectedId == null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      handleDeleteSelected()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, handleDeleteSelected])

  // Offene Persist-Timer laufen beim Unmount bewusst weiter — sonst ginge die
  // letzte Verschiebung verloren, wenn direkt nach dem Ziehen wegnavigiert wird.

  // ---- Indikatoren (AP 7) ---------------------------------------------------
  const [indicators, setIndicators] = useState<IndicatorConfig>(DEFAULT_INDICATORS)

  // Gespeicherte Konfiguration erst nach dem Mount laden (kein SSR-Mismatch).
  useEffect(() => {
    setIndicators(loadIndicatorConfig())
  }, [])

  const handleIndicatorsChange = useCallback((cfg: IndicatorConfig) => {
    setIndicators(cfg)
    saveIndicatorConfig(cfg)
  }, [])

  // Indikator-Serien aus den GELADENEN Kerzen berechnen — kein neuer Datenabruf.
  useEffect(() => {
    const chart = chartRef.current
    if (!chartReady || !chart || !candles || candles.length === 0) return

    const added: ISeriesApi<SeriesType>[] = []
    // Volumen bekommt eine eigene Overlay-Preisskala unten im Hauptchart.
    const toData = (spec: { data: { time: number; value?: number; color?: string }[] }) =>
      spec.data.map((pt) =>
        pt.value == null
          ? { time: pt.time as UTCTimestamp }
          : { time: pt.time as UTCTimestamp, value: pt.value, color: pt.color },
      )

    // Jede Sub-Pane-Instanz bekommt ein eigenes Pane; Overlays liegen im Hauptchart.
    let paneIndex = 1
    for (const inst of indicators.instances) {
      const specs = computeIndicator(candles, inst, palette)
      if (specs.length === 0) continue
      const overlay = specs[0].overlay
      const targetPane = overlay ? 0 : paneIndex

      for (const spec of specs) {
        if (spec.kind === 'histogram') {
          const isVolume = inst.type === 'volume'
          const hist = chart.addSeries(
            HistogramSeries,
            {
              lastValueVisible: false,
              priceLineVisible: false,
              ...(isVolume
                ? { priceScaleId: `volume-${inst.id}`, priceFormat: { type: 'volume' as const } }
                : {}),
            },
            targetPane,
          )
          if (isVolume) {
            hist.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
          }
          hist.setData(toData(spec))
          added.push(hist)
        } else {
          const line = chart.addSeries(
            LineSeries,
            {
              color: spec.color,
              lineWidth: (spec.lineWidth ?? 1) as 1 | 2 | 3 | 4,
              lastValueVisible: false,
              priceLineVisible: false,
              title: spec.title ?? '',
              ...(spec.kind === 'points'
                ? { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1.5 }
                : {}),
            },
            targetPane,
          )
          line.setData(toData(spec))
          for (const level of spec.levels ?? []) {
            line.createPriceLine({
              price: level,
              color: palette.border,
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: false,
              title: '',
            })
          }
          added.push(line)
        }
      }

      if (!overlay) {
        chart.panes()[targetPane]?.setHeight(inst.type === 'macd' ? 110 : 90)
        paneIndex++
      }
    }

    return () => {
      // Beim Unmount kann der Chart bereits entsorgt sein — dann ist nichts zu tun.
      try {
        for (const s of added) chart.removeSeries(s)
      } catch {
        /* Chart disposed */
      }
    }
  }, [candles, indicators, chartReady, palette])

  // Marker auf existierende Kerzenzeiten snappen (sonst zeigt lightweight-charts sie nicht an).
  const seriesMarkers = useMemo<SeriesMarker<Time>[]>(() => {
    if (!candles || candles.length === 0) return []
    const first = candles[0].time
    return markers
      .filter((m) => m.time >= first)
      .map((m) => {
        let snapped = first
        for (const c of candles) {
          if (c.time <= m.time) snapped = c.time
          else break
        }
        return {
          time: snapped as UTCTimestamp,
          position: 'aboveBar' as const,
          shape:
            m.kind === 'richtig'
              ? ('arrowUp' as const)
              : m.kind === 'falsch'
                ? ('arrowDown' as const)
                : ('circle' as const),
          color: m.kind === 'richtig' ? palette.up : m.kind === 'falsch' ? palette.down : '#D4AC4E',
          text: m.text,
        }
      })
      .sort((a, b) => (a.time as number) - (b.time as number))
  }, [markers, candles, palette])

  // Chart einmalig erzeugen, bei Unmount sauber entsorgen.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: palette.bg },
        textColor: palette.text,
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid },
      },
      rightPriceScale: { borderColor: palette.border },
      timeScale: { borderColor: palette.border, timeVisible: true },
      crosshair: {
        horzLine: { labelBackgroundColor: palette.accent },
        vertLine: { labelBackgroundColor: palette.accent },
      },
    })

    chartRef.current = chart
    setChartReady(true)

    return () => {
      setChartReady(false)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      markersRef.current = null
    }
    // Theme-Wechsel wird unten via applyOptions behandelt, kein Re-Create nötig.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Hauptserie je Chart-Typ erzeugen (Kerzen/Balken/Linie/Fläche).
  useEffect(() => {
    const chart = chartRef.current
    if (!chartReady || !chart) return

    let series: ISeriesApi<SeriesType>
    if (chartStyle === 'candles') {
      series = chart.addSeries(CandlestickSeries, {
        upColor: palette.up,
        downColor: palette.down,
        wickUpColor: palette.up,
        wickDownColor: palette.down,
        borderVisible: false,
      })
    } else if (chartStyle === 'bars') {
      series = chart.addSeries(BarSeries, {
        upColor: palette.up,
        downColor: palette.down,
        thinBars: false,
      })
    } else if (chartStyle === 'area') {
      series = chart.addSeries(AreaSeries, {
        lineColor: palette.accent,
        topColor: `${palette.accent}40`,
        bottomColor: `${palette.accent}05`,
        lineWidth: 2,
      })
    } else {
      series = chart.addSeries(LineSeries, { color: palette.accent, lineWidth: 2 })
    }

    seriesRef.current = series
    markersRef.current = createSeriesMarkers(series, [])
    setSeriesVersion((v) => v + 1)

    return () => {
      seriesRef.current = null
      markersRef.current = null
      // Beim Unmount kann der Chart bereits entsorgt sein — dann ist nichts zu tun.
      try {
        chart.removeSeries(series)
      } catch {
        /* Chart disposed */
      }
    }
  }, [chartReady, chartStyle, palette])

  // Theme-/Schema-Wechsel: Chart-Rahmenfarben nachziehen (Serie wird oben neu erzeugt).
  useEffect(() => {
    chartRef.current?.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: palette.bg },
        textColor: palette.text,
      },
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid },
      },
      rightPriceScale: { borderColor: palette.border },
      timeScale: { borderColor: palette.border },
      crosshair: {
        horzLine: { labelBackgroundColor: palette.accent },
        vertLine: { labelBackgroundColor: palette.accent },
      },
    })
  }, [palette])

  // Log-Skala umschalten.
  useEffect(() => {
    if (!chartReady) return
    chartRef.current?.priceScale('right').applyOptions({
      mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    })
  }, [logScale, chartReady])

  // Daten + Marker setzen (Mapping je Chart-Typ).
  useEffect(() => {
    const series = seriesRef.current
    const chart = chartRef.current
    if (!series || !chart || !candles) return

    if (chartStyle === 'line' || chartStyle === 'area') {
      series.setData(
        candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })),
      )
    } else {
      series.setData(
        candles.map((c) => ({
          time: c.time as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })),
      )
    }

    markersRef.current?.setMarkers(seriesMarkers)

    // Sichtbaren Bereich auf das gewählte Zeitfenster begrenzen.
    if (days && candles.length > 1) {
      const to = candles[candles.length - 1].time
      const from = Math.max(candles[0].time, to - days * 86400)
      chart.timeScale().setVisibleRange({
        from: from as UTCTimestamp,
        to: to as UTCTimestamp,
      })
    } else {
      chart.timeScale().fitContent()
    }
  }, [candles, days, seriesMarkers, chartStyle, seriesVersion])

  // OHLC-Legende oben links: Werte der Kerze unterm Crosshair (Direkt-DOM,
  // damit Mausbewegungen keine React-Renders auslösen).
  useEffect(() => {
    const chart = chartRef.current
    if (!chartReady || !chart || !candles || candles.length === 0) return
    const byTime = new Map(candles.map((c, i) => [c.time, i]))
    const fmt = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 6 })
    const render = (i: number) => {
      const el = legendRef.current
      if (!el) return
      const c = candles[i]
      const prev = i > 0 ? candles[i - 1] : undefined
      const chg = prev ? ((c.close - prev.close) / prev.close) * 100 : 0
      const col = c.close >= (prev?.close ?? c.open) ? palette.up : palette.down
      el.innerHTML =
        `O <span style="color:${col}">${fmt(c.open)}</span> ` +
        `H <span style="color:${col}">${fmt(c.high)}</span> ` +
        `L <span style="color:${col}">${fmt(c.low)}</span> ` +
        `C <span style="color:${col}">${fmt(c.close)}</span> ` +
        `<span style="color:${col}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)} %</span>`
    }
    render(candles.length - 1)
    const handler = (param: { time?: unknown }) => {
      const idx = typeof param.time === 'number' ? byTime.get(param.time) : undefined
      render(idx ?? candles.length - 1)
    }
    chart.subscribeCrosshairMove(handler)
    return () => {
      try {
        chart.unsubscribeCrosshairMove(handler)
      } catch {
        /* Chart disposed */
      }
    }
  }, [candles, chartReady, palette])

  // Vollbild: Esc verlässt den Modus, Seite dahinter scrollt nicht.
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [fullscreen])

  // Screenshot: Chart-Canvas + Zeichnungs-SVG zu einem PNG kombinieren.
  const takeScreenshot = useCallback(async () => {
    const chart = chartRef.current
    if (!chart) return
    try {
      const base = chart.takeScreenshot()
      const out = document.createElement('canvas')
      out.width = base.width
      out.height = base.height
      const ctx = out.getContext('2d')!
      ctx.fillStyle =
        palette.bg !== 'transparent'
          ? palette.bg
          : resolvedTheme === 'light'
            ? '#ffffff'
            : '#0b1522'
      ctx.fillRect(0, 0, out.width, out.height)
      ctx.drawImage(base, 0, 0)

      const svg = containerWrapRef.current?.querySelector('svg')
      if (svg && svg.clientWidth > 0) {
        const clone = svg.cloneNode(true) as SVGSVGElement
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
        clone.setAttribute('width', String(svg.clientWidth))
        clone.setAttribute('height', String(svg.clientHeight))
        const xml = new XMLSerializer().serializeToString(clone)
        const img = new Image()
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = () => reject(new Error('SVG-Overlay nicht renderbar'))
          img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
        })
        ctx.drawImage(img, 0, 0, out.width, out.height)
      }

      out.toBlob((blob) => {
        if (!blob) {
          toast.error('Screenshot fehlgeschlagen.')
          return
        }
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${symbol}-${new Date().toISOString().slice(0, 10)}.png`
        a.click()
        URL.revokeObjectURL(url)
      }, 'image/png')
    } catch (err) {
      console.error('screenshot:', err)
      toast.error('Screenshot fehlgeschlagen.')
    }
  }, [symbol, resolvedTheme, palette])

  // Plan-Linien (Entry/Stop/Target/Invalidation) als Preislinien.
  useEffect(() => {
    const series = seriesRef.current
    if (!series || !candles) return
    const created = planLines.map((l) =>
      series.createPriceLine({
        price: l.price,
        color: l.color,
        lineWidth: 1,
        lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: true,
        title: l.title,
      }),
    )
    return () => {
      // Beim Unmount kann der Chart bereits entsorgt sein — dann ist nichts zu tun.
      try {
        for (const line of created) series.removePriceLine(line)
      } catch {
        /* Chart disposed */
      }
    }
  }, [planLines, candles, seriesVersion])

  // Forex/Optionen: keine Gratis-Daten → Hinweis statt Chart (TradingView-Link bleibt).
  if (errorCode === 'unsupported') {
    return (
      <div className="glass-card p-4">
        <p className="font-mono text-xs text-muted-foreground">{error}</p>
      </div>
    )
  }

  return (
    <div
      className={
        fullscreen
          ? 'fixed inset-0 z-50 flex flex-col bg-background p-3 sm:p-4'
          : 'glass-card p-4'
      }
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Kurschart · {symbol}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex gap-0.5">
            {(Object.keys(TIMEFRAMES) as (keyof typeof TIMEFRAMES)[]).map((tf) => (
              <Button
                key={tf}
                size="sm"
                variant={tf === timeframe ? 'secondary' : 'ghost'}
                className="h-7 px-1.5 font-mono text-[11px]"
                onClick={() => setTimeframe(tf)}
              >
                {tf}
              </Button>
            ))}
          </div>
          <select
            value={chartStyle}
            onChange={(e) => setChartStyle(e.target.value as ChartStyle)}
            className="input-ocean h-7 rounded px-1.5 font-mono text-[11px]"
            title="Chart-Typ"
            aria-label="Chart-Typ"
          >
            {CHART_STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant={logScale ? 'secondary' : 'ghost'}
            className="h-7 px-2 font-mono text-[11px]"
            title="Logarithmische Preisskala"
            onClick={() => setLogScale((v) => !v)}
          >
            Log
          </Button>
          <Button
            size="sm"
            variant={colorScheme === 'tv' ? 'secondary' : 'ghost'}
            className="h-7 px-2 font-mono text-[11px]"
            title={
              colorScheme === 'tv'
                ? 'Zurück zu den App-Farben'
                : 'TradingView-Farbschema (Hintergrund + Kerzenfarben)'
            }
            onClick={handleColorSchemeToggle}
          >
            TV
          </Button>
          <IndicatorMenu config={indicators} onChange={handleIndicatorsChange} />
          {stockId != null && candles && candles.length > 0 && (
            <AnalysisImport
              stockId={stockId}
              candles={candles}
              onImported={(ds) => setDrawings((prev) => [...prev, ...ds])}
            />
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            title="Chart als PNG speichern"
            onClick={takeScreenshot}
          >
            <Camera className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            title={fullscreen ? 'Vollbild verlassen (Esc)' : 'Vollbild'}
            onClick={() => setFullscreen((v) => !v)}
          >
            {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </Button>
        </div>
      </div>

      {drawError && (
        <p className="mb-2 font-mono text-[11px] text-destructive">{drawError}</p>
      )}

      <div
        className={
          fullscreen ? 'flex min-h-0 flex-1 gap-1.5' : 'flex h-[380px] gap-1.5 sm:h-[440px]'
        }
      >
        {stockId != null && (
          <ChartToolbar
            tool={tool}
            onToolChange={handleToolChange}
            hasSelection={selectedId != null}
            onDeleteSelected={handleDeleteSelected}
            magnet={magnet}
            onMagnetChange={setMagnet}
            locked={drawingsLocked}
            onLockedChange={setDrawingsLocked}
            drawingsVisible={drawingsVisible}
            onDrawingsVisibleChange={setDrawingsVisible}
            onDeleteAll={handleDeleteAll}
            hasDrawings={drawings.length > 0}
          />
        )}
        <div ref={containerWrapRef} className="relative min-w-0 flex-1">
          <div ref={containerRef} className="absolute inset-0" />
          <div
            ref={legendRef}
            className="pointer-events-none absolute left-2 top-1 z-20 font-mono text-[11px] text-muted-foreground"
          />
          {stockId != null &&
            drawingsVisible &&
            chartReady &&
            chartRef.current &&
            seriesRef.current &&
            candles &&
            candles.length > 0 && (
              <DrawingLayer
                chart={chartRef.current}
                series={seriesRef.current}
                candles={candles}
                drawings={drawings}
                tool={tool}
                onToolDone={() => setTool('cursor')}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onCreate={handleCreate}
                onUpdate={handleUpdate}
                magnet={magnet}
                locked={drawingsLocked}
              />
            )}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {error && !loading && errorCode !== 'unsupported' && (
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <p className="text-center font-mono text-xs text-muted-foreground">{error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
