'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle, ArrowRight, Banknote, FlaskConical } from 'lucide-react'
import { toast } from 'sonner'
import { moveTrade } from '@/app/actions/portfolios'
import {
  moveEffect,
  normalizePortfolioKind,
  type PortfolioRow,
} from '@/lib/portfolio-scope'
import { cn } from '@/lib/utils'

/**
 * Einen Trade in ein anderes Depot buchen (Etappe 12).
 *
 * Der Grund, warum es diesen Weg überhaupt gibt: Die Handelsart ist nicht mehr
 * frei einstellbar — sie kommt aus dem Depot. Wenn ein Trade doch im falschen
 * Depot liegt (etwa ein Übungstrade, der vor dieser Etappe als Echtgeld erfasst
 * wurde), muss er sich verschieben lassen.
 *
 * Der Dialog zeigt die FOLGEN vorher an, statt sie stillschweigend auszuführen:
 * Kreuzt der Wechsel die Grenze Echtgeld ↔ Demo, ändern sich zwei Bilanzen. Das
 * ist die eigentliche Auskunft, die man vor dem Klick braucht.
 */
export function MoveTradeDialog({
  open,
  onOpenChange,
  tradeId,
  ticker,
  currentPortfolioId,
  portfolios,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  tradeId: number
  ticker: string
  currentPortfolioId: number
  portfolios: PortfolioRow[]
}) {
  const router = useRouter()
  const [zielId, setZielId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const quelle = portfolios.find((p) => p.id === currentPortfolioId)
  const ziel = portfolios.find((p) => p.id === zielId)
  // In ein archiviertes Depot wird nicht gebucht (dieselbe Regel wie `checkMove`).
  const waehlbar = portfolios.filter((p) => p.archivedAt == null && p.id !== currentPortfolioId)

  const effekt =
    quelle && ziel
      ? moveEffect(normalizePortfolioKind(quelle.kind), normalizePortfolioKind(ziel.kind))
      : null

  const submit = async () => {
    if (zielId == null) return
    setBusy(true)
    try {
      const r = await moveTrade(tradeId, zielId)
      toast.success(
        r.crossesKind
          ? `Umgebucht — der Trade zählt jetzt als ${r.tradedWithMoney ? 'Echtgeld' : 'Papiergeld'}.`
          : 'Umgebucht.',
      )
      onOpenChange(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Umbuchen fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-heading tracking-wide">
            {ticker} umbuchen
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            Das Depot bestimmt, ob dieser Trade mit echtem Geld zählt. Umbuchen ändert also
            womöglich zwei Bilanzen — deshalb steht unten, was passiert.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 font-mono text-xs">
            <DepotChip p={quelle} />
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {ziel ? (
              <DepotChip p={ziel} />
            ) : (
              <span className="rounded-lg border border-dashed border-border px-2.5 py-1.5 text-muted-foreground">
                Ziel wählen
              </span>
            )}
          </div>

          {waehlbar.length === 0 ? (
            <p className="note">
              Es gibt kein weiteres aktives Depot. Lege in den Einstellungen eines an.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {waehlbar.map((p) => {
                const demo = normalizePortfolioKind(p.kind) === 'demo'
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setZielId(p.id)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left font-mono text-xs transition-colors',
                      zielId === p.id
                        ? demo
                          ? 'border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] text-[var(--warning)]'
                          : 'border-positive/40 bg-positive/12 text-positive'
                        : 'border-border text-muted-foreground hover:bg-accent',
                    )}
                  >
                    {demo ? (
                      <FlaskConical className="size-3.5 shrink-0" />
                    ) : (
                      <Banknote className="size-3.5 shrink-0" />
                    )}
                    <span className="font-bold">{p.name}</span>
                    <span className="opacity-70">{demo ? 'Papiergeld' : 'Echtes Geld'}</span>
                  </button>
                )
              })}
            </div>
          )}

          {effekt?.crossesKind && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              <div className="font-mono text-[11px] leading-relaxed text-warning">
                <p className="font-bold">
                  Dieser Wechsel ändert die Handelsart auf{' '}
                  {effekt.tradedWithMoney ? 'ECHTGELD' : 'PAPIERGELD'}.
                </p>
                <ul className="mt-1.5 list-disc space-y-1 pl-4">
                  <li>
                    Bilanz, Rendite und Equity von „{quelle?.name}" und „{ziel?.name}" ändern
                    sich beide.
                  </li>
                  <li>
                    {effekt.tradedWithMoney
                      ? 'Der Trade zählt ab jetzt in die Kennzahlen, die Freunde sehen.'
                      : 'Der Trade verschwindet aus den Kennzahlen, die Freunde sehen.'}
                  </li>
                  <li>
                    {effekt.tradedWithMoney
                      ? 'Die gespeicherten Gebühren zählen wieder mit.'
                      : 'Die gespeicherten Gebühren zählen nicht mehr mit — gelöscht werden sie nicht, das Umbuchen bleibt umkehrbar.'}
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={busy || zielId == null}
            className="w-full font-mono text-sm font-bold tracking-wider sm:w-auto"
          >
            {busy ? 'WIRD UMGEBUCHT…' : 'UMBUCHEN'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DepotChip({ p }: { p: PortfolioRow | undefined }) {
  if (!p) return <span className="text-muted-foreground">—</span>
  const demo = normalizePortfolioKind(p.kind) === 'demo'
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5',
        demo
          ? 'border-[color-mix(in_oklab,var(--warning)_40%,transparent)] text-[var(--warning)]'
          : 'border-positive/40 text-positive',
      )}
    >
      {demo ? <FlaskConical className="size-3.5" /> : <Banknote className="size-3.5" />}
      {p.name}
    </span>
  )
}
