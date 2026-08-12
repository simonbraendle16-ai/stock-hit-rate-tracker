'use client'

// Der Ausführen-Dialog einer Zielstufe — eigene Datei seit der Live-Leiste.
//
// Er stand vorher privat in `trade-targets-card.tsx`. Seit die Leiste dieselbe
// Handlung anbietet, muss es genau EINEN Dialog geben: zwei Ausführungswege
// wären zwei Gelegenheiten, verschieden zu buchen — dieselbe Begründung, aus
// der schon `target-stages.tsx` für beide Erfassungswege existiert.
// Verschoben, nicht verändert.

import { useEffect, useState } from 'react'
import { executeTarget } from '@/app/actions/trades'
import { plannedQty } from '@/lib/trade-targets'
import type { TradeRow } from '@/lib/trade-stats'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'

const num = (n: number, d = 4) => n.toLocaleString('de-DE', { maximumFractionDigits: d })
const pct = (n: number) => `${n.toLocaleString('de-DE', { maximumFractionDigits: 2 })} %`

/** Ausführen einer Stufe: der geplante Kurs steht drin, der echte Fill zählt. */
export function ExecuteTargetDialog({
  trade,
  target,
  basis,
  openQty,
  open,
  onOpenChange,
  onDone,
}: {
  trade: TradeRow
  target: { id: number | null; sortOrder: number; price: number; sharePct: number } | null
  basis: number
  openQty: number
  open: boolean
  onOpenChange: (v: boolean) => void
  onDone: () => void
}) {
  const [price, setPrice] = useState('')
  const [fee, setFee] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open && target) {
      setPrice(String(target.price))
      setFee('')
      setNote('')
    }
  }, [open, target])

  if (!target || target.id == null) return null

  const menge = Math.min(plannedQty(basis, target.sharePct), openQty)

  const submit = async () => {
    const p = parseFloat(price)
    if (!(p > 0)) {
      toast.error('Bitte den Ausführungskurs eintragen.')
      return
    }
    setBusy(true)
    try {
      const { quantity } = await executeTarget(trade.id, target.id!, {
        price: p,
        fee: fee.trim() === '' ? null : parseFloat(fee),
        note: note.trim() || null,
      })
      toast.success(`Stufe ${target.sortOrder + 1} ausgeführt — ${num(quantity)} Stück verkauft.`)
      onOpenChange(false)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fehler')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-heading tracking-wide">
            {trade.ticker} · Stufe {target.sortOrder + 1} ausführen
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            Geplant: {pct(target.sharePct)} der Anfangsposition bei {num(target.price)} — das
            sind {num(menge)} Stück. Der Rest der Position läuft weiter.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label className="eyebrow">Ausführungskurs</Label>
          <Input
            type="number"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="input-ocean font-mono text-sm"
          />
          <p className="note">
            Vorbelegt mit dem geplanten Kurs. Weicht der tatsächliche Fill ab, zählt der
            tatsächliche — die Bilanz soll stimmen, nicht der Plan.
          </p>
        </div>

        {trade.tradedWithMoney && (
          <div className="space-y-1.5">
            <Label className="eyebrow">Gebühr (optional)</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              placeholder="0"
              className="input-ocean font-mono text-sm"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="eyebrow">Notiz (optional)</Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="z. B. Fill leicht unter dem Ziel"
            className="input-ocean min-h-16 font-mono text-sm"
          />
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={busy}
            className="btn-teal-glow w-full font-mono text-sm font-bold tracking-wider sm:w-auto"
          >
            {busy ? 'WIRD GEBUCHT…' : 'STUFE AUSFÜHREN'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
