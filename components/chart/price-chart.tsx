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
  type AutoscaleInfo,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import { useCandles } from './use-candles'
import { CHART_COLORS } from './colors'
import { ChartToolbar, type DrawTool } from './chart-toolbar'
import { loadChartTools, saveChartTools } from '@/app/actions/chart-tools'
import {
  DEFAULT_TOOL_PREFS,
  toggleFavorite,
  type ChartToolPrefs,
} from '@/lib/chart-tools'
import { DrawingLayer } from './drawing-layer'
import { DrawingStylePanel } from './drawing-style-panel'
import { DrawingStyleBar, type AuswahlRahmen } from './drawing-style-bar'
import { barStep } from '@/lib/chart-coords'
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
import {
  DEFAULT_DRAWING_DEFAULTS,
  stilFuerNeueZeichnung,
  type DrawingDefaults,
} from '@/lib/drawing-defaults'
import { loadDrawingDefaults, saveDrawingDefaults } from '@/app/actions/drawing-defaults'
import type { FibStil } from '@/lib/fib-levels'
import type { Candle } from '@/lib/market-data/types'
import { CHART_TIMEFRAMES, type ChartTimeframe } from '@/lib/chart-timeframes'
import {
  intervalSekunden,
  kerzenBisZeitpunkt,
  replayEnde,
} from '@/lib/replay-timeframes'
import { ansichtNeuSetzen, replayStand, startFenster } from '@/lib/replay-start'
import { preisachsenBreite } from './axis-dom'
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

/**
 * Ein Schritt im Zeichen-Journal (Rückgängig/Wiederholen).
 *
 * `erstellt` und `geloescht` führen die GANZE Zeichnung mit, nicht nur ihre
 * Nummer: Zum Wiederholen muss sie neu angelegt werden können, und dabei
 * vergibt der Server eine neue Nummer.
 */
