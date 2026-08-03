'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PriceChart } from '@/components/chart/price-chart'
import { ThesisForm } from './thesis-form'
import { VerdictForm } from './verdict-form'
import { TrainingSummary } from './training-summary'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { registerTrainingCandles, abortTrainingSession } from '@/app/actions/training'
import type { Drawing } from '@/app/actions/drawings'
import type { ChartTimeframe } from '@/lib/chart-timeframes'
import {
  defaultStartIndex,
  isBlindMode,
  randomStartIndex,
  type TrainingDirection,
  type TrainingMode,
  type TrainingRating,
  type TrainingStatus,
} from '@/lib/training'
import type { Candle } from '@/lib/market-data/types'
import { Trash2 } from 'lucide-react'

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
}: {
  session: TrainingSessionView
  annotations: Drawing[]
  result: {
    rating: TrainingRating
    errorTags: string[]
    note: string | null
    revealedCandles: number | null
  } | null
}) {
  const router = useRouter()
  const [status, setStatus] = useState<TrainingStatus>(session.status)
  const [total, setTotal] = useState(session.candleCount)
  const [startIndex, setStartIndex] = useState(session.startIndex || 0)
  const [visible, setVisible] = useState(session.startIndex || 0)
  const registered = useRef(session.startIndex > 0)

  const verdeckt = session.blind && session.revealedAt == null && status !== 'bewertet'

  // Der Startpunkt wird EINMAL gezogen und sofort in der Übung festgehalten.
  // Danach ist er unveränderlich — ein Startpunkt, den man nach dem Aufdecken
  // noch verschieben kann, macht die Übung nachträglich passend.
  const handleCandles = useCallback(
    (candles: Candle[]) => {
      setTotal(candles.length)

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

      const gezogen = isBlindMode(session.mode)
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
    [session.id, session.mode, session.startCandleTime, startIndex],
  )

  // Beim ersten Rendern ist der Startpunkt noch unbekannt; bis dahin steht
  // keine Obergrenze, weil auch noch keine Kerzen da sind.
  const cap = status === 'offen' ? (startIndex > 0 ? startIndex : undefined) : undefined
  const freigegeben = Math.max(0, visible - startIndex)

  const [aborting, setAborting] = useState(false)
  async function verwerfen() {
    setAborting(true)
    await abortTrainingSession(session.id)
    router.push('/trainer')
  }

  useEffect(() => {
    setStatus(session.status)
  }, [session.status])

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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <PriceChart
            symbol={session.symbol ?? ''}
            market={session.market ?? 'aktien'}
            stockId={undefined}
            trainingSessionId={session.id}
            initialDrawings={annotations}
            defaultTimeframe={session.timeframe as ChartTimeframe}
            lockTimeframe
            hideIdentity={verdeckt}
            replayMode
            replayStart={startIndex > 0 ? startIndex : undefined}
            replayMaxVisible={cap}
            replayLockedHint="Erst die These festschreiben"
            onReplayVisibleChange={setVisible}
            onCandlesLoaded={handleCandles}
          />
          {status === 'offen' && (
            <p className="note mt-2">
              Der Replay ist gesperrt, bis die These steht. Zeichnen, messen und Werkzeuge
              benutzen kannst du jetzt schon — die Zeichnungen gehören zu dieser Übung und
              landen nicht im Chart des Instruments.
            </p>
          )}
        </div>

        <div className="xl:col-span-2">
          {status === 'offen' && (
            <ThesisForm
              sessionId={session.id}
              mode={session.mode}
              onCommitted={() => {
                setStatus('festgeschrieben')
                router.refresh()
              }}
            />
          )}

          {status === 'festgeschrieben' && (
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

          {status === 'bewertet' && (
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
