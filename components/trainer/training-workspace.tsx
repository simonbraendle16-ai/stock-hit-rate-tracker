'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PriceChart, type PlanLine } from '@/components/chart/price-chart'
import { PLAN_COLORS } from '@/components/chart/colors'
import { ThesisForm } from './thesis-form'
import { VerdictForm } from './verdict-form'
import { TrainingSummary } from './training-summary'
import { SessionPanel } from './session-panel'
import { listSessionTrades, resolveTrainingTrade } from '@/app/actions/training-trades'
import {
  PICK_LABELS,
  isStopMode,
  measureOutcome,
  nextStopAt,
  type PickField,
  type StopMode,
  type TrainingTradeView,
} from '@/lib/training-trade'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { registerTrainingCandles, abortTrainingSession } from '@/app/actions/training'
import type { Drawing } from '@/app/actions/drawings'
import type { ChartTimeframe } from '@/lib/chart-timeframes'
import {
  defaultStartIndex,
  isBlindMode,
  randomStartIndex,
  startIndexMitVorlauf,
  type TrainingDirection,
  type TrainingMode,
  type TrainingRating,
  type TrainingStatus,
} from '@/lib/training'
import type { Candle } from '@/lib/market-data/types'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'

export interface TrainingSessionView {
  id: number
  mode: TrainingMode
  blind: boolean
  symbol: string | null
  market: string | null
  timeframe: string
  stockId: number | null
  status: TrainingStatus
  candleCount: number
  startIndex: number
  startCandleTime: number | null
  direction: TrainingDirection | null
  elliottCount: string | null
  invalidation: number | null
  entryPrice: number | null
  stopLoss: number | null
  takeProfit: number | null
  thesisNote: string | null
  setupTags: string[]
  committedAt: Date | null
  revealedAt: Date | null
  /** Ausbaustufe 2 (Migration 0029). */
  stopMode: string
  stopEvery: number
  leadIn: number | null
  endedAt: Date | null
}

const SCHRITTE = [
  { id: 'offen', label: '1 · Analysieren' },
  { id: 'festgeschrieben', label: '2 · Aufdecken' },
  { id: 'bewertet', label: '3 · Bewerten' },
] as const

/**
 * Der Arbeitsplatz einer Übung: Chart links, der jeweils fällige Schritt
 * rechts. Er hält die eine Regel durch, auf der der ganze Trainer steht —
 * **vor** dem Festschreiben gibt der Replay keine einzige Kerze frei.
 *
 * Umgesetzt ist das nicht als Hinweis, sondern als Obergrenze am Replay
 * (`replayMaxVisible`): Ein Hinweis, den man wegklicken kann, ist keine
 * Leitplanke.
 */
