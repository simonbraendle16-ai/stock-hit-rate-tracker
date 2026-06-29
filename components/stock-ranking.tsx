'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import type { StockWithStats } from '@/app/actions/stocks'
import { AddAssessmentDialog } from '@/components/add-assessment-dialog'
import { deleteStock } from '@/app/actions/stocks'
import { BarChart3, Eye, Plus, Search, Trash2, Trophy, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

function hitRateColor(rate: number, hasData: boolean) {
  if (!hasData) return 'text-muted-foreground'
  if (rate >= 60) return 'text-positive'
  if (rate >= 40) return 'text-foreground'
  return 'text-negative'
}

function barColor(rate: number) {
  if (rate >= 60) return 'bg-positive'
  if (rate >= 40) return 'bg-primary'
  return 'bg-negative'
}

export function StockRanking({ stocks }: { stocks: StockWithStats[] }) {
  const router = useRouter()
  const [activeStock, setActiveStock] = useState<StockWithStats | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [query, setQuery] = useState('')

  // Rang aus der ungefilterten (nach Trefferquote sortierten) Liste festhalten,
  // damit die Platzierung beim Filtern stabil bleibt.
  const q = query.trim().toLowerCase()
  const ranked = stocks.map((stock, index) => ({ stock, rank: index + 1 }))
  const filtered = q
    ? ranked.filter(
        ({ stock }) =>
          stock.name.toLowerCase().includes(q) ||
          stock.ticker.toLowerCase().includes(q),
      )
    : ranked

  const openAssessment = (stock: StockWithStats) => {
    setActiveStock(stock)
    setDialogOpen(true)
  }

  const handleDelete = async (stock: StockWithStats) => {
    if (
      !confirm(
        `„${stock.name}“ und alle zugehörigen Einschätzungen löschen?`,
      )
    )
      return
    try {
      await deleteStock(stock.id)
      toast.success(`${stock.name} gelöscht`)
      router.refresh()
    } catch {
      toast.error('Löschen fehlgeschlagen.')
    }
  }

  return (
    <Card className="p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <Trophy className="size-4 text-primary" />
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Ranking nach Trefferquote
          </h3>
          <p className="text-xs text-muted-foreground">
            Aktien sortiert von bester zu schwächster Quote
          </p>
        </div>
      </div>

      {stocks.length > 0 && (
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Aktie suchen (Name oder Ticker)…"
            aria-label="Aktien durchsuchen"
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
      )}

      {stocks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
          <BarChart3 className="size-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-foreground">
            Noch keine Aktien
          </p>
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
            Füge oben deine erste Aktie hinzu und beginne, deine Trefferquote zu
            tracken.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
          <Search className="size-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-foreground">
            Keine Treffer für „{query}“
          </p>
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
            Prüfe die Schreibweise oder setze die Suche zurück.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map(({ stock, rank }) => {
            const hasData = stock.total > 0
            return (
              <li
                key={stock.id}
                className="group flex flex-col gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-accent/40 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="flex items-center gap-3 sm:w-56 sm:shrink-0">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                    {rank}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {stock.name}
                    </p>
                    <Badge
                      variant="secondary"
                      className="mt-0.5 font-mono text-[10px]"
                    >
                      {stock.ticker}
                    </Badge>
                  </div>
                </div>

                <div className="flex flex-1 items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn('h-full rounded-full', barColor(stock.hitRate))}
                      style={{ width: `${hasData ? stock.hitRate : 0}%` }}
                    />
                  </div>
                  <span
                    className={cn(
                      'w-14 text-right text-sm font-semibold tabular-nums',
                      hitRateColor(stock.hitRate, hasData),
                    )}
                  >
                    {hasData ? `${stock.hitRate.toFixed(0)}%` : '–'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    <span className="text-positive">{stock.correct}</span>
                    {' / '}
                    <span className="text-negative">{stock.wrong}</span>
                    {stock.notReached > 0 && (
                      <span className="text-warning"> · {stock.notReached} n.a.</span>
                    )}
                    <span className="ml-1 hidden sm:inline">
                      ({stock.total} ges.)
                    </span>
                  </span>
                  <div className="flex items-center gap-1">
                    <Link
                      href={`/stock/${stock.id}`}
                      className={buttonVariants({ size: 'sm', variant: 'outline' })}
                    >
                      <Eye className="size-3.5" />
                      <span className="hidden sm:inline">Details</span>
                    </Link>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openAssessment(stock)}
                    >
                      <Plus className="size-3.5" />
                      <span className="hidden sm:inline">Einschätzung</span>
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 text-muted-foreground hover:text-negative"
                      onClick={() => handleDelete(stock)}
                      aria-label={`${stock.name} löschen`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {activeStock && (
        <AddAssessmentDialog
          stockId={activeStock.id}
          stockName={activeStock.name}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      )}
    </Card>
  )
}
