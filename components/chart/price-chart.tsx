'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { CHART_COLORS } from './colors'
import { ChartToolbar, type DrawTool } from './chart-toolbar'
import { DrawingLayer } from './drawing-layer'
import { AnalysisImport } from './analysis-import'
import { IndicatorMenu } from './indicator-menu'
import { ChartReplayControls } from './chart-replay-controls'
import { ChartSettings } from './chart-settings'
import { DEFAULT_APPEARANCE, type ChartAppearance } from '@/lib/chart-appearance'
import {
  loadChartAppearance,
  resetChartAppearance,
  saveChartAppearance,
} from '@/app/actions/chart-appearance'
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
import {
  createTrainingAnnotation,
  updateTrainingAnnotation,
  deleteTrainingAnnotation,
  deleteAllTrainingAnnotations,
} from '@/app/actions/training'
import type { Candle } from '@/lib/market-data/types'
import { CHART_TIMEFRAMES, type ChartTimeframe } from '@/lib/chart-timeframes'
import { Button } from '@/components/ui/button'
import { ChartEmpty, ChartHeader } from '@/components/chart-frame'
import { CandlestickChart, Camera, Loader2, Maximize2, Minimize2 } from 'lucide-react'
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

// Die Tabelle selbst liegt in `lib/chart-timeframes.ts` — auch der Server
// braucht sie, seit der Trainer Übungen anlegt und `/api/candles` die Kerzen
// einer verdeckten Übung ohne Symbol ausliefert.
const TIMEFRAMES = CHART_TIMEFRAMES

export type { ChartTimeframe }

/** Chart-Darstellung (TradingView-Parität, AP 9). */
type ChartStyle = 'candles' | 'bars' | 'line' | 'area'

const CHART_STYLES: { id: ChartStyle; label: string }[] = [
  { id: 'candles', label: 'Kerzen' },
  { id: 'bars', label: 'Balken' },
  { id: 'line', label: 'Linie' },
  { id: 'area', label: 'Fläche' },
]

/* Die früheren vier festen Paletten (App/TradingView je hell und dunkel) sind
 * mit Migration 0028 entfallen: Das Aussehen kommt jetzt aus den Einstellungen
 * des Nutzers (`lib/chart-appearance.ts`), TradingView ist dort eine Vorlage. */