export function TrainingWorkspace({
  session,
  annotations,
  result,
  initialTrades = [],
}: {
  session: TrainingSessionView
  annotations: Drawing[]
  result: {
    rating: TrainingRating
    errorTags: string[]
    note: string | null
    revealedCandles: number | null
  } | null
  /** Die geübten Trades dieser Sitzung (Ausbaustufe 2). */
  initialTrades?: TrainingTradeView[]
}) {
  const router = useRouter()
  const [status, setStatus] = useState<TrainingStatus>(session.status)
  const [total, setTotal] = useState(session.candleCount)
  const [startIndex, setStartIndex] = useState(session.startIndex || 0)
  const [visible, setVisible] = useState(session.startIndex || 0)
  const registered = useRef(session.startIndex > 0)
  const [trades, setTrades] = useState<TrainingTradeView[]>(initialTrades)
  const [ended, setEnded] = useState(session.endedAt != null)
  const [candles, setCandles] = useState<Candle[]>([])

  /**
   * Kurs-Aufnahme aus dem Chart. Der Zustand liegt hier, weil Chart und
   * Formular ihn beide brauchen: Das eine fordert an, das andere liefert.
   */
  const [pickField, setPickField] = useState<PickField | null>(null)
  const [pickedPrice, setPickedPrice] = useState<{ field: PickField; price: number } | null>(
    null,
  )

  // Esc bricht die Aufnahme ab — ein Modus, aus dem man nur mit einem Klick
  // irgendwohin herauskommt, ist eine Falle.
  useEffect(() => {
    if (!pickField) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPickField(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pickField])

  /**
   * Übungen von VOR Migration 0029 tragen ihre These an der Sitzung selbst.
   * Sie behalten den alten, einstufigen Ablauf — ihre Daten umzudeuten würde
   * rückwirkend etwas anderes behaupten, als damals gemacht wurde.
   */
  const altModell = result != null || session.direction != null

  /**
   * Wie weit der Replay laufen darf.
   *
   * Zwei Sperren, beide keine Warnung, sondern eine echte Obergrenze:
   * 1. Solange nichts festgeschrieben ist, gibt der Replay keine Kerze frei.
   *    Ohne das misst die Übung nichts.
   * 2. Danach der nächste Haltepunkt — im automatischen Modus alle N Kerzen.
   */
  const [freigabe, setFreigabe] = useState<number | null>(null)

  const stopMode: StopMode = isStopMode(session.stopMode) ? session.stopMode : 'auto'

  // Nach jedem Festschreiben und jeder Haltepunkt-Antwort die nächste Marke setzen.
  const naechsteFreigabe = useCallback(
    (ab: number) => {
      if (stopMode !== 'auto') return null
      return nextStopAt(ab, startIndex, total || ab, stopMode, session.stopEvery)
    },
    [stopMode, startIndex, total, session.stopEvery],
  )

  const verdeckt = session.blind && session.revealedAt == null && status !== 'bewertet'

  // Der Startpunkt wird EINMAL gezogen und sofort in der Übung festgehalten.
  // Danach ist er unveränderlich — ein Startpunkt, den man nach dem Aufdecken
  // noch verschieben kann, macht die Übung nachträglich passend.
  const handleCandles = useCallback(
    (candles: Candle[]) => {
      setTotal(candles.length)
      setCandles(candles)

      if (registered.current) {
        // Eine bereits festgelegte Übung wird über die ZEIT ihrer Startkerze
        // wiedergefunden, nicht über ihren Index.
        //
        // Der Index gilt nur innerhalb genau des Kerzensatzes, in dem er
        // gezogen wurde. Sobald der Anbieter oder der Kerzenspeicher mehr
        // Historie liefert als beim Anlegen, zeigt derselbe Index auf eine
        // ganz andere Stelle — die gespeicherte Übung wäre dann stillschweigend
        // eine andere. Der Zeitstempel ist unveränderlich.
        const ziel = session.startCandleTime
        if (ziel != null) {
          let index = candles.findIndex((c) => c.time > ziel)
          if (index === -1) index = candles.length
          if (index > 0 && index !== startIndex) {
            setStartIndex(index)
            setVisible((v) => (v === startIndex ? index : v))
          }
        }
        return
      }
      registered.current = true

      // Der beim Anlegen gewählte Vorlauf gewinnt — auch bei den verdeckten
      // Übungen. Verdeckt ist das INSTRUMENT, nicht die Stelle; wer zu wenig
      // Vergangenheit sieht, rät ohnehin nur. Ohne Angabe (Alt-Übungen) bleibt
      // es beim bisherigen Verhalten, kein Backfill.
      const gezogen =
        session.leadIn != null
          ? startIndexMitVorlauf(candles.length, session.leadIn)
          : isBlindMode(session.mode)
            ? randomStartIndex(candles.length, Math.random())
            : defaultStartIndex(candles.length)

      setStartIndex(gezogen)
      setVisible(gezogen)

      registerTrainingCandles({
        sessionId: session.id,
        candleCount: candles.length,
        startIndex: gezogen,
        firstCandleTime: candles[0]?.time ?? null,
        startCandleTime: candles[Math.max(0, gezogen - 1)]?.time ?? null,
        lastCandleTime: candles[candles.length - 1]?.time ?? null,
      })
        .then((res) => {
          // Der Server gewinnt: Bei einem erneuten Laden gilt der gespeicherte
          // Startpunkt, nicht der frisch gezogene.
          if ('ok' in res && res.startIndex !== gezogen) {
            setStartIndex(res.startIndex)
            setVisible(res.startIndex)
          }
        })
        .catch(() => {
          /* Das Replay läuft trotzdem — beim nächsten Laden wird es erneut versucht. */
        })
    },
    [session.id, session.mode, session.startCandleTime, session.leadIn, startIndex],
  )

  // Beim ersten Rendern ist der Startpunkt noch unbekannt; bis dahin steht
  // keine Obergrenze, weil auch noch keine Kerzen da sind.
  const freigegeben = Math.max(0, visible - startIndex)

  /** Obergrenze im alten, einstufigen Ablauf. */
  const altCap = status === 'offen' ? (startIndex > 0 ? startIndex : undefined) : undefined

  /**
   * Obergrenze im neuen Ablauf: erst nichts, dann bis zum nächsten Haltepunkt.
   * Eine beendete Sitzung ist frei — dann gibt es nichts mehr zu verbergen.
   */
  const neuCap = ended
    ? undefined
    : trades.length === 0
      ? startIndex > 0
        ? startIndex
        : undefined
      : (freigabe ?? undefined)

  const cap = altModell ? altCap : neuCap

  /**
   * Der laufende Plan als Linien im Chart.
   *
   * Der eigentliche Gewinn ist nicht die Anzeige, sondern das Zusehen: Man
   * sieht den Kurs auf den eigenen Stop zulaufen, statt Zahlen zu vergleichen.
   * Genau das ist der Moment, den der Trainer üben soll — und der einzige
   * Grund, warum ein Replay überhaupt etwas anderes ist als eine Tabelle.
   */
  const planLines: PlanLine[] = useMemo(() => {
    const t =
      trades.find((x) => x.direction !== 'keine' && x.outcome == null) ??
      // Nach dem Abschluss bleibt der zuletzt gehandelte Plan stehen — sonst
      // verschwindet genau in dem Moment die Grundlage für die Einordnung.
      [...trades].reverse().find((x) => x.direction !== 'keine')
    if (!t) return []
    const out: PlanLine[] = []
    if (t.entryPrice != null)
      out.push({ price: t.entryPrice, color: PLAN_COLORS.entry, title: 'Einstieg' })
    if (t.stopLoss != null)
      out.push({ price: t.stopLoss, color: PLAN_COLORS.stop, title: 'Stop' })
    if (t.takeProfit != null)
      out.push({ price: t.takeProfit, color: PLAN_COLORS.target, title: 'Ziel' })
    if (t.invalidation != null)
      out.push({
        price: t.invalidation,
        color: PLAN_COLORS.invalidation,
        title: 'Invalidation',
        dashed: true,
      })
    return out
  }, [trades])

  /** Steht der Replay gerade an einem Haltepunkt und wartet auf eine Antwort? */
  const amHaltepunkt =
    !altModell &&
    !ended &&
    trades.length > 0 &&
    freigabe != null &&
    visible >= freigabe &&
    freigabe < total

  /** Die letzte Kerze, die gerade zu sehen ist — Zeit und Schlusskurs. */
  const letzteSichtbare =
    candles.length > 0 ? (candles[Math.min(visible, candles.length) - 1] ?? null) : null
  const sichtbareKerzenzeit = letzteSichtbare?.time ?? null
  const sichtbarerKurs = letzteSichtbare?.close ?? null

  /** Nach jedem Schritt: bis zum nächsten Haltepunkt weiter freigeben. */
  const weiterGeben = useCallback(() => {
    setFreigabe((f) => naechsteFreigabe(Math.max(f ?? 0, visible)))
  }, [naechsteFreigabe, visible])

  /**
   * Berührt der aufgedeckte Kurs Stop oder Ziel, misst die App von selbst.
   *
   * Erkannt wird im Browser (über die SICHTBAREN Kerzen), gemessen wird auf dem
   * Server — ein Ergebnis, das der Client mitschickt, wäre keine Messung,
   * sondern eine Behauptung.
   *
   * Wichtig ist die Begrenzung auf die sichtbaren Kerzen: Würde schon vorher
   * über die volle Historie gemessen, bekäme man das Ergebnis, bevor man es
   * aufgedeckt hat — und damit wäre die Übung wertlos. Erst beim Beenden der
   * Sitzung wird der Rest über alles gemessen; dann ist nichts mehr zu
   * verbergen.
   */
  const messungLaeuft = useRef(false)

  const tradesNeuLaden = useCallback(async () => {
    try {
      const rows = await listSessionTrades(session.id)
      setTrades(rows)
      // Der erste festgeschriebene Trade öffnet den Replay bis zum ersten Halt.
      setFreigabe((f) => (f == null ? naechsteFreigabe(visible) : f))
    } catch {
      /* Beim nächsten Laden erneut. */
    }
  }, [session.id, naechsteFreigabe, visible])

  const [aborting, setAborting] = useState(false)
  async function verwerfen() {
    setAborting(true)
    await abortTrainingSession(session.id)
    router.push('/trainer')
  }

  useEffect(() => {
    setStatus(session.status)
  }, [session.status])

  // Die Freigabe steht nur im Browser — nach dem Neuladen einer Sitzung, die
  // schon Trades trägt, muss sie neu gesetzt werden. Ohne das liefe der Replay
  // unbegrenzt weiter, und die Haltepunkte wären mit einem F5 abgeschaltet.
  useEffect(() => {
    if (altModell || ended || trades.length === 0) return
    if (freigabe != null || startIndex <= 0 || total <= 0) return
    setFreigabe(naechsteFreigabe(Math.max(startIndex, visible)))
  }, [altModell, ended, trades.length, freigabe, startIndex, total, visible, naechsteFreigabe])

  useEffect(() => {
    if (altModell || ended || candles.length === 0 || messungLaeuft.current) return
    const offen = trades.find((t) => t.direction !== 'keine' && t.outcome == null)
    if (
      !offen ||
      offen.entryCandleTime == null ||
      offen.entryPrice == null ||
      offen.stopLoss == null ||
      offen.takeProfit == null
    ) {
      return
    }

    const treffer = measureOutcome(
      {
        direction: offen.direction,
        entryPrice: offen.entryPrice,
        stopLoss: offen.stopLoss,
        takeProfit: offen.takeProfit,
      },
      candles.slice(0, visible),
      offen.entryCandleTime,
    )
    // 'offen' heißt: bis hierher ist nichts passiert — dann bleibt der Trade
    // stehen und läuft weiter.
    if (!treffer || treffer.outcome === 'offen') return

    messungLaeuft.current = true
    resolveTrainingTrade({ sessionId: session.id, tradeId: offen.id })
      .then((res) => {
        // Der Moment, in dem der Plan aufgeht oder scheitert, ist der
        // lehrreichste der ganzen Übung — er darf nicht beiläufig passieren.
        // Der Replay hält an: Weiterlaufen würde über die Stelle hinwegspielen,
        // an der man hinsehen soll.
        if (res.ok && res.trade.outcome && res.trade.outcome !== 'offen') {
          setFreigabe(visible)
          const r = res.trade.rMultiple
          const inR = r != null ? ` · ${r >= 0 ? '+' : ''}${r.toFixed(2)} R` : ''
          if (res.trade.outcome === 'ziel') {
            toast.success(`Ziel erreicht${inR}`, {
              description: 'Der Plan ist aufgegangen. Ordne ihn rechts ein.',
            })
          } else {
            toast.error(`Stop ausgelöst${inR}`, {
              description: 'Vorher festgelegt, jetzt eingetreten. Ordne ihn rechts ein.',
            })
          }
        }
        return tradesNeuLaden()
      })
      .catch(() => {
        /* Beim nächsten Schritt erneut. */
      })
      .finally(() => {
        messungLaeuft.current = false
      })
  }, [visible, trades, candles, ended, altModell, session.id, tradesNeuLaden])

  const schrittIndex = status === 'offen' ? 0 : status === 'festgeschrieben' ? 1 : 2

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {SCHRITTE.map((s, i) => (
          <Badge
            key={s.id}
            variant={i === schrittIndex ? 'default' : 'outline'}
            className="font-mono text-[10px]"
          >
            {s.label}
          </Badge>
        ))}
        <span className="grow" />
        {status !== 'bewertet' && (
          <Button
            size="sm"
            variant="ghost"
            disabled={aborting}
            onClick={verwerfen}
            className="h-7 gap-1.5 px-2 font-mono text-[11px] text-muted-foreground"
          >
            <Trash2 className="size-3.5" />
            Übung verwerfen
          </Button>
        )}
      </div>

      {/* 5 von 7 Spalten für den Chart. Im Trainer wird eine Struktur gelesen —
          dafür braucht es Fläche; das Formular daneben kommt mit weniger aus. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-7">
        <div className="xl:col-span-5">
          <PriceChart
            symbol={session.symbol ?? ''}
            market={session.market ?? 'aktien'}
            stockId={undefined}
            trainingSessionId={session.id}
            planLines={planLines}
            initialDrawings={annotations}
            defaultTimeframe={session.timeframe as ChartTimeframe}
            // Die Zeitebene ist NICHT mehr gesperrt: Aus fünfzig Kerzen einer
            // Ebene lässt sich keine Struktur ableiten. Gehandelt wird von oben
            // nach unten — erst der große Kontext, dann für den Einstieg
            // herunter. Der Durchlauf zählt dabei weiter in der Ebene der
            // Übung; die anderen werden auf denselben Moment zugeschnitten
            // (`lib/replay-timeframes.ts`), damit keine Zukunft durchscheint.
            replayBasisTimeframe={session.timeframe as ChartTimeframe}
            hideIdentity={verdeckt}
            replayMode
            replayStart={startIndex > 0 ? startIndex : undefined}
            replayMaxVisible={cap}
            replayLockedHint={
              // Nur solange wirklich nichts festgeschrieben ist. Danach ist die
              // Grenze ein Haltepunkt, keine Sperre — derselbe Text wäre dort
              // schlicht falsch.
              altModell || trades.length === 0
                ? 'Erst den Plan festschreiben'
                : 'Haltepunkt — rechts beantworten'
            }
            onReplayVisibleChange={setVisible}
            onCandlesLoaded={handleCandles}
            heightClass="h-[440px] sm:h-[560px] xl:h-[min(74vh,820px)]"
            pickPrice={
              pickField
                ? (price) => setPickedPrice({ field: pickField, price })
                : null
            }
            pickLabel={pickField ? PICK_LABELS[pickField] : undefined}
          />
          {cap != null && !amHaltepunkt && (
            <p className="note mt-2">
              {altModell || trades.length === 0
                ? 'Der Replay ist gesperrt, bis dein Plan steht. Zeichnen, messen und Werkzeuge benutzen kannst du jetzt schon — die Zeichnungen gehören zu dieser Übung und landen nicht im Chart des Instruments.'
                : `Der Replay läuft bis zum nächsten Haltepunkt (Kerze ${cap}).`}
            </p>
          )}
          {amHaltepunkt && (
            <p className="note mt-2 text-warning">
              Haltepunkt erreicht — beantworte rechts, wie es weitergeht.
            </p>
          )}
        </div>

        <div className="xl:col-span-2 xl:min-w-0">
          {/* Neuer Ablauf: eine Sitzung, darin mehrere geübte Trades. */}
          {!altModell && status !== 'abgebrochen' && (
            <SessionPanel
              sessionId={session.id}
              mode={session.mode}
              trades={trades}
              visibleCandleTime={sichtbareKerzenzeit}
              currentPrice={sichtbarerKurs}
              pickField={pickField}
              pickedPrice={pickedPrice}
              onPickField={setPickField}
              atCheckpoint={amHaltepunkt}
              ended={ended}
              onTradesChanged={tradesNeuLaden}
              onCheckpointHandled={weiterGeben}
              onEnded={() => {
                setEnded(true)
                tradesNeuLaden()
                router.refresh()
              }}
            />
          )}

          {altModell && status === 'offen' && (
            <ThesisForm
              sessionId={session.id}
              mode={session.mode}
              onCommitted={() => {
                setStatus('festgeschrieben')
                router.refresh()
              }}
            />
          )}

          {altModell && status === 'festgeschrieben' && (
            <VerdictForm
              sessionId={session.id}
              revealedCandles={freigegeben}
              enoughRevealed={freigegeben > 0}
              onSaved={() => {
                setStatus('bewertet')
                router.refresh()
              }}
            />
          )}

          {altModell && status === 'bewertet' && (
            <TrainingSummary
              session={{ ...session, startCandleTime: session.startCandleTime }}
              result={result}
            />
          )}

          {status === 'abgebrochen' && (
            <p className="panel p-4 font-mono text-xs text-muted-foreground">
              Diese Übung wurde verworfen. Sie zählt in keiner Statistik mit.
            </p>
          )}
        </div>
      </div>

      <p className="note">
        {total > 0
          ? `${total} Kerzen geladen · Startpunkt bei Kerze ${startIndex} · ${freigegeben} freigegeben.`
          : 'Kerzen werden geladen ...'}
      </p>
    </div>
  )
}
