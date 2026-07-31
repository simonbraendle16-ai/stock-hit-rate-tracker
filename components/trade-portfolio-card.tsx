'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Banknote, FlaskConical, MoveRight } from 'lucide-react'
import { MoveTradeDialog } from '@/components/move-trade-dialog'
import { PaperBadge } from '@/components/paper-badge'
import { normalizePortfolioKind, type PortfolioRow } from '@/lib/portfolio-scope'
import { cn } from '@/lib/utils'

/**
 * Zeigt am Trade, in welchem DEPOT er liegt — und erlaubt das Umbuchen
 * (Etappe 12).
 *
 * Warum das eine eigene Karte ist und keine Zeile irgendwo: Das Depot ist seit
 * dieser Etappe die Quelle der Handelsart. Wer wissen will, warum ein Trade in
 * der Bilanz auftaucht oder nicht, findet die Antwort hier — an genau einer
 * Stelle, statt sie aus einem Abzeichen zu erraten.
 */
export function TradePortfolioCard({
  tradeId,
  ticker,
  portfolioId,
  portfolios,
}: {
  tradeId: number
  ticker: string
  portfolioId: number
  portfolios: PortfolioRow[]
}) {
  const [open, setOpen] = useState(false)
  const depot = portfolios.find((p) => p.id === portfolioId)
  const demo = depot != null && normalizePortfolioKind(depot.kind) === 'demo'
  const andere = portfolios.filter((p) => p.archivedAt == null && p.id !== portfolioId)

  return (
    <div
      className={cn(
        'panel flex flex-wrap items-center justify-between gap-3 p-4',
        demo && 'border-l-2 border-l-[color-mix(in_oklab,var(--warning)_55%,transparent)]',
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="eyebrow">Depot</p>
        <div className="flex flex-wrap items-center gap-2">
          {demo ? (
            <FlaskConical className="size-4 shrink-0 text-[var(--warning)]" aria-hidden />
          ) : (
            <Banknote className="size-4 shrink-0 text-positive" aria-hidden />
          )}
          <span className="truncate font-medium">{depot?.name ?? '—'}</span>
          {demo ? (
            <PaperBadge size="compact" />
          ) : (
            <span className="font-mono text-[11px] text-positive">Echtes Geld</span>
          )}
          {depot?.archivedAt != null && <span className="eyebrow">archiviert</span>}
        </div>
        <p className="note">
          {demo
            ? 'Übungsgeld: Dieser Trade zählt in keine Echtgeld-Kennzahl und wird nie geteilt.'
            : 'Dieser Trade zählt in Bilanz, Rendite und die Kennzahlen, die Freunde sehen.'}
        </p>
      </div>

      {andere.length > 0 && (
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(true)}
          className="h-10 font-mono text-xs"
        >
          <MoveRight className="size-4" /> UMBUCHEN
        </Button>
      )}

      <MoveTradeDialog
        open={open}
        onOpenChange={setOpen}
        tradeId={tradeId}
        ticker={ticker}
        currentPortfolioId={portfolioId}
        portfolios={portfolios}
      />
    </div>
  )
}
