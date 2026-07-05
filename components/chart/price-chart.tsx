'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  LineStyle,
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
  DEFAULT_INDICATORS,
  ema,
  loadIndicatorConfig,
  macd,
  rsi,
  saveIndicatorConfig,
  sma,
  type IndicatorConfig,
  type LinePoint,
} from './indicators'
import {
  createDrawing,
  updateDrawing,
  deleteDrawing,
  type Drawing,
  type DrawingPoint,
} from '@/app/actions/drawings'
import type { Interval } from '@/lib/market-data/types'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'

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
  '1T': { interval: '1h', days: 1 },
  '1W': { interval: '1h', days: 7 },
  '1M': { interval: '1day', days: 31 },
  '1J': { interval: '1day', days: 365 },
  Max: { interval: '1week', days: null },
}

const DARK = {
  text: '#8fa3b8',
  grid: 'rgba(143, 163, 184, 0.08)',
  border: 'rgba(143, 163, 184, 0.15)',
  up: '#4FBE8C',
  down: '#D8505F',
}

const LIGHT = {
  text: '#5b6b7c',
  grid: 'rgba(91, 107, 124, 0.10)',
  border: 'rgba(91, 107, 124, 0.25)',
  up: '#1f9e6d',
  down: '#c93a4a',
}

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
  const [timeframe, setTimeframe] = useState<keyof typeof TIMEFRAMES>('1J')
  const { interval, days } = TIMEFRAMES[timeframe]
  const { candles, loading, error, errorCode } = useCandles(symbol, market, interval)

  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const [chartReady, setChartReady] = useState(false)
  const { resolvedTheme } = useTheme()
  const palette = resolvedTheme === 'light' ? LIGHT : DARK

  // ---- Zeichenwerkzeuge (AP 5) ---------------------------------------------
  const [tool, setTool] = useState<DrawTool>('cursor')
  const [drawings, setDrawings] = useState<Drawing[]>(initialDrawings)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [drawError, setDrawError] = useState<string | null>(null)
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
    const toLine = (pts: LinePoint[]) =>
      pts.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))

    if (indicators.volume.on) {
      const vol = chart.addSeries(HistogramSeries, {
        priceScaleId: 'volume',
        priceFormat: { type: 'volume' },
        lastValueVisible: false,
        priceLineVisible: false,
      })
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
      vol.setData(
        candles.map((c, i) => ({
          time: c.time as UTCTimestamp,
          value: c.volume,
          color:
            (i > 0 ? c.close >= candles[i - 1].close : true)
              ? `${palette.up}59`
              : `${palette.down}59`,
        })),
      )
      added.push(vol)
    }

    if (indicators.ema.on) {
      const line = chart.addSeries(LineSeries, {
        color: '#45a8ec',
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        title: `EMA ${indicators.ema.period}`,
      })
      line.setData(toLine(ema(candles, indicators.ema.period)))
      added.push(line)
    }

    if (indicators.sma.on) {
      const line = chart.addSeries(LineSeries, {
        color: '#D4AC4E',
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        title: `SMA ${indicators.sma.period}`,
      })
      line.setData(toLine(sma(candles, indicators.sma.period)))
      added.push(line)
    }

    // Sub-Panes: RSI und MACD unter dem Hauptchart.
    let paneIndex = 1
    if (indicators.rsi.on) {
      const line = chart.addSeries(
        LineSeries,
        {
          color: '#D4AC4E',
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
          title: `RSI ${indicators.rsi.period}`,
        },
        paneIndex,
      )
      line.setData(toLine(rsi(candles, indicators.rsi.period)))
      for (const level of [30, 70]) {
        line.createPriceLine({
          price: level,
          color: palette.border,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
          title: '',
        })
      }
      chart.panes()[paneIndex]?.setHeight(90)
      added.push(line)
      paneIndex++
    }

    if (indicators.macd.on) {
      const { macd: macdLine, signal, histogram } = macd(
        candles,
        indicators.macd.fast,
        indicators.macd.slow,
        indicators.macd.signal,
      )
      const hist = chart.addSeries(
        HistogramSeries,
        { lastValueVisible: false, priceLineVisible: false },
        paneIndex,
      )
      hist.setData(
        histogram.map((p) => ({
          time: p.time as UTCTimestamp,
          value: p.value,
          color: p.value >= 0 ? `${palette.up}73` : `${palette.down}73`,
        })),
      )
      const m = chart.addSeries(
        LineSeries,
        {
          color: '#45a8ec',
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
          title: 'MACD',
        },
        paneIndex,
      )
      m.setData(toLine(macdLine))
      const sig = chart.addSeries(
        LineSeries,
        {
          color: '#D8505F',
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
          title: 'Signal',
        },
        paneIndex,
      )
      sig.setData(toLine(signal))
      chart.panes()[paneIndex]?.setHeight(110)
      added.push(hist, m, sig)
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
        background: { type: ColorType.Solid, color: 'transparent' },
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
        horzLine: { labelBackgroundColor: '#45a8ec' },
        vertLine: { labelBackgroundColor: '#45a8ec' },
      },
    })

    const series = chart.addSeries(CandlestickSeries, {
      upColor: palette.up,
      downColor: palette.down,
      wickUpColor: palette.up,
      wickDownColor: palette.down,
      borderVisible: false,
    })

    chartRef.current = chart
    seriesRef.current = series
    markersRef.current = createSeriesMarkers(series, [])
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

  // Theme-Wechsel: Farben nachziehen.
  useEffect(() => {
    chartRef.current?.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: palette.text,
      },
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid },
      },
      rightPriceScale: { borderColor: palette.border },
      timeScale: { borderColor: palette.border },
    })
    seriesRef.current?.applyOptions({
      upColor: palette.up,
      downColor: palette.down,
      wickUpColor: palette.up,
      wickDownColor: palette.down,
    })
  }, [palette])

  // Daten + Plan-Linien + Marker setzen.
  useEffect(() => {
    const series = seriesRef.current
    const chart = chartRef.current
    if (!series || !chart || !candles) return

    series.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    )

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
  }, [candles, days, seriesMarkers])

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
  }, [planLines, candles])

  // Forex/Optionen: keine Gratis-Daten → Hinweis statt Chart (TradingView-Link bleibt).
  if (errorCode === 'unsupported') {
    return (
      <div className="glass-card p-4">
        <p className="font-mono text-xs text-muted-foreground">{error}</p>
      </div>
    )
  }

  return (
    <div className="glass-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Kurschart · {symbol}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <IndicatorMenu config={indicators} onChange={handleIndicatorsChange} />
          {stockId != null && (
            <>
              <ChartToolbar
                tool={tool}
                onToolChange={setTool}
                hasSelection={selectedId != null}
                onDeleteSelected={handleDeleteSelected}
              />
              {candles && candles.length > 0 && (
                <AnalysisImport
                  stockId={stockId}
                  candles={candles}
                  onImported={(ds) => setDrawings((prev) => [...prev, ...ds])}
                />
              )}
            </>
          )}
          <div className="flex gap-1">
            {(Object.keys(TIMEFRAMES) as (keyof typeof TIMEFRAMES)[]).map((tf) => (
              <Button
                key={tf}
                size="sm"
                variant={tf === timeframe ? 'secondary' : 'ghost'}
                className="h-7 px-2 font-mono text-[11px]"
                onClick={() => setTimeframe(tf)}
              >
                {tf}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {drawError && (
        <p className="mb-2 font-mono text-[11px] text-destructive">{drawError}</p>
      )}

      <div className="relative h-[380px] w-full max-w-full sm:h-[440px]">
        <div ref={containerRef} className="absolute inset-0" />
        {stockId != null &&
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
  )
}