type Zeichenaktion =
  | { art: 'erstellt'; d: Drawing }
  | { art: 'geloescht'; d: Drawing }
  | {
      art: 'geaendert'
      id: number
      vorher: { points: DrawingPoint[]; style: Drawing['style'] }
      nachher: { points: DrawingPoint[]; style: Drawing['style'] }
    }

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
  replayReleased,
  onReplayRelease,
  replayBasisTimeframe,
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
  /**
   * Ist der Durchlauf der Übung schon losgelassen? Ohne Angabe „ja" — Charts
   * außerhalb des Trainers haben nichts loszulassen.
   */
  replayReleased?: boolean
  /**
   * Den Durchlauf loslassen, wenn Play am Startpunkt gedrückt wird. Der Trainer
   * hält das als Enthaltung fest — siehe `training-workspace.tsx`.
   */
  onReplayRelease?: () => void
  /**
   * Die Zeitebene, in der der Replay läuft. Der Fortschritt zählt IMMER in
   * ihren Kerzen — sonst hieße „zehn Kerzen weiter" auf jeder Ebene etwas
   * anderes. Fehlt sie, gilt die anfangs eingestellte Ebene.
   */
  replayBasisTimeframe?: ChartTimeframe
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
    timeframe,
  })
  const [replayVisible, setReplayVisible] = useState<number | null>(null)

  // ---- Analyse von oben nach unten -----------------------------------------
  //
  // Der Replay läuft immer in EINER Zeitebene — der Basis. Sie bestimmt, wie
  // weit der Durchlauf gekommen ist. Wird eine andere Ebene angesehen, wird sie
  // auf genau denselben Moment zugeschnitten (`lib/replay-timeframes.ts`);
  // sonst zeigte die Tageskerze, in der man gerade steht, ihr fertiges Hoch und
  // Tief — also die Zukunft.
  const basisTimeframe: ChartTimeframe = replayBasisTimeframe ?? defaultTimeframe
  const basisInterval = TIMEFRAMES[basisTimeframe]?.interval ?? interval
  const brauchtBasis = replayMode && basisTimeframe !== timeframe
  const basisAbruf = useCandles(symbol, market, basisInterval, {
    stockId,
    trainingSessionId,
    timeframe: basisTimeframe,
    enabled: brauchtBasis,
  })
  const basisRoh = brauchtBasis ? basisAbruf.candles : candles
  /**
   * Beim Ebenenwechsel ist der zweite Abruf einen Moment unterwegs. Ohne diesen
   * Halter fiele der Replay-Stand in dieser Lücke auf „nichts" zurück und der
   * Durchlauf begänne von vorn — mitten in der Übung. Der Schlüssel sorgt
   * dafür, dass ein Satz nur für DAS Instrument und DIE Basis-Ebene gilt, zu
   * der er gehört.
   */
  const basisSchluessel = `${symbol}|${market}|${basisTimeframe}`
  const basisHalter = useRef<{ key: string; candles: Candle[] } | null>(null)
  if (basisRoh && basisRoh.length > 0) {
    basisHalter.current = { key: basisSchluessel, candles: basisRoh }
  }
  const basisKerzen =
    basisRoh ??
    (basisHalter.current?.key === basisSchluessel ? basisHalter.current.candles : null)

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

  // Der Replay-Stand wird nur gesetzt, wenn die GRUNDLAGE wechselt (anderes
  // Instrument oder andere Basis-Ebene) — nicht bei jedem neuen Kerzensatz.
  // Sonst spränge der Durchlauf beim Wechsel der angesehenen Zeitebene zurück
  // an den Anfang, und Top-Down-Analyse wäre unmöglich.
  //
  // Mit EINER Ausnahme, und die war der Grund, warum der Trainer unbenutzbar
  // war: Der Startpunkt einer Übung entsteht erst aus den Kerzen, die genau
  // dieser Chart lädt (`onCandlesLoaded` → `startIndexMitVorlauf`). Er trifft
  // also zwangsläufig NACH der ersten Initialisierung ein. Die Sperre lehnte
  // ihn dann ab, der Chart behielt seinen eigenen Stand von 62 % — und weil
  // die Obergrenze weiter unten nichts klemmte, lag die Zukunft offen und die
  // Bedienleiste stand auf „durchgelaufen". Deshalb wird ein nachgereichter
  // Startpunkt genau einmal nachgezogen; danach greift die Sperre wie zuvor.
  const replayInitRef = useRef<{ key: string; hatteStart: boolean } | null>(null)
  useEffect(() => {
    if (!replayMode || !basisKerzen || basisKerzen.length === 0) {
      if (!replayMode) {
        setReplayVisible(null)
        replayInitRef.current = null
      }
      return
    }
    const init = replayInitRef.current
    const nachziehen =
      init?.key === basisSchluessel && !init.hatteStart && replayStart != null
    if (init?.key === basisSchluessel && !nachziehen) return
    replayInitRef.current = { key: basisSchluessel, hatteStart: replayStart != null }
    setReplayVisible(
      replayStand(basisKerzen.length, replayStart ?? null, replayMaxVisible ?? null),
    )
  }, [replayMode, basisKerzen, replayStart, replayMaxVisible, basisSchluessel])

  /**
   * Der geltende Stand — der gespeicherte Wert, geklemmt an Reihe UND
   * Obergrenze.
   *
   * Abgeleitet statt gespeichert, weil die Obergrenze sich bewegt: Sie ist vor
   * dem Festschreiben der Startpunkt und danach der jeweils nächste
   * Haltepunkt. Ein zweiter Zustand daneben liefe beim nächsten Haltepunkt
   * auseinander — und genau dieses Auseinanderlaufen deckte die Zukunft auf.
   */
  const replayStandJetzt = useMemo(
    () =>
      replayVisible == null || !basisKerzen || basisKerzen.length === 0
        ? null
        : replayStand(basisKerzen.length, replayVisible, replayMaxVisible ?? null),
    [replayVisible, basisKerzen, replayMaxVisible],
  )

  // Den geladenen Satz einmal nach oben melden (der Trainer schreibt Umfang und
  // Startpunkt in die Übung).
  useEffect(() => {
    // Gemeldet wird die BASIS-Ebene: Der Trainer schreibt daraus Umfang und
    // Startpunkt der Übung fest, und beides zählt in Basis-Kerzen. Würde beim
    // Wechsel auf den Tageschart dessen Reihe gemeldet, verschöbe sich der
    // gespeicherte Startpunkt der laufenden Übung.
    const satz = replayMode ? basisKerzen : candles
    if (satz && satz.length > 0) onCandlesLoaded?.(satz)
  }, [candles, basisKerzen, replayMode, onCandlesLoaded])

  // Auch hier wird geklemmt: Ein Regler, der über die Obergrenze hinausläuft,
  // hebt die Sperre auf — und nach oben gemeldet werden darf nur ein Stand, den
  // die Übung auch freigegeben hat (daran hängen Haltepunkte und Messung).
  const handleReplayChange = useCallback(
    (v: number) => {
      const wert = replayStand(basisKerzen?.length ?? 0, v, replayMaxVisible ?? null)
      setReplayVisible(wert)
      onReplayVisibleChange?.(wert)
    },
    [onReplayVisibleChange, basisKerzen, replayMaxVisible],
  )

  const chartCandles = useMemo(() => {
    if (!candles) return null
    if (!replayMode || replayStandJetzt == null || !basisKerzen) return candles
    const basisS = intervalSekunden(basisInterval)
    const ende = replayEnde(basisKerzen, replayStandJetzt, basisS)
    if (ende == null) return candles
    // Bei gleicher Zeitebene ist das Ergebnis identisch mit dem früheren
    // `slice(0, sichtbar)` — geprüft in `lib/replay-timeframes.test.ts`.
    return kerzenBisZeitpunkt(candles, basisKerzen, ende, intervalSekunden(interval), basisS)
  }, [candles, basisKerzen, replayMode, replayStandJetzt, interval, basisInterval])

  // Identität der ANSICHT — nicht der Daten. Nur wenn sie wechselt, darf der
  // sichtbare Bereich neu gesetzt werden. Chart-Typ und Theme stehen bewusst
  // NICHT darin: Sie erzeugen zwar eine neue Serie, aber die Zeitachse gehört
  // dem Chart und behält ihren Zustand — ein Farbwechsel soll den Zoom nicht
  // kosten.
  const viewKey = `${symbol}|${market}|${timeframe}`
  // Neben der Ansicht wird mitgeführt, ob der Replay-Stand beim Setzen des
  // Ausschnitts schon bekannt war — aus demselben Grund wie oben: Beim ersten
  // Durchlauf ist er es nicht, und ein Ausschnitt, der auf dem ungeschnittenen
  // Satz gesetzt wurde, zeigt ans Ende der Historie statt an den Cursor.
  /**
   * Wofür der sichtbare Ausschnitt zuletzt gesetzt wurde.
   *
   * `ersteZeit` trennt zwei Fälle, die im Code bis hier gleich aussahen und
   * gegensätzlich behandelt werden müssen:
   *  - **Der Replay läuft:** dieselbe Reihe WÄCHST hinten. Die erste Kerze
   *    bleibt, der Ausschnitt wird mitgezogen, der Zoom des Nutzers überlebt.
   *  - **Die Zeitebene wechselt:** die Reihe wird AUSGETAUSCHT. Die erste Kerze
   *    ist eine andere, und der Ausschnitt muss neu gesetzt werden.
   *
   * Ohne diese Unterscheidung wurde der Wechsel als Weiterlaufen gelesen.
   * Gemessen: Der Ausschnitt wurde bei 120 Kerzen gesetzt (noch der Zuschnitt
   * der alten Ebene) und beim Eintreffen der 2290 neuen um 2170 Stellen
   * verschoben — also hinter die Daten. Die höhere Zeitebene lag damit
   * zusammengedrängt am Rand und war nicht mehr zu lesen. Genau dafür ist sie
   * aber da: „gehandelt wird von oben nach unten" (`lib/replay-timeframes.ts`).
   */
  const viewRef = useRef<{ key: string; hatteReplay: boolean; ersteZeit: number } | null>(
    null,
  )
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

  // ---- Preis-Zoom ----------------------------------------------------------
  //
  // Im Replay ließ sich der Kurs nicht heranholen: Die Zeitachse zoomt per
  // Mausrad, die PREISACHSE aber nur durch Ziehen an ihr — und das war weder
  // auffindbar noch (unter der Zeichenebene) zuverlässig erreichbar. Bei einer
  // ruhigen Seitwärtsphase sind die Kerzen dann Striche, und man soll daran
  // eine Struktur erkennen.
  //
  // Gemacht wird das über `autoscaleInfoProvider` — die dokumentierte Stelle,
  // an der eine Serie ihren eigenen Preisbereich bestimmt. Der Faktor staucht
  // den automatisch ermittelten Bereich um die Mitte: > 1 holt heran, < 1
  // rückt weg. Kein Eingriff in die Daten, keine zweite Wahrheit — und
  // „Auto" ist einfach der Faktor 1.
  const [preisFaktor, setPreisFaktor] = useState(1)
  const preisFaktorRef = useRef(1)
  preisFaktorRef.current = preisFaktor

  const preisZoom = useCallback((richtung: number) => {
    setPreisFaktor((f) => {
      const next = f * (richtung > 0 ? 1.25 : 1 / 1.25)
      // Grenzen, damit die Skala nicht in einen Zustand läuft, aus dem heraus
      // nichts mehr zu sehen ist.
      return Math.min(20, Math.max(0.1, Math.round(next * 1000) / 1000))
    })
  }, [])
  const preisZoomZurueck = useCallback(() => setPreisFaktor(1), [])
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
  const [drawingsLocked, setDrawingsLocked] = useState(false)
  const [drawingsVisible, setDrawingsVisible] = useState(true)

  /**
   * Favoriten, „Werkzeug bleibt aktiv" und Magnet — am Nutzer gespeichert
   * (Migration 0031), nicht im Browser. Eine Übung, die auf dem zweiten Rechner
   * anders bedient wird als der Ernstfall, übt das Falsche.
   *
   * Bis die Einstellung geladen ist, gilt der Auslieferungszustand; scheitert
   * das Laden, bleibt es dabei. Zeichnen darf an einer Einstellungsfrage nicht
   * scheitern.
   */
  const [toolPrefs, setToolPrefs] = useState<ChartToolPrefs>(DEFAULT_TOOL_PREFS)
  useEffect(() => {
    if (!drawingsEnabled) return
    let lebt = true
    loadChartTools()
      .then((p) => {
        if (lebt) setToolPrefs(p)
      })
      .catch(() => {
        /* Auslieferungszustand bleibt. */
      })
    return () => {
      lebt = false
    }
  }, [drawingsEnabled])

  /** Sofort im Bild, danach sichern — eine Leiste soll nicht auf das Netz warten. */
  const toolPrefsSetzen = useCallback((next: ChartToolPrefs) => {
    setToolPrefs(next)
    saveChartTools(next).catch(() =>
      setDrawError('Werkzeug-Einstellung konnte nicht gesichert werden.'),
    )
  }, [])

  const magnet = toolPrefs.magnet

  // Die eigenen Zeichen-Standards (Fib-Levels, Farbe, Stärke). Sie werden
  // einmal geholt; scheitert das, gilt der Auslieferungszustand — Zeichnen darf
  // an einer Einstellungsfrage nicht scheitern.
  const [zeichenStandards, setZeichenStandards] = useState<DrawingDefaults>(
    DEFAULT_DRAWING_DEFAULTS,
  )
  useEffect(() => {
    if (!drawingsEnabled) return
    let aktiv = true
    loadDrawingDefaults()
      .then((d) => {
        if (aktiv) setZeichenStandards(d)
      })
      .catch(() => {})
    return () => {
      aktiv = false
    }
  }, [drawingsEnabled])

  // Werkzeugwahl blendet ausgeblendete Zeichnungen automatisch wieder ein.
  const handleToolChange = useCallback((t: DrawTool) => {
    setTool(t)
    if (t !== 'cursor') setDrawingsVisible(true)
  }, [])

  // ---- Rückgängig / Wiederholen --------------------------------------------
  //
  // Ein Zeichenwerkzeug ohne Rückgängig zwingt dazu, jeden Strich beim ersten
  // Mal zu treffen — man traut sich dann nicht, etwas auszuprobieren, und genau
  // das Ausprobieren ist der Sinn des Übens.
  //
  // Geführt wird ein Journal der ÄNDERUNGEN, kein Abbild des ganzen Zustands:
  // Die Zeichnungen liegen auch auf dem Server, ein zurückgespieltes Abbild
  // müsste dort alles neu schreiben. Beim Zurücknehmen eines Löschvorgangs
  // entsteht eine neue Nummer — deshalb ziehen `ersetzeNummer` die Einträge
  // mit, die noch auf die alte zeigen.
  const undoStapel = useRef<Zeichenaktion[]>([])
  const redoStapel = useRef<Zeichenaktion[]>([])
  const [undoStand, setUndoStand] = useState({ undo: 0, redo: 0 })
  const staendeMelden = useCallback(() => {
    setUndoStand({ undo: undoStapel.current.length, redo: redoStapel.current.length })
  }, [])

  const merken = useCallback(
    (a: Zeichenaktion) => {
      undoStapel.current = [...undoStapel.current.slice(-49), a]
      // Ein neuer Strich beendet den Wiederholen-Faden — sonst stellte man
      // Änderungen wieder her, die zu einem anderen Verlauf gehören.
      redoStapel.current = []
      staendeMelden()
    },
    [staendeMelden],
  )

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
  /** Wann eine Zeichnung zuletzt bewegt wurde — bündelt eine Zieh-Bewegung im Journal. */
  const letzteBewegung = useRef<Map<number, number>>(new Map())

  const handleCreate = useCallback(
    (type: Drawing['type'], points: DrawingPoint[]) => {
      if (!drawingsEnabled) return
      setDrawError(null)

      // Flüchtiger Modus (freies Replay): Es gibt kein Instrument und keine
      // Übung, also auch kein Ziel zum Speichern. Die Zeichnung lebt nur in
      // dieser Ansicht — negative Nummern, damit sie sich nie mit gespeicherten
      // Zeichnungen überschneiden.
      // Eine neue Zeichnung startet mit den EIGENEN Standards — sonst müsste
      // man seine Fib-Levels bei jeder einzelnen Zeichnung neu einstellen.
      const style = stilFuerNeueZeichnung(zeichenStandards, type)

      if (fluechtig) {
        const d: Drawing = { id: -Date.now(), type, points, style }
        setDrawings((ds) => [...ds, d])
        setSelectedId(d.id)
        merken({ art: 'erstellt', d })
        return
      }

      const p =
        trainingSessionId != null
          ? createTrainingAnnotation({ sessionId: trainingSessionId, type, points, style })
          : createDrawing({ stockId: stockId!, type, points, style })
      p.then((d) => {
        setDrawings((ds) => [...ds, d])
        setSelectedId(d.id)
        merken({ art: 'erstellt', d })
      }).catch(() => setDrawError('Zeichnung konnte nicht gespeichert werden.'))
    },
    [stockId, trainingSessionId, drawingsEnabled, fluechtig, zeichenStandards, merken],
  )

  /**
   * Nur das Aussehen ändern — die Punkte bleiben, wie sie sind.
   *
   * Getrennt vom Verschieben, weil hier NICHT entprellt werden darf: Ein Klick
   * auf eine Farbe ist eine einzelne Absicht, keine Folge von Mausbewegungen.
   */
  const handleStyleChange = useCallback(
    (id: number, style: Drawing['style']) => {
      let punkte: DrawingPoint[] | null = null
      setDrawings((ds) =>
        ds.map((d) => {
          if (d.id !== id) return d
          punkte = d.points
          merken({
            art: 'geaendert',
            id,
            vorher: { points: d.points, style: d.style },
            nachher: { points: d.points, style },
          })
          return { ...d, style }
        }),
      )
      if (fluechtig || punkte == null) return
      const p =
        trainingSessionId != null
          ? updateTrainingAnnotation({ id, points: punkte, style })
          : updateDrawing({ id, points: punkte, style })
      p.catch(() => setDrawError('Zeichnung konnte nicht gespeichert werden.'))
    },
    [trainingSessionId, fluechtig, merken],
  )

  /**
   * Einen Journalschritt ausführen — in beide Richtungen dieselbe Mechanik.
   *
   * Beim Wiederherstellen einer gelöschten Zeichnung vergibt der Server eine
   * NEUE Nummer. Alle Journaleinträge, die noch auf die alte zeigen, werden
   * deshalb mitgezogen; täte man das nicht, liefe der nächste Schritt ins Leere
   * und „rückgängig" fühlte sich kaputt an.
   */
  const ersetzeNummer = useCallback((alt: number, neu: number) => {
    const tausch = (a: Zeichenaktion): Zeichenaktion => {
      if (a.art === 'geaendert' && a.id === alt) return { ...a, id: neu }
      if (a.art !== 'geaendert' && a.d.id === alt) return { ...a, d: { ...a.d, id: neu } }
      return a
    }
    undoStapel.current = undoStapel.current.map(tausch)
    redoStapel.current = redoStapel.current.map(tausch)
  }, [])

  const zeichnungWiederherstellen = useCallback(
    (d: Drawing): Promise<number> => {
      if (fluechtig) {
        const neu = { ...d, id: -Date.now() }
        setDrawings((ds) => [...ds, neu])
        return Promise.resolve(neu.id)
      }
      const p =
        trainingSessionId != null
          ? createTrainingAnnotation({
              sessionId: trainingSessionId,
              type: d.type,
              points: d.points,
              style: d.style,
            })
          : createDrawing({
              stockId: stockId!,
              type: d.type,
              points: d.points,
              style: d.style,
            })
      return p.then((neu) => {
        setDrawings((ds) => [...ds, neu])
        return neu.id
      })
    },
    [fluechtig, trainingSessionId, stockId],
  )

  const zeichnungEntfernen = useCallback(
    (id: number) => {
      setSelectedId((s) => (s === id ? null : s))
      setDrawings((ds) => ds.filter((d) => d.id !== id))
      if (fluechtig) return
      const p = trainingSessionId != null ? deleteTrainingAnnotation(id) : deleteDrawing(id)
      p.catch(() => setDrawError('Zeichnung konnte nicht gelöscht werden.'))
    },
    [fluechtig, trainingSessionId],
  )

  /**
   * Eine Zeichnung klonen (Kontextmenü und Strg+D) — wie TradingViews „Klon".
   *
   * Die Kopie liegt deckungsgleich über dem Original und ist sofort ausgewählt;
   * der nächste Zug schiebt sie weg. Ein erfundener Versatz wäre die
   * Alternative gewesen — aber „um wie viel" ist bei einer waagerechten Linie
   * eine andere Frage als bei einem Elliott-Zug, und geraten sitzt die Kopie
   * dann garantiert falsch.
   */
  const zeichnungKlonen = useCallback(
    (id: number) => {
      const d = drawings.find((x) => x.id === id)
      if (!d) return
      zeichnungWiederherstellen(d)
        .then((neu) => {
          setSelectedId(neu)
          merken({ art: 'erstellt', d: { ...d, id: neu } })
        })
        .catch(() => setDrawError('Kopie konnte nicht angelegt werden.'))
    },
    [drawings, zeichnungWiederherstellen, merken],
  )

  const zeichnungSetzen = useCallback(
    (id: number, stand: { points: DrawingPoint[]; style: Drawing['style'] }) => {
      setDrawings((ds) =>
        ds.map((d) => (d.id === id ? { ...d, points: stand.points, style: stand.style } : d)),
      )
      if (fluechtig) return
      const p =
        trainingSessionId != null
          ? updateTrainingAnnotation({ id, points: stand.points, style: stand.style })
          : updateDrawing({ id, points: stand.points, style: stand.style })
      p.catch(() => setDrawError('Zeichnung konnte nicht gespeichert werden.'))
    },
    [fluechtig, trainingSessionId],
  )

  /**
   * Einen Eintrag ausführen. `rueckwaerts` = rückgängig machen, sonst
   * wiederholen. Ein Eintrag beschreibt immer, was PASSIERT ist — daraus
   * ergeben sich beide Richtungen von selbst.
   */
  const schrittAusfuehren = useCallback(
    (a: Zeichenaktion, rueckwaerts: boolean) => {
      if (a.art === 'geaendert') {
        zeichnungSetzen(a.id, rueckwaerts ? a.vorher : a.nachher)
        return
      }
      // erstellt: zurück = löschen, vor = neu anlegen. geloescht: umgekehrt.
      const anlegen = a.art === 'geloescht' ? rueckwaerts : !rueckwaerts
      if (anlegen) {
        zeichnungWiederherstellen(a.d)
          .then((neu) => ersetzeNummer(a.d.id, neu))
          .catch(() => setDrawError('Zeichnung konnte nicht wiederhergestellt werden.'))
      } else {
        zeichnungEntfernen(a.d.id)
      }
    },
    [zeichnungEntfernen, zeichnungWiederherstellen, zeichnungSetzen, ersetzeNummer],
  )

  const handleUndo = useCallback(() => {
    const a = undoStapel.current.pop()
    if (!a) return
    redoStapel.current = [...redoStapel.current, a]
    schrittAusfuehren(a, true)
    staendeMelden()
  }, [schrittAusfuehren, staendeMelden])

  const handleRedo = useCallback(() => {
    const a = redoStapel.current.pop()
    if (!a) return
    undoStapel.current = [...undoStapel.current, a]
    schrittAusfuehren(a, false)
    staendeMelden()
  }, [schrittAusfuehren, staendeMelden])

  // Strg+Z / Strg+Umschalt+Z (bzw. Strg+Y). Nicht, wenn ein Feld den Fokus hat.
  useEffect(() => {
    if (!drawingsEnabled) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault()
        handleRedo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawingsEnabled, handleUndo, handleRedo])

  const ausgewaehlteZeichnung = useMemo(
    () => (selectedId == null ? null : (drawings.find((d) => d.id === selectedId) ?? null)),
    [drawings, selectedId],
  )

  /**
   * Wo die ausgewählte Zeichnung im Fenster liegt — Anker der schwebenden
   * Stil-Leiste. Gemeldet von der Zeichenebene, weil nur sie Zeit/Kurs in Pixel
   * umrechnen kann.
   *
   * Verglichen wird VOR dem Setzen: Die Ebene meldet bei jeder Bewegung der
   * Zeitachse, und ein blindes `setState` je Meldung wäre im Replay ein
   * Rendern je Kerze für eine Leiste, die sich meist gar nicht bewegt.
   */
  const [auswahlRahmen, setAuswahlRahmen] = useState<AuswahlRahmen | null>(null)
  const rahmenMelden = useCallback((box: AuswahlRahmen | null) => {
    setAuswahlRahmen((alt) => {
      if (alt === box) return alt
      if (!alt || !box) return box
      const gleich =
        Math.abs(alt.left - box.left) < 0.5 &&
        Math.abs(alt.top - box.top) < 0.5 &&
        Math.abs(alt.right - box.right) < 0.5 &&
        Math.abs(alt.bottom - box.bottom) < 0.5
      return gleich ? alt : box
    })
  }, [])

  /**
   * Ist der volle Eigenschaften-Dialog offen?
   *
   * Er geht seit der schwebenden Leiste NUR noch auf Verlangen auf (Zahnrad
   * oder Rechtsklick → Einstellungen). Vorher erschien er bei jeder Auswahl und
   * verdeckte mit 248 px genau den Teil des Charts, in dem die Zeichnung liegt
   * — man wählte etwas aus, um es anzusehen, und sah es dann nicht mehr.
   */
  const [stilOffen, setStilOffen] = useState(false)
  useEffect(() => setStilOffen(false), [selectedId])

  /** Zeitraster der gezeigten Kerzen — für die Balkenzahl im Koordinaten-Feld. */
  const zeichenZeiten = useMemo(() => (chartCandles ?? []).map((c) => c.time), [chartCandles])
  const zeichenStep = useMemo(() => barStep(zeichenZeiten), [zeichenZeiten])

  /**
   * Wo das Eigenschaften-Panel sitzt. Muss aus dem Chart-Rahmen gerechnet
   * werden, weil das Panel am `<body>` hängt und dort nichts über seine Lage im
   * Layout weiß. Bei Scrollen und Größenänderung wird nachgezogen — sonst
   * bliebe es stehen, während der Chart wegwandert.
   */
  const [panelAnker, setPanelAnker] = useState<{ top: number; left: number } | null>(null)
  useEffect(() => {
    if (ausgewaehlteZeichnung == null) {
      setPanelAnker(null)
      return
    }
    const messen = () => {
      const el = containerWrapRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const breite = 248
      setPanelAnker({
        top: Math.max(8, Math.min(r.top + 8, window.innerHeight - 200)),
        // Rechts an die Preisachse gelegt: Links liegt die Werkzeugleiste, und
        // über der Chartmitte verdeckte das Panel genau das, was man ansieht.
        left: Math.max(8, Math.min(r.right - breite - 78, window.innerWidth - breite - 8)),
      })
    }
    messen()
    window.addEventListener('scroll', messen, true)
    window.addEventListener('resize', messen)
    return () => {
      window.removeEventListener('scroll', messen, true)
      window.removeEventListener('resize', messen)
    }
  }, [ausgewaehlteZeichnung])

  /** Die Fib-Einstellung dieser Zeichnung als eigenen Standard sichern. */
  const handleSaveDefault = useCallback(
    (typ: 'fib' | 'fibext', stil: FibStil) => {
      const next = { ...zeichenStandards, [typ]: stil }
      setZeichenStandards(next)
      saveDrawingDefaults(next).catch(() =>
        setDrawError('Standard konnte nicht gesichert werden.'),
      )
    },
    [zeichenStandards],
  )

  /**
   * Farbe und Stärke dieser Zeichnung als Standard für neue sichern („…" in der
   * schwebenden Leiste).
   *
   * Das ist unsere Antwort auf TradingViews „Templates" — bewusst EIN Standard
   * je Werkzeug statt eines zweiten, benannten Vorrats an Stilen. Zwei Quellen
   * dafür, wie eine neue Zeichnung aussieht, liefen unweigerlich auseinander.
   */
  const handleSaveStilDefault = useCallback(
    (farbe: string, staerke: number) => {
      const next = { ...zeichenStandards, farbe, staerke }
      setZeichenStandards(next)
      saveDrawingDefaults(next).catch(() =>
        setDrawError('Standard konnte nicht gesichert werden.'),
      )
    },
    [zeichenStandards],
  )

  const handleUpdate = useCallback(
    (id: number, points: DrawingPoint[]) => {
      // Fürs Journal zählt eine ganze Zieh-Bewegung als EIN Schritt, nicht
      // jede Mausbewegung — sonst müsste man fünfzig Mal zurücknehmen, um eine
      // Linie an ihren Ausgangsort zu bringen. Erkannt an der Pause zwischen
      // zwei Aktualisierungen; bewusst nicht am Speicher-Timer, denn im
      // flüchtigen Modus wird gar nicht gespeichert.
      const jetzt = Date.now()
      const laeuftSchon = jetzt - (letzteBewegung.current.get(id) ?? 0) < 700
      letzteBewegung.current.set(id, jetzt)
      setDrawings((ds) =>
        ds.map((d) => {
          if (d.id !== id) return d
          if (!laeuftSchon) {
            merken({
              art: 'geaendert',
              id,
              vorher: { points: d.points, style: d.style },
              nachher: { points, style: d.style },
            })
          } else {
            const oben = undoStapel.current[undoStapel.current.length - 1]
            if (oben?.art === 'geaendert' && oben.id === id) {
              oben.nachher = { points, style: d.style }
            }
          }
          return { ...d, points }
        }),
      )
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
      setDrawings((ds) => {
        const weg = ds.find((d) => d.id === id)
        // Die ganze Zeichnung ins Journal, nicht nur ihre Nummer: Zum
        // Zurücknehmen muss sie neu angelegt werden können.
        if (weg) merken({ art: 'geloescht', d: weg })
        return ds.filter((d) => d.id !== id)
      })
      if (fluechtig) return
      const p =
        trainingSessionId != null ? deleteTrainingAnnotation(id) : deleteDrawing(id)
      p.catch(() => setDrawError('Zeichnung konnte nicht gelöscht werden.'))
    },
    [trainingSessionId, fluechtig, merken],
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
  /** Die Indikator-Serien; der Preis-Zoom muss sie mitziehen (siehe dort). */
  const overlaySerienRef = useRef<ISeriesApi<SeriesType>[]>([])
  /** Zählt hoch, wenn die Overlays neu entstanden sind. */
  const [overlayVersion, setOverlayVersion] = useState(0)

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

    // Die Overlays im Hauptbereich teilen sich die rechte Preisachse mit den
    // Kerzen. Der Preis-Zoom muss sie deshalb kennen — siehe dort.
    overlaySerienRef.current = added
    setOverlayVersion((v) => v + 1)

    return () => {
      // Beim Unmount kann der Chart bereits entsorgt sein — dann ist nichts zu tun.
      try {
        for (const s of added) chart.removeSeries(s)
      } catch {
        /* Chart disposed */
      }
      overlaySerienRef.current = []
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

  // Preis-Zoom auf die Serie legen. Der Faktor steckt IM Aufruf und nicht nur
  // in einem Ref: `applyOptions` ist zugleich das Signal, den Preisbereich neu
  // zu rechnen — ohne den erneuten Aufruf bliebe die Skala stehen.
  useEffect(() => {
    const series = seriesRef.current
    if (!chartReady || !series) return

    /*
     * Der Preis-Zoom muss auf ALLE Serien der rechten Achse, nicht nur auf die
     * Kerzen.
     *
     * Eine Preisskala nimmt den Bereich, den ihre Serien zusammen brauchen —
     * die VEREINIGUNG. Stauchte man nur die Kerzenserie, blieb die breiteste
     * andere Serie stehen und die Achse änderte sich um kein Pixel. Genau
     * deshalb wirkten „+/−", „Auto" und Umschalt+Pfeil bei eingeschalteten
     * Indikatoren nicht: Die Bollinger-Bänder liegen außen und hielten den
     * Bereich fest. Ohne Indikatoren wirkte es, mit ihnen nicht — was den
     * Fehler so lange verdeckt hat.
     *
     * Damit die Vereinigung aufgeht, geben alle beteiligten Serien denselben
     * Bereich zurück. Grundlage ist der Kursbereich der sichtbaren Kerzen:
     * Er ist das, was man beim Heranholen ansehen will, und er hängt nicht
     * davon ab, in welcher Reihenfolge die Serien gefragt werden.
     *
     * Beim Faktor 1 („Auto") wird nichts angefasst — dann gilt weiter, was der
     * Chart selbst ausrechnet, samt der Bänder außen herum.
     */
    const provider = (original: () => AutoscaleInfo | null): AutoscaleInfo | null => {
      const res = original()
      if (preisFaktor === 1 || !chartCandles || chartCandles.length === 0) return res
      let min = Infinity
      let max = -Infinity
      for (const c of chartCandles) {
        if (c.low < min) min = c.low
        if (c.high > max) max = c.high
      }
      if (!Number.isFinite(min) || !Number.isFinite(max)) return res
      const mitte = (min + max) / 2
      const halb = (max - min) / 2 / preisFaktor
      // Ein Bereich der Breite 0 wäre eine unbrauchbare Achse.
      if (!(halb > 0)) return res
      return { priceRange: { minValue: mitte - halb, maxValue: mitte + halb } }
    }

    for (const s of [series, ...overlaySerienRef.current]) {
      try {
        s.applyOptions({ autoscaleInfoProvider: provider })
      } catch {
        /* Eine entfernte Serie darf den Zoom nicht kosten. */
      }
    }

    // Den Provider zu setzen genügt nicht: Er wird erst beim nächsten
    // Neuberechnen gefragt, und ein reiner Optionswechsel löst keines aus —
    // der Chart hielt deshalb stur seinen alten Bereich. `autoScale: true`
    // ist zugleich das Signal, den Bereich jetzt neu zu bestimmen, und die
    // Bedingung dafür, dass der Provider überhaupt zuständig ist: Nach einem
    // Ziehen an der Achse steht die Skala auf manuell und ignoriert ihn.
    try {
      series.priceScale().applyOptions({ autoScale: true })
    } catch {
      /* Ohne Achse gibt es nichts zu zoomen. */
    }
  }, [preisFaktor, chartReady, seriesVersion, overlayVersion, chartCandles])

  // Umschalt + Pfeil hoch/runter zoomt den Preis. Beim Üben liegt der Blick im
  // Chart — derselbe Gedanke wie bei den Replay-Tasten (Leertaste, ← →).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      e.preventDefault()
      preisZoom(e.key === 'ArrowUp' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preisZoom])

  /**
   * Mausrad ÜBER der Preisachse zoomt nur den Preis — wie in TradingView.
   *
   * Über dem Chart selbst zoomt das Rad weiterhin die Zeit; das ist die
   * Gewohnheit aus jedem Chartprogramm und wird nicht angefasst. Über der
   * Achse dagegen erwartet die Hand die Preisskala, und bisher scrollte dort
   * ebenfalls die Zeit — die Preisachse war nur durch Ziehen erreichbar, und
   * das findet niemand.
   *
   * Die Achsenbreite wird beim Chart erfragt statt geschätzt: Sie wächst mit
   * der Länge der Kurse (63.533,80 ist breiter als 77,26). Ein fester Wert
   * ließe je nach Instrument einen Streifen der Achse auf dem Zeit-Zoom.
   *
   * `passive: false`, weil sonst kein `preventDefault` möglich ist — ohne das
   * zoomt der Chart die Zeit mit und die Seite scrollt zusätzlich weg.
   */
  useEffect(() => {
    const el = containerWrapRef.current
    if (!chartReady || !el) return

    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect()
      const breite = preisachsenBreite(el)
      if (e.clientX < rect.right - breite) return
      e.preventDefault()
      e.stopPropagation()
      // Nach oben gedreht (deltaY < 0) heißt heranholen — dieselbe Richtung
      // wie beim Zeit-Zoom und wie bei Umschalt + Pfeil hoch.
      preisZoom(e.deltaY < 0 ? 1 : -1)
    }

    el.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => el.removeEventListener('wheel', onWheel, { capture: true })
  }, [chartReady, preisZoom])

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

    // Im Replay zählt der Ausschnitt in KERZEN, nicht in Tagen. Das Zeitfenster
    // der Ebene (`days`) ist dort die falsche Größe: Bei einem Vorlauf von 800
    // Kerzen auf der 15-Minuten-Ebene deckt es einen Bruchteil davon ab — der
    // gewählte Kontext, für den der Vorlauf überhaupt existiert, wäre nicht zu
    // sehen. Gezeigt wird deshalb ein lesbares Fenster am rechten Rand; die
    // letzte freigegebene Kerze ist die letzte im Bild, dahinter kommt nichts.
    const replayFenster = replayMode && replayStandJetzt != null
    const ersteZeit = len > 0 ? chartCandles[0].time : 0

    // Die Entscheidung selbst steht rein und getestet in `lib/replay-start.ts`.
    if (ansichtNeuSetzen(viewRef.current, { key: viewKey, ersteZeit, replayFenster, len })) {
      viewRef.current = {
        key: viewKey,
        hatteReplay: replayMode ? replayFenster : true,
        ersteZeit,
      }
      if (replayFenster) {
        const fenster = startFenster(len)
        chart.timeScale().setVisibleLogicalRange({ from: len - fenster, to: len - 0.5 })
      } else if (days) {
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
  }, [
    chartCandles,
    days,
    seriesMarkers,
    chartStyle,
    seriesVersion,
    viewKey,
    replayMode,
    replayStandJetzt,
  ])

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
                    : replayMode && tf === basisTimeframe
                      ? 'Zeitebene des Durchlaufs — hier zählt der Replay seine Kerzen.'
                      : replayMode
                        ? 'Andere Zeitebene, auf denselben Moment zugeschnitten. Die angebrochene Kerze wird mitgerechnet, nicht vorweggenommen.'
                        : undefined
                }
                onClick={() => setTimeframe(tf)}
              >
                {tf}
                {/* Ein Punkt an der Basis-Ebene: Ohne ihn weiß man beim
                    Zurückschalten nicht mehr, in welcher Ebene der Durchlauf
                    eigentlich zählt. */}
                {replayMode && tf === basisTimeframe && (
                  <span className="ml-0.5 text-accent" aria-hidden>
                    ·
                  </span>
                )}
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
          {/* Preis-Skala. Ziehen an der Achse zoomt sie — das ist in
              lightweight-charts eingebaut, war aber nicht auffindbar und lag
              zeitweise unter der Zeichenebene. Die Knöpfe machen es sichtbar
              und geben den Weg zurück: Ohne „Auto" bleibt eine einmal von Hand
              gestauchte Achse für den Rest der Übung schief. */}
          <div className="flex items-center gap-0.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 font-mono text-[13px] leading-none"
              title="Preis-Skala dehnen (Umschalt + Pfeil hoch)"
              aria-label="Preis-Skala dehnen"
              onClick={() => preisZoom(1)}
            >
              +
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 font-mono text-[13px] leading-none"
              title="Preis-Skala stauchen (Umschalt + Pfeil runter)"
              aria-label="Preis-Skala stauchen"
              onClick={() => preisZoom(-1)}
            >
              −
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-1.5 font-mono text-[10px]"
              title="Preis-Skala zurücksetzen (Doppelklick auf die Achse geht auch)"
              onClick={preisZoomZurueck}
            >
              Auto
            </Button>
          </div>
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
            onMagnetChange={(v) => toolPrefsSetzen({ ...toolPrefs, magnet: v })}
            favorites={toolPrefs.favorites}
            onToggleFavorite={(id) =>
              toolPrefsSetzen({
                ...toolPrefs,
                favorites: toggleFavorite(toolPrefs.favorites, id),
              })
            }
            keepTool={toolPrefs.keepTool}
            onKeepToolChange={(v) => toolPrefsSetzen({ ...toolPrefs, keepTool: v })}
            locked={drawingsLocked}
            onLockedChange={setDrawingsLocked}
            drawingsVisible={drawingsVisible}
            onDrawingsVisibleChange={setDrawingsVisible}
            onDeleteAll={handleDeleteAll}
            hasDrawings={drawings.length > 0}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={undoStand.undo > 0}
            canRedo={undoStand.redo > 0}
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
                keepTool={toolPrefs.keepTool}
                onClone={zeichnungKlonen}
                onLockedChange={setDrawingsLocked}
                onOpenStyle={(id) => {
                  setSelectedId(id)
                  setStilOffen(true)
                }}
                onSelectionBox={rahmenMelden}
              />
            )}

          {/* Die schwebende Stil-Leiste an der Zeichnung — die häufigen
              Handgriffe dort, wo das Objekt liegt. Alles Seltenere steckt
              hinter dem Zahnrad im Panel darunter. */}
          {ausgewaehlteZeichnung && auswahlRahmen && drawingsVisible && (
            <DrawingStyleBar
              key={`bar-${ausgewaehlteZeichnung.id}`}
              drawing={ausgewaehlteZeichnung}
              rahmen={auswahlRahmen}
              onChange={(style) => handleStyleChange(ausgewaehlteZeichnung.id, style)}
              onOpenSettings={() => setStilOffen(true)}
              onDelete={handleDeleteSelected}
              onClone={() => zeichnungKlonen(ausgewaehlteZeichnung.id)}
              locked={drawingsLocked}
              onLockedChange={setDrawingsLocked}
              onSaveDefault={fluechtig ? undefined : handleSaveStilDefault}
            />
          )}

          {/* Eigenschaften der ausgewählten Zeichnung. Der Anker wird aus dem
              Chart-Rahmen berechnet, weil das Panel per Portal am <body> hängt
              (siehe drawing-style-panel.tsx) und von dort aus nichts über seine
              Lage im Layout weiß. */}
          {ausgewaehlteZeichnung && panelAnker && stilOffen && (
            <DrawingStylePanel
              key={ausgewaehlteZeichnung.id}
              drawing={ausgewaehlteZeichnung}
              top={panelAnker.top}
              left={panelAnker.left}
              onChange={(style) => handleStyleChange(ausgewaehlteZeichnung.id, style)}
              onDelete={handleDeleteSelected}
              onClose={() => setStilOffen(false)}
              onSaveDefault={fluechtig ? undefined : handleSaveDefault}
              times={zeichenZeiten}
              step={zeichenStep}
              onPointsChange={
                drawingsLocked
                  ? undefined
                  : (points) => handleUpdate(ausgewaehlteZeichnung.id, points)
              }
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
      {/* Gezählt wird in Kerzen der BASIS-Ebene, nicht der angesehenen: „eine
          Kerze weiter" muss beim Wechsel auf den Tageschart dasselbe bedeuten
          wie vorher, sonst springt der Durchlauf. */}
      {replayMode && basisKerzen && replayStandJetzt != null && (
        <ChartReplayControls
          total={basisKerzen.length}
          visible={replayStandJetzt}
          onChange={handleReplayChange}
          start={replayStart}
          maxVisible={replayMaxVisible}
          lockedHint={replayLockedHint}
          released={replayReleased}
          onRelease={onReplayRelease}
        />
      )}
    </div>
  )
}
