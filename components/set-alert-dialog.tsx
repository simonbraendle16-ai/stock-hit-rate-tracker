'use client'

// Einen Kurs-Alert setzen (Etappe 3). Wird von der Live-Position und der
// Watchlist aus geöffnet. Die Richtung wählt der Nutzer entweder selbst oder
// überlässt sie dem Kurs: Ein Level über dem aktuellen Kurs ist ein
// „steigt-auf"-Alert, eines darunter ein „fällt-auf".

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createAlert } from '@/app/actions/alerts'
import { directionForLevel, type AlertDirection } from '@/lib/alerts'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

type DirChoice = 'auto' | AlertDirection

export function SetAlertDialog({
  open,
  onOpenChange,
  ticker,
  market,
  stockId = null,
  tradeId = null,
  currentPrice = null,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  ticker: string
  market: string
  stockId?: number | null
  tradeId?: number | null
  currentPrice?: number | null
  onCreated?: () => void
}) {
  const router = useRouter()
  const [price, setPrice] = useState('')
  const [dir, setDir] = useState<DirChoice>('auto')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setPrice('')
      setDir('auto')
      setNote('')
    }
  }, [open])

  // Vorschau der automatisch bestimmten Richtung, sobald ein Level dasteht.
  const parsed = parseFloat(price.replace(',', '.'))
  const autoDir =
    dir === 'auto' && Number.isFinite(parsed) && currentPrice != null
      ? directionForLevel(parsed, currentPrice)
      : null

  const submit = async () => {
    const value = parseFloat(price.replace(',', '.'))
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('Bitte ein gültiges Kurslevel größer als 0 angeben.')
      return
    }
    setBusy(true)
    try {
      await createAlert({
        ticker,
        market,
        price: value,
        direction: dir === 'auto' ? undefined : dir,
        note: note.trim() || null,
        stockId,
        tradeId,
        kind: 'manuell',
      })
      toast.success('Alert gesetzt.')
      onOpenChange(false)
      onCreated?.()
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fehler')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading tracking-wide">Alert für {ticker}</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            Sag Bescheid, wenn der Kurs ein Level erreicht — setzen und weggehen, statt am Chart
            zu kleben.
            {currentPrice != null && (
              <>
                {' '}
                Aktueller Kurs:{' '}
                <span className="text-foreground">
                  {currentPrice.toLocaleString('de-DE', { maximumFractionDigits: 4 })}
                </span>
                .
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Kurslevel <span className="text-destructive">*</span>
            </Label>
            <Input
              type="number"
              step="any"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              className="input-ocean font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Richtung
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ['auto', 'Automatisch'],
                  ['above', 'Steigt auf/über'],
                  ['below', 'Fällt auf/unter'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setDir(key)}
                  className={cn(
                    'rounded-lg border py-2 font-mono text-[11px] uppercase transition-all',
                    dir === key
                      ? 'border-primary/40 bg-primary/15 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/40',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="min-h-4 font-mono text-[10px] text-muted-foreground">
              {dir === 'auto'
                ? autoDir === 'above'
                  ? 'Level liegt über dem Kurs → löst beim Steigen aus.'
                  : autoDir === 'below'
                    ? 'Level liegt unter dem Kurs → löst beim Fallen aus.'
                    : 'Richtung wird aus dem aktuellen Kurs bestimmt.'
                : 'Richtung fest vorgegeben.'}
            </p>
          </div>

          <div className="space-y-2">
            <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Notiz (optional)
            </Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="z. B. Einstiegszone, Ausbruch abwarten …"
              className="input-ocean font-mono text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={busy}
            className="btn-teal-glow w-full font-mono text-sm font-bold tracking-wider sm:w-auto"
          >
            {busy ? 'WIRD GESETZT…' : 'ALERT SETZEN'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
