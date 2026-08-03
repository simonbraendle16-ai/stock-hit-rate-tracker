'use client'

import Link from 'next/link'
import { FormSection, ResultBlock, ResultRow } from '@/components/form-frame'
import { Badge } from '@/components/ui/badge'
import {
  TRAINING_DIRECTIONS,
  TRAINING_RATINGS,
  trainingErrorLabel,
  type TrainingDirection,
  type TrainingRating,
} from '@/lib/training'
import { BarChart3, Eye, RotateCcw } from 'lucide-react'

const RATING_TONE: Record<TrainingRating, 'positive' | 'warning' | 'destructive'> = {
  korrekt: 'positive',
  teilweise: 'warning',
  falsch: 'destructive',
}

function kurs(v: number | null): string {
  return v == null ? '—' : v.toLocaleString('de-DE', { maximumFractionDigits: 4 })
}

/**
 * Die Auflösung: Erst hier fällt der Vorhang über Symbol und Zeitraum, und
 * daneben steht die These, wie sie VOR dem Aufdecken geschrieben wurde.
 *
 * Die beiden Blöcke stehen bewusst nebeneinander — das Gegenüber von
 * geschriebener These und tatsächlichem Verlauf ist der ganze Lerninhalt.
 */
export function TrainingSummary({
  session,
  result,
}: {
  session: {
    id: number
    symbol: string | null
    market: string | null
    timeframe: string
    stockId: number | null
    direction: TrainingDirection | null
    elliottCount: string | null
    invalidation: number | null
    entryPrice: number | null
    stopLoss: number | null
    takeProfit: number | null
    thesisNote: string | null
    setupTags: string[]
    startCandleTime: number | null
  }
  result: {
    rating: TrainingRating
    errorTags: string[]
    note: string | null
    revealedCandles: number | null
  } | null
}) {
  const richtung =
    TRAINING_DIRECTIONS.find((d) => d.id === session.direction)?.label ?? '—'
  const bewertung = result ? TRAINING_RATINGS.find((r) => r.id === result.rating) : null
  const startDatum =
    session.startCandleTime != null
      ? new Date(session.startCandleTime * 1000).toLocaleDateString('de-DE', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        })
      : null

  return (
    <FormSection
      icon={Eye}
      title="Auflösung"
      hint="Instrument, Zeitraum und die These, wie sie vor dem Aufdecken stand."
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="font-mono text-[11px]">
          {session.symbol ?? 'verdeckt'}
        </Badge>
        <Badge variant="outline" className="font-mono text-[11px]">
          {session.timeframe}
        </Badge>
        {startDatum && (
          <span className="font-mono text-[11px] text-muted-foreground">
            Startpunkt: {startDatum}
          </span>
        )}
        {session.stockId != null && (
          <Link
            href={`/stock/${session.stockId}`}
            className="font-mono text-[11px] text-primary hover:underline"
          >
            Zum Instrument
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ResultBlock title="Deine These (festgeschrieben)" tone="primary">
          {/* Zwei Spalten, nicht drei: Die Karte steht in der schmalen Spalte
              neben dem Chart, und „Invalidation" ist zu lang für ein Drittel
              davon — bei drei Spalten schoben sich die Beschriftungen
              ineinander. */}
          <dl className="grid grid-cols-2 gap-3">
            <ResultRow label="Richtung" value={richtung} strong />
            <ResultRow label="Einstieg" value={kurs(session.entryPrice)} />
            <ResultRow label="Stop" value={kurs(session.stopLoss)} />
            <ResultRow label="Ziel" value={kurs(session.takeProfit)} />
            <ResultRow label="Invalidation" value={kurs(session.invalidation)} />
          </dl>
          {session.elliottCount && (
            <dl className="mt-3">
              <ResultRow label="Wellenzählung" value={session.elliottCount} />
            </dl>
          )}
          {session.setupTags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {session.setupTags.map((t) => (
                <Badge key={t} variant="outline" className="font-mono text-[10px]">
                  {t}
                </Badge>
              ))}
            </div>
          )}
          {session.thesisNote && (
            <p className="note mt-3 whitespace-pre-wrap">{session.thesisNote}</p>
          )}
        </ResultBlock>

        <ResultBlock
          title="Bewertung"
          tone={bewertung ? RATING_TONE[bewertung.id] : 'neutral'}
        >
          {bewertung ? (
            <>
              <p className="metric">{bewertung.label}</p>
              <p className="note mt-1">{bewertung.hint}</p>
              {result!.revealedCandles != null && (
                <p className="note mt-2">
                  Nach {result!.revealedCandles} freigegebenen Kerzen bewertet.
                </p>
              )}
              {result!.errorTags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {result!.errorTags.map((t) => (
                    <Badge key={t} variant="outline" className="font-mono text-[10px]">
                      {trainingErrorLabel(t)}
                    </Badge>
                  ))}
                </div>
              )}
              {result!.note && (
                <p className="note mt-3 whitespace-pre-wrap">{result!.note}</p>
              )}
            </>
          ) : (
            <p className="note">Noch nicht bewertet.</p>
          )}
        </ResultBlock>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/trainer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 font-mono text-xs text-primary-foreground hover:bg-primary/90"
        >
          <RotateCcw className="size-3.5" />
          Nächste Übung
        </Link>
        <Link
          href="/trainer/statistik"
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          <BarChart3 className="size-3.5" />
          Zur Trainingsstatistik
        </Link>
      </div>
    </FormSection>
  )
}
