'use client'

// Der Reparaturweg für ein Instrument, dessen Symbol die Automatik nicht
// zweifelsfrei bestimmen konnte.
//
// Leitgedanke: Der Nutzer soll nicht raten müssen, wie der Anbieter ein Papier
// schreibt. Deshalb stehen hier ausschließlich Symbole, für die soeben ein
// echter Kurs abgerufen wurde — jede Zeile zeigt Kurs, Währung und Börse. Wer
// wählt, sieht sofort, ob das der Wert ist, den er meint.

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { pinStockSymbol, reresolveStock, searchSymbols } from '@/app/actions/symbols'
import { Loader2, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'

export interface RepairTarget {
  id: number
  ticker: string
  name: string
  providerSymbol: string | null
  note: string | null
  /** Bereits geprüfte Kandidaten aus der letzten Auflösung. */
  candidates: Array<{
    symbol: string
    name: string
    exchange: string
    currency: string
    price: number
  }>
}

const TYPE_LABELS: Record<string, string> = {
  EQUITY: 'Aktie',
  ETF: 'Fonds',
  MUTUALFUND: 'Fonds',
  INDEX: 'Index',
  FUTURE: 'Termin',
  CRYPTOCURRENCY: 'Krypto',
  CURRENCY: 'Devisen',
}

function formatPrice(v: number): string {
  return v.toLocaleString('de-DE', {
    maximumFractionDigits: v >= 100 ? 2 : 4,
    minimumFractionDigits: 2,
  })
}

export function SymbolRepairDialog({
  target,
  onClose,
  onChanged,
}: {
  target: RepairTarget | null
  onClose: () => void
  /** Nach jeder Änderung an der Zuordnung — die Kursliste muss neu geladen werden. */
  onChanged: () => void
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<
    Array<{ symbol: string; name: string; exchange: string; quoteType: string }>
  >([])
  const [searching, setSearching] = useState(false)
  const [isPending, startTransition] = useTransition()
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Suche entprellen — sonst löst jeder Tastendruck eine Anfrage aus.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    const q = query.trim()
    if (q.length < 2) {
      setHits([])
      return
    }
    setSearching(true)
    debounce.current = setTimeout(async () => {
      try {
        setHits(await searchSymbols(q))
      } catch {
        setHits([])
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [query])

  // Beim Wechsel des Instruments den alten Suchtext nicht stehen lassen.
  useEffect(() => {
    setQuery('')
    setHits([])
  }, [target?.id])

  if (!target) return null

  const choose = (symbol: string) => {
    startTransition(async () => {
      try {
        const res = await pinStockSymbol(target.id, symbol)
        toast.success(
          `${target.ticker} → ${symbol}${res.price ? ` · ${formatPrice(res.price)}` : ''}`,
        )
        onChanged()
        onClose()
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Symbol konnte nicht gesetzt werden.')
      }
    })
  }

  const retry = () => {
    startTransition(async () => {
      try {
        const res = await reresolveStock(target.id)
        if (res.status === 'ok' && res.symbol) {
          toast.success(`${target.ticker} → ${res.symbol}`)
          onClose()
        } else {
          toast.message(res.note)
        }
        onChanged()
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Neuversuch fehlgeschlagen.')
      }
    })
  }

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading text-base">
            Symbol für {target.ticker} zuordnen
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {target.note ??
              `Wähle das Papier, das „${target.name}“ entspricht. Angezeigt wird nur, wofür es tatsächlich einen Kurs gibt.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {target.candidates.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Geprüfte Vorschläge
              </p>
              {target.candidates.map((c) => (
                <button
                  key={c.symbol}
                  type="button"
                  disabled={isPending}
                  onClick={() => choose(c.symbol)}
                  className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2 text-left transition-colors hover:bg-primary/5 disabled:opacity-50"
                >
                  <span className="w-24 shrink-0 font-mono text-xs font-bold">{c.symbol}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                    {c.name}
                    {c.exchange ? ` · ${c.exchange}` : ''}
                  </span>
                  <span className="shrink-0 font-mono text-xs">
                    {formatPrice(c.price)} {c.currency}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Selbst suchen
            </p>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                placeholder="Name oder Kürzel …"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-9 pl-8 font-mono text-xs"
              />
              {searching && (
                <Loader2 className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
            </div>
            {hits.map((h) => (
              <button
                key={h.symbol}
                type="button"
                disabled={isPending}
                onClick={() => choose(h.symbol)}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-primary/5 disabled:opacity-50"
              >
                <span className="w-24 shrink-0 font-mono text-xs font-bold">{h.symbol}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                  {h.name}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {TYPE_LABELS[h.quoteType] ?? h.quoteType} · {h.exchange}
                </span>
              </button>
            ))}
            {query.trim().length >= 2 && !searching && hits.length === 0 && (
              <p className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                Keine Treffer. Andere Schreibweise versuchen — der volle Firmenname
                funktioniert meist besser als das Kürzel.
              </p>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={retry}
            className="justify-start font-mono text-xs"
          >
            <RefreshCw className={`size-3.5 ${isPending ? 'animate-spin' : ''}`} />
            Automatik erneut versuchen
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
