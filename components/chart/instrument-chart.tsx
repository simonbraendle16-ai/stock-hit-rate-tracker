'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Clapperboard, GraduationCap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  PriceChart,
  type ChartMarker,
  type ChartTimeframe,
  type PlanLine,
} from '@/components/chart/price-chart'
import type { Drawing } from '@/app/actions/drawings'

/**
 * Phase 2 des Trainer-Plans: Der Replay-Modus soll nicht nur auf der
 * Trainer-Seite laufen, sondern in JEDEM Watchlist-Chart.
 *
 * Bewusst ohne Speicherung: Hier wird nur zurückgespult, um eine Bewegung
 * nachzuvollziehen — die gemessene Übung mit festgeschriebener These läuft
 * unter `/trainer`. Deshalb steht daneben der Weg dorthin.
 *
 * Die Plan-Linien bleiben auch im Replay stehen. Sie sind kein Blick in die
 * Zukunft, sondern der eigene Plan — genau das, was man beim Zurückspulen
 * gegen den Verlauf halten will.
 */
export function InstrumentChart({
  symbol,
  market,
  planLines,
  markers,
  stockId,
  initialDrawings,
  defaultTimeframe,
}: {
  symbol: string
  market: string
  planLines: PlanLine[]
  markers: ChartMarker[]
  stockId: number
  initialDrawings: Drawing[]
  defaultTimeframe?: ChartTimeframe
}) {
  const [replay, setReplay] = useState(false)

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={replay ? 'secondary' : 'ghost'}
          className="h-7 gap-1.5 px-2.5 font-mono text-[11px]"
          onClick={() => setReplay((v) => !v)}
        >
          <Clapperboard className="size-3.5" />
          {replay ? 'Replay beenden' : 'Replay'}
        </Button>
        {replay && (
          <Link
            href={`/trainer?symbol=${encodeURIComponent(symbol)}&market=${encodeURIComponent(
              market,
            )}`}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground hover:text-primary"
          >
            <GraduationCap className="size-3.5" />
            Als bewertete Übung starten
          </Link>
        )}
      </div>

      <PriceChart
        symbol={symbol}
        market={market}
        planLines={planLines}
        markers={markers}
        stockId={stockId}
        initialDrawings={initialDrawings}
        defaultTimeframe={defaultTimeframe}
        replayMode={replay}
      />
    </div>
  )
}
