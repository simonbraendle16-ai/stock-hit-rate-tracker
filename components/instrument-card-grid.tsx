'use client'

// Das Gitter der Instrumentenkarten — der gemeinsame Rahmen für Analyse und
// Auswertung.
//
// Warum ein eigener Rahmen und nicht zweimal `cards.map(...)`: Suche, Reihung
// und die Schwelle „ab wann wird nachgeladen" sind Entscheidungen, die an
// beiden Orten gleich ausfallen müssen. Zwei Kopien wären zwei Gelegenheiten,
// sie auseinanderlaufen zu lassen.
//
// Die Reihung kommt aus `computeInstrumentStats` (Aktivität absteigend, bei
// Gleichstand die höhere Prognosequote) und wird hier NICHT nochmal angefasst.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { BarChart3, Eye, LineChart, Plus, Search, Trash2, X } from 'lucide-react'
import { ChartEmpty } from '@/components/chart-frame'
import { InstrumentCard, type InstrumentQuote } from '@/components/instrument-card'
import { AddAssessmentDialog } from '@/components/add-assessment-dialog'
import { EditChartUrlDialog } from '@/components/edit-chart-url-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { deleteStock } from '@/app/actions/stocks'
import type { StockWithStats } from '@/app/actions/stocks'
import type { InstrumentStats } from '@/lib/instrument-stats'

/** So viele Karten stehen sofort da; der Rest kommt auf Knopfdruck. */
const PAGE_SIZE = 12

export type InstrumentQuoteMap = Record<number, InstrumentQuote>

export function InstrumentCardGrid({
  cards,
  quotes,
  currency = 'EUR',
  stocks,
  emptyTitle = 'Noch keine Instrumente mit Aktivität',
  emptyHint = 'Sobald du eine Prognose stellst oder einen Trade erfasst, erscheint das Instrument hier.',
}: {
  cards: InstrumentStats[]
  quotes: InstrumentQuoteMap
  currency?: string
  /**
   * Nur auf der Analyseseite gesetzt: Dort ersetzt das Gitter die frühere
   * Rangliste und muss deren Bedienelemente mitbringen, damit nichts verloren
   * geht. Auf der Auswertungsseite ist die Karte reine Anzeige.
   */
  stocks?: StockWithStats[]
  emptyTitle?: string
  emptyHint?: string
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [assessStock, setAssessStock] = useState<StockWithStats | null>(null)
  const [assessOpen, setAssessOpen] = useState(false)
  const [chartStock, setChartStock] = useState<StockWithStats | null>(null)
  const [chartOpen, setChartOpen] = useState(false)

  const stockById = useMemo(() => {
    const m = new Map<number, StockWithStats>()
    for (const s of stocks ?? []) m.set(s.id, s)
    return m
  }, [stocks])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      q
        ? cards.filter(
            (c) => c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q),
          )
        : cards,
    [cards, q],
  )

  const visible = filtered.slice(0, limit)
  const rest = filtered.length - visible.length

  const handleDelete = async (s: StockWithStats) => {
    if (!confirm(`„${s.name}“ und alle zugehörigen Einschätzungen löschen?`)) return
    try {
      await deleteStock(s.id)
      toast.success(`${s.name} gelöscht`)
      router.refresh()
    } catch {
      toast.error('Löschen fehlgeschlagen.')
    }
  }

  function actionsFor(stockId: number) {
    const s = stockById.get(stockId)
    if (!s) return undefined
    return (
      <>
        {s.chartUrl ? (
          <a
            href={s.chartUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ size: 'sm', variant: 'ghost' })}
            title="Chart öffnen"
          >
            <LineChart className="size-3.5" />
            <span className="font-mono text-[10px]">Chart</span>
          </a>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => {
              setChartStock(s)
              setChartOpen(true)
            }}
            title="Chart-Link hinzufügen"
          >
            <LineChart className="size-3.5" />
            <span className="font-mono text-[10px]">Chart-Link</span>
          </Button>
        )}
        <Link
          href={`/stock/${s.id}`}
          className={buttonVariants({ size: 'sm', variant: 'ghost' })}
        >
          <Eye className="size-3.5" />
          <span className="font-mono text-[10px]">Details</span>
        </Link>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setAssessStock(s)
            setAssessOpen(true)
          }}
        >
          <Plus className="size-3.5" />
          <span className="font-mono text-[10px]">Einschätzung</span>
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="ml-auto size-7 text-muted-foreground hover:text-destructive"
          onClick={() => handleDelete(s)}
          aria-label={`${s.name} löschen`}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </>
    )
  }

  if (cards.length === 0) {
    return <ChartEmpty icon={BarChart3} title={emptyTitle} hint={emptyHint} className="py-10" />
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setLimit(PAGE_SIZE)
          }}
          placeholder="Instrument suchen (Name oder Ticker)…"
          aria-label="Instrumente durchsuchen"
          className="pl-9 pr-9"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Suche zurücksetzen"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-10 text-center">
          <Search className="size-7 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-foreground">Keine Treffer für „{query}“</p>
          <p className="note mt-1.5 max-w-xs">
            Prüfe die Schreibweise oder setze die Suche zurück.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {visible.map((c) => (
              <InstrumentCard
                key={c.stockId}
                stats={c}
                quote={quotes[c.stockId]}
                currency={currency}
                href={`/stock/${c.stockId}`}
                footer={actionsFor(c.stockId)}
              />
            ))}
          </div>

          {rest > 0 && (
            <Button
              variant="outline"
              className="self-center font-mono text-xs"
              onClick={() => setLimit((l) => l + PAGE_SIZE)}
            >
              {rest} weitere {rest === 1 ? 'Instrument' : 'Instrumente'} zeigen
            </Button>
          )}
        </>
      )}

      {assessStock && (
        <AddAssessmentDialog
          stockId={assessStock.id}
          stockName={assessStock.name}
          open={assessOpen}
          onOpenChange={setAssessOpen}
        />
      )}

      {chartStock && (
        <EditChartUrlDialog
          stockId={chartStock.id}
          stockName={chartStock.name}
          chartUrl={chartStock.chartUrl}
          open={chartOpen}
          onOpenChange={setChartOpen}
        />
      )}
    </div>
  )
}