export function PriceChart({
  symbol,
  market,
  planLines = [],
  markers = [],
  stockId,
  initialDrawings = [],
  defaultTimeframe = 'T',
  replayMode = false,
  replayStart,
  replayMaxVisible,
  replayLockedHint,
  onReplayVisibleChange,
  onCandlesLoaded,
  trainingSessionId,
  hideIdentity = false,
  lockTimeframe = false,
  heightClass,
  pickPrice = null,
  pickLabel,
  ephemeralDrawings = false,
}: {
  symbol: string
  market: string
  planLines?: PlanLine[]
  markers?: ChartMarker[]
  /** Wenn gesetzt: Zeichenwerkzeuge aktiv, Zeichnungen persistent je Instrument (AP 5). */
  stockId?: number
  initialDrawings?: Drawing[]
  defaultTimeframe?: ChartTimeframe
  replayMode?: boolean
  /** Startpunkt des Replays (Anzahl sichtbarer Kerzen). */
  replayStart?: number
  /** Obergrenze der sichtbaren Kerzen — der Trainer sperrt damit die Zukunft. */
  replayMaxVisible?: number
  replayLockedHint?: string
  onReplayVisibleChange?: (visible: number) => void
  /** Meldet den geladenen Kerzensatz nach oben (der Trainer trägt ihn ein). */
  onCandlesLoaded?: (candles: Candle[]) => void
  /**
   * Trainingseinheit statt Instrument: Kerzen kommen über die Übung (bei einer
   * verdeckten Übung ohne Symbol), Zeichnungen landen in `training_annotation`
   * statt im echten Chart des Instruments.
   */
  trainingSessionId?: number
  /** Verdeckt: kein Symbol im Kopf, keine Datumsachse. */
  hideIdentity?: boolean
  /** Die Zeitebene steht fest (sie gehört zur gespeicherten Übung). */
  lockTimeframe?: boolean
  /**
   * Höhe des Chartbereichs als Tailwind-Klasse. Der Trainer braucht mehr Fläche
   * als eine Karte am Trade — dort wird eine Struktur gelesen, nicht ein Stand
   * abgelesen. Ohne Angabe bleibt es bei der bisherigen Höhe.
   */
  heightClass?: string
  /**
   * Kurs-Aufnahme: Ist sie gesetzt, legt sich eine Ebene über den Chart, und
   * der nächste Klick meldet den Kurs an dieser Höhe statt zu zeichnen.
   *
   * Damit lassen sich Einstieg, Stop und Ziel dort setzen, wo die Struktur sie
   * verlangt — statt sie aus der Achse abzulesen und abzutippen. Genau so
   * arbeitet man auch im echten Chart.
   */
  pickPrice?: ((price: number) => void) | null
  /** Was gerade aufgenommen wird — erscheint als Hinweis auf der Ebene. */
  pickLabel?: string
  /**
   * Zeichnen erlauben, auch ohne Instrument und ohne Übung. Die Zeichnungen
   * werden dann **nicht gespeichert** — sie leben nur in dieser Ansicht.
   * Gedacht für das freie Replay, das ausdrücklich nichts festhält.
   */
  ephemeralDrawings?: boolean
}) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>(defaultTimeframe)
  const { interval, days } = TIMEFRAMES[timeframe]
  const { candles, loading, error, errorCode } = useCandles(symbol, market, interval, {
    stockId,
    trainingSessionId,
  })
  const [replayVisible, setReplayVisible] = useState<number | null>(null)

  // Zeichnungen einer Übung gehen an die Trainer-Aktionen, die des Instruments
  // an die Zeichnungs-Aktionen. Eine Übungslinie hat im echten Chart nichts zu
  // suchen — Übung und Ernstfall bleiben getrennt.
  const isTraining = trainingSessionId != null
  /**
   * Flüchtig zeichnen: Werkzeuge ohne Speicherort.
   *
   * Das freie Replay hat weder Instrument noch Übung — bis hier hieß das: gar
   * keine Werkzeuge. Für „einfach mal ein Replay fahren und dabei einzeichnen"
   * war das eine Lücke, denn Zeichnen IST die Analyse. Die Linien leben nur in
   * dieser Ansicht und verschwinden beim Verlassen; das passt zur Seite, die
   * ausdrücklich „keine Bewertung und keine Speicherung" verspricht.
   */
  const fluechtig = ephemeralDrawings && stockId == null && !isTraining
  const drawingsEnabled = stockId != null || isTraining || fluechtig

  useEffect(() => {
    if (!replayMode || !candles || candles.length === 0) {
      setReplayVisible(null)
      return
    }
    setReplayVisible(
      Math.min(
        candles.length,
        Math.max(1, replayStart ?? Math.max(30, Math.round(candles.length * 0.62))),
      ),
    )
  }, [replayMode, candles, replayStart])

  // Den geladenen Satz einmal nach oben melden (der Trainer schreibt Umfang und
  // Startpunkt in die Übung).
  useEffect(() => {
    if (candles && candles.length > 0) onCandlesLoaded?.(candles)
  }, [candles, onCandlesLoaded])

  const handleReplayChange = useCallback(
    (v: number) => {
      setReplayVisible(v)
      onReplayVisibleChange?.(v)
    },
    [onReplayVisibleChange],
  )

  const chartCandles = useMemo(() => {
    if (!candles) return null
    if (!replayMode || replayVisible == null) return candles
    return candles.slice(0, Math.min(candles.length, Math.max(1, replayVisible)))
  }, [candles, replayMode, replayVisible])

  // Identität der ANSICHT — nicht der Daten. Nur wenn sie wechselt, darf der
  // sichtbare Bereich neu gesetzt werden. Chart-Typ und Theme stehen bewusst
  // NICHT darin: Sie erzeugen zwar eine neue Serie, aber die Zeitachse gehört
  // dem Chart und behält ihren Zustand — ein Farbwechsel soll den Zoom nicht
  // kosten.
  const viewKey = `${symbol}|${market}|${timeframe}`
  const viewRef = useRef<string | null>(null)
  /** Kerzenzahl des letzten Durchlaufs — daran hängt das Mitlaufen im Replay. */
  const lastLenRef = useRef(0)

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
  /** Position und Kurs unter dem Zeiger, während ein Level aufgenommen wird. */
  const [pickAt, setPickAt] = useState<{ y: number; price: number } | null>(null)
  /**
   * Das Aussehen kommt aus den Einstellungen des Nutzers (Migration 0028) und
   * gilt in JEDEM Chart der App — Watchlist, Trade, Trainer.
   *
   * Bis es geladen ist, gilt der Auslieferungszustand. Ein Chart wartet nie auf
   * eine Einstellung; das frühere Umschalten „App / TradingView" ist zu zwei
   * Vorlagen im Dialog geworden.
   */
  const [appearance, setAppearance] = useState<ChartAppearance>(DEFAULT_APPEARANCE)
  const palette = appearance

  useEffect(() => {
    let lebt = true
    loadChartAppearance()
      .then((a) => {
        if (lebt) setAppearance(a)
      })
      .catch(() => {
        /* Der Standard bleibt stehen — lieber unverändert als leer. */
      })
    return () => {
      lebt = false
    }
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
    if (!drawingsEnabled) return
    setSelectedId(null)
    setDrawings([])
    if (fluechtig) return
    const p =
      trainingSessionId != null
        ? deleteAllTrainingAnnotations(trainingSessionId)
        : deleteAllDrawings(stockId!)
    p.catch(() => setDrawError('Zeichnungen konnten nicht gelöscht werden.'))
  }, [stockId, trainingSessionId, drawingsEnabled, fluechtig])
  // Debounce-Timer je Zeichnung, damit Verschieben nicht jede Mausbewegung speichert.
  const persistTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const handleCreate = useCallback(
    (type: Drawing['type'], points: DrawingPoint[]) => {
      if (!drawingsEnabled) return
      setDrawError(null)

      // Flüchtiger Modus (freies Replay): Es gibt kein Instrument und keine
      // Übung, also auch kein Ziel zum Speichern. Die Zeichnung lebt nur in
      // dieser Ansicht — negative Nummern, damit sie sich nie mit gespeicherten
      // Zeichnungen überschneiden.
      if (fluechtig) {
        const d: Drawing = { id: -Date.now(), type, points, style: null }
        setDrawings((ds) => [...ds, d])
        setSelectedId(d.id)
        return
      }

      const p =
        trainingSessionId != null
          ? createTrainingAnnotation({ sessionId: trainingSessionId, type, points })
          : createDrawing({ stockId: stockId!, type, points })
      p.then((d) => {
        setDrawings((ds) => [...ds, d])
        setSelectedId(d.id)
      }).catch(() => setDrawError('Zeichnung konnte nicht gespeichert werden.'))
    },
    [stockId, trainingSessionId, drawingsEnabled, fluechtig],
  )

  const handleUpdate = useCallback(
    (id: number, points: DrawingPoint[]) => {
      setDrawings((ds) => ds.map((d) => (d.id === id ? { ...d, points } : d)))
      if (fluechtig) return // nichts zu speichern
      const timers = persistTimers.current
      const prev = timers.get(id)
      if (prev) clearTimeout(prev)
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id)
          const p =
            trainingSessionId != null
              ? updateTrainingAnnotation({ id, points })
              : updateDrawing({ id, points })
          p.catch(() => setDrawError('Zeichnung konnte nicht gespeichert werden.'))
        }, 500),
      )
    },
    [trainingSessionId, fluechtig],
  )

  /** Eine Zeichnung entfernen — gemeinsamer Weg für Entf-Taste und Radiergummi. */
  const handleDeleteById = useCallback(
    (id: number) => {
      setSelectedId((s) => (s === id ? null : s))
      setDrawings((ds) => ds.filter((d) => d.id !== id))
      if (fluechtig) return
      const p =
        trainingSessionId != null ? deleteTrainingAnnotation(id) : deleteDrawing(id)
      p.catch(() => setDrawError('Zeichnung konnte nicht gelöscht werden.'))
    },
    [trainingSessionId, fluechtig],
  )

  const handleDeleteSelected = useCallback(() => {
    if (selectedId == null) return
    handleDeleteById(selectedId)
  }, [selectedId, handleDeleteById])

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
    if (!chartReady || !chart || !chartCandles || chartCandles.length === 0) return

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
      const specs = computeIndicator(chartCandles, inst, palette)
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
  }, [chartCandles, indicators, chartReady, palette])

  // Marker auf existierende Kerzenzeiten snappen (sonst zeigt lightweight-charts sie nicht an).
  const seriesMarkers = useMemo<SeriesMarker<Time>[]>(() => {
    if (!chartCandles || chartCandles.length === 0) return []
    const first = chartCandles[0].time
    return markers
      .filter((m) => m.time >= first)
      .map((m) => {
        let snapped = first
        for (const c of chartCandles) {
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
          color:
            m.kind === 'richtig'
              ? palette.up
              : m.kind === 'falsch'
                ? palette.down
                : CHART_COLORS.warning,
          text: m.text,
        }
      })
      .sort((a, b) => (a.time as number) - (b.time as number))
  }, [markers, chartCandles, palette])

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
        vertLines: { color: palette.grid, visible: palette.gridVisible },
        horzLines: { color: palette.grid, visible: palette.gridVisible },
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
        // Hohlkerzen wie TradingViews „Hollow Candles": Die steigende Kerze
        // bekommt keinen Körper, nur ihren Rand. Deshalb muss der Rand hier
        // immer gezeichnet werden — bei gleichen Farben sieht das aus wie
        // vorher, macht aber „nur Umriss" überhaupt erst möglich.
        upColor: palette.hollow ? 'rgba(0,0,0,0)' : palette.up,
        downColor: palette.down,
        wickUpColor: palette.wickUp,
        wickDownColor: palette.wickDown,
        borderVisible: true,
        borderUpColor: palette.borderUp,
        borderDownColor: palette.borderDown,
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
        vertLines: { color: palette.grid, visible: palette.gridVisible },
        horzLines: { color: palette.grid, visible: palette.gridVisible },
      },
      rightPriceScale: { borderColor: palette.border },
      timeScale: { borderColor: palette.border },
      crosshair: {
        horzLine: { labelBackgroundColor: palette.accent },
        vertLine: { labelBackgroundColor: palette.accent },
      },
    })
  }, [palette])

  // Verdeckte Übung: Die Zeitachse verschwindet mit dem Symbol. Ein Datum
  // verrät den Ausschnitt fast so zuverlässig wie der Ticker — wer „März 2020"
  // liest, analysiert nicht mehr, sondern erinnert sich.
  useEffect(() => {
    if (!chartReady) return
    chartRef.current?.applyOptions({
      timeScale: { visible: !hideIdentity },
      crosshair: { vertLine: { labelVisible: !hideIdentity } },
    })
  }, [hideIdentity, chartReady])

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
    if (!series || !chart || !chartCandles) return

    // Wo stand der Blick, BEVOR die neuen Daten kommen? Das muss vor `setData`
    // gelesen werden.
    const prevLen = lastLenRef.current
    const before = chart.timeScale().getVisibleLogicalRange()
    // Klebte der Blick am rechten Rand? Nur dann läuft er mit der neuen Kerze
    // mit. Wer nach links gescrollt hat, um sich etwas anzusehen, soll dort
    // bleiben — ein Chart, der einen wegreißt, ist im Replay unbrauchbar.
    const folgtDemRand = before != null && prevLen > 0 && before.to >= prevLen - 1.5

    if (chartStyle === 'line' || chartStyle === 'area') {
      series.setData(
        chartCandles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })),
      )
    } else {
      series.setData(
        chartCandles.map((c) => ({
          time: c.time as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })),
      )
    }

    markersRef.current?.setMarkers(seriesMarkers)

    const len = chartCandles.length

    if (viewRef.current !== viewKey) {
      // Neue Ansicht (anderes Instrument oder andere Zeitebene): Ausschnitt
      // einmal auf das gewählte Zeitfenster setzen.
      viewRef.current = viewKey
      if (days && len > 1) {
        const to = chartCandles[len - 1].time
        const from = Math.max(chartCandles[0].time, to - days * 86400)
        chart.timeScale().setVisibleRange({
          from: from as UTCTimestamp,
          to: to as UTCTimestamp,
        })
      } else {
        chart.timeScale().fitContent()
      }
    } else if (before && folgtDemRand && len !== prevLen) {
      // Dieselbe Ansicht, nur mehr (oder weniger) Kerzen — Zoomstufe halten und
      // den Ausschnitt um die Differenz mitziehen.
      const versatz = len - prevLen
      chart
        .timeScale()
        .setVisibleLogicalRange({ from: before.from + versatz, to: before.to + versatz })
    }
    // Sonst: den Ausschnitt bewusst NICHT anfassen. Genau hier wurde vorher bei
    // jeder Replay-Kerze der Zoom des Nutzers weggeworfen.

    lastLenRef.current = len
  }, [chartCandles, days, seriesMarkers, chartStyle, seriesVersion, viewKey])

  // OHLC-Legende oben links: Werte der Kerze unterm Crosshair (Direkt-DOM,
  // damit Mausbewegungen keine React-Renders auslösen).
  useEffect(() => {
    const chart = chartRef.current
    if (!chartReady || !chart || !chartCandles || chartCandles.length === 0) return
    const byTime = new Map(chartCandles.map((c, i) => [c.time, i]))
    const fmt = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 6 })
    const render = (i: number) => {
      const el = legendRef.current
      if (!el) return
      const c = chartCandles[i]
      const prev = i > 0 ? chartCandles[i - 1] : undefined
      const chg = prev ? ((c.close - prev.close) / prev.close) * 100 : 0
      const col = c.close >= (prev?.close ?? c.open) ? palette.up : palette.down
      el.innerHTML =
        `O <span style="color:${col}">${fmt(c.open)}</span> ` +
        `H <span style="color:${col}">${fmt(c.high)}</span> ` +
        `L <span style="color:${col}">${fmt(c.low)}</span> ` +
        `C <span style="color:${col}">${fmt(c.close)}</span> ` +
        `<span style="color:${col}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)} %</span>`
    }
    render(chartCandles.length - 1)
    const handler = (param: { time?: unknown }) => {
      const idx = typeof param.time === 'number' ? byTime.get(param.time) : undefined
      render(idx ?? chartCandles.length - 1)
    }
    chart.subscribeCrosshairMove(handler)
    return () => {
      try {
        chart.unsubscribeCrosshairMove(handler)
      } catch {
        /* Chart disposed */
      }
    }
  }, [chartCandles, chartReady, palette])

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
      // Ein PNG kann nicht „durchscheinen": Bei transparentem Chart-Grund
      // bekommt das Bild den Untergrund der App, auf dem der Chart auch liegt.
      ctx.fillStyle =
        palette.bg !== 'transparent' ? palette.bg : CHART_COLORS.background
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
  }, [symbol, palette])

  // Plan-Linien (Entry/Stop/Target/Invalidation) als Preislinien.
  useEffect(() => {
    const series = seriesRef.current
    if (!series || !chartCandles) return
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
  }, [planLines, chartCandles, seriesVersion])

  // Forex/Optionen: keine Gratis-Daten → Hinweis statt Chart (TradingView-Link bleibt).
  if (errorCode === 'unsupported') {
    return (
      <div className="panel p-4">
        <ChartEmpty
          icon={CandlestickChart}
          title="Für dieses Instrument gibt es keine Kerzen"
          hint={error ?? ''}
          className="h-[200px]"
        />
      </div>
    )
  }

  return (
    <div
      className={
        fullscreen
          ? 'fixed inset-0 z-50 flex flex-col bg-background p-3 sm:p-4'
          : 'panel rise-in p-4'
      }
    >
      {/* Derselbe Kopf wie über den Auswertungen daneben — Werkzeuge rechts. */}
      <ChartHeader
        icon={CandlestickChart}
        title={hideIdentity ? 'Kurschart · verdeckt' : `Kurschart · ${symbol}`}
        subtitle={
          hideIdentity
            ? 'Symbol und Datum bleiben verdeckt, bis du bewertet hast.'
            : replayMode
              ? 'Replay-Modus: Zukunft wird ausgeblendet, bis du sie Kerze für Kerze freigibst.'
              : 'Kerzen aus dem Zwischenspeicher — kein Echtzeitkurs.'
        }
        right={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
          <div className="flex gap-0.5">
            {(Object.keys(TIMEFRAMES) as (keyof typeof TIMEFRAMES)[]).map((tf) => (
              <Button
                key={tf}
                size="sm"
                variant={tf === timeframe ? 'secondary' : 'ghost'}
                className="h-7 px-1.5 font-mono text-[11px]"
                disabled={lockTimeframe && tf !== timeframe}
                title={
                  lockTimeframe
                    ? 'Die Zeitebene gehört zur gespeicherten Übung und steht fest.'
                    : undefined
                }
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
          {/* Das frühere „TV" (ein Umschalter zwischen zwei festen Schemata)
              ist hier aufgegangen: TradingView ist jetzt eine von vier
              Vorlagen, und jeder einzelne Wert ist danach änderbar. */}
          <ChartSettings
            value={appearance}
            onChange={setAppearance}
            onSave={saveChartAppearance}
            onReset={resetChartAppearance}
          />
          <IndicatorMenu config={indicators} onChange={handleIndicatorsChange} />
          {stockId != null && chartCandles && chartCandles.length > 0 && (
            <AnalysisImport
              stockId={stockId}
              candles={chartCandles}
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
        }
      />

      {drawError && <p className="note mb-2 text-destructive">{drawError}</p>}

      <div
        className={
          fullscreen
            ? 'flex min-h-0 flex-1 gap-1.5'
            : `flex gap-1.5 ${heightClass ?? 'h-[380px] sm:h-[440px]'}`
        }
      >
        {drawingsEnabled && (
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
            className="note pointer-events-none absolute left-2 top-1 z-20"
          />
          {drawingsEnabled &&
            drawingsVisible &&
            chartReady &&
            chartRef.current &&
            seriesRef.current &&
            chartCandles &&
            chartCandles.length > 0 && (
              <DrawingLayer
                chart={chartRef.current}
                series={seriesRef.current}
                candles={chartCandles}
                drawings={drawings}
                tool={tool}
                onToolDone={() => setTool('cursor')}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onCreate={handleCreate}
                onUpdate={handleUpdate}
                onDelete={handleDeleteById}
                magnet={magnet}
                locked={drawingsLocked}
              />
            )}
          {/* Kurs-Aufnahme: liegt ÜBER der Zeichenebene (z-30), damit ein Klick
              hier keine Zeichnung anlegt. Die Linie folgt dem Zeiger, damit man
              sieht, welchen Kurs man gerade nimmt — eine Zahl allein ließe sich
              nicht mit der Struktur im Chart abgleichen. */}
          {pickPrice && (
            <div
              className="absolute inset-0 z-30"
              style={{ cursor: 'crosshair' }}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                const y = e.clientY - rect.top
                const p = seriesRef.current?.coordinateToPrice(y)
                setPickAt(p != null ? { y, price: p } : null)
              }}
              onMouseLeave={() => setPickAt(null)}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                const p = seriesRef.current?.coordinateToPrice(e.clientY - rect.top)
                if (p != null && Number.isFinite(p)) pickPrice(p)
                setPickAt(null)
              }}
            >
              {pickAt && (
                <>
                  <div
                    className="pointer-events-none absolute left-0 right-0 border-t border-dashed"
                    style={{ top: pickAt.y, borderColor: palette.accent }}
                  />
                  <div
                    className="pointer-events-none absolute rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold"
                    style={{
                      top: pickAt.y - 10,
                      right: 76,
                      background: palette.accent,
                      color: CHART_COLORS.background,
                    }}
                  >
                    {/* Dieselbe Genauigkeit, die auch übernommen wird — eine
                        Vorschau mit sechs Nachkommastellen und ein Feld mit
                        zweien wären zwei verschiedene Zahlen. */}
                    {pickAt.price.toLocaleString('de-DE', {
                      maximumFractionDigits:
                        Math.abs(pickAt.price) >= 100 ? 2 : Math.abs(pickAt.price) >= 1 ? 4 : 6,
                    })}
                  </div>
                </>
              )}
              <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 font-mono text-[11px] text-primary-foreground">
                {pickLabel ?? 'Kurs wählen'} — klicken · Esc bricht ab
              </div>
            </div>
          )}

          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {error && !loading && errorCode !== 'unsupported' && (
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <p className="note text-center">{error}</p>
            </div>
          )}
        </div>
      </div>

      {/* Die Replay-Leiste sitzt UNTER dem Chart — dort, wo in TradingView die
          Zeitachse liegt und die Hand ohnehin hinfasst. */}
      {replayMode && candles && replayVisible != null && (
        <ChartReplayControls
          total={candles.length}
          visible={replayVisible}
          onChange={handleReplayChange}
          start={replayStart}
          maxVisible={replayMaxVisible}
          lockedHint={replayLockedHint}
        />
      )}
    </div>
  )
}
