'use client'

// Teilverkauf / Nachkauf einer offenen Position (Etappe 6). Ein Dialog für beide
// Richtungen. Der Teilverkauf verlangt eine offene Restmenge (der letzte Rest
// läuft über „Abschließen", damit die Douglas-Guards greifen); der Nachkauf
// vergrößert die Position und verschiebt den gewichteten Durchschnittseinstieg.
//
// Die aktuell offene Menge wird beim Öffnen aus dem Event-Log gerechnet
// (`settlePosition`, dieselbe reine Logik wie auf dem Server) — als Orientierung
// und für eine frühe, freundliche Validierung. Der Server prüft nochmals hart.

import { useEffect, useState } from 'react'
import type { TradeRow } from '@/lib/trade-stats'
import { settlePosition } from '@/lib/trade-events'
import { addToPosition, listTradeEvents, partialClose } from '@/app/actions/trades'
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

const num = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 4 })

export type AdjustMode = 'teilverkauf' | 'nachkauf'

export function PositionAdjustDialog({
  trade,
  mode,
  open,
  onOpenChange,
  onDone,
}: {
  trade: TradeRow
  mode: AdjustMode
  open: boolean
  onOpenChange: (v: boolean) => void
  onDone: () => void
}) {
  const isSell = mode === 'teilverkauf'
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState('')
  const [fee, setFee] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [openQty, setOpenQty] = useState<number | null>(null)
  const [avgEntry, setAvgEntry] = useState<number | null>(null)

  // Beim Öffnen Felder zurücksetzen und die aktuelle Restmenge laden.
  useEffect(() => {
    if (!open) return
    setQuantity('')
    setPrice('')
    setFee('')
    setNote('')
    setOpenQty(null)
    setAvgEntry(null)
    listTradeEvents(trade.id)
      .then((events) => {
        const s = settlePosition(trade, events)
        setOpenQty(s.openQty)
        setAvgEntry(s.avgEntry)
      })
      .catch(() => {
        setOpenQty(trade.positionSize ?? null)
        setAvgEntry(trade.entryPrice ?? null)
      })
  }, [open, trade])

  const submit = async () => {
    const q = parseFloat(quantity)
    const p = parseFloat(price)
    if (!(q > 0)) {
      toast.error('Bitte eine Stückzahl größer als 0 eintragen.')
      return
    }
    if (!(p > 0)) {
      toast.error('Bitte den Ausführungskurs eintragen.')
      return
    }
    if (isSell && openQty != null && q >= openQty) {
      toast.error(
        `Beim Teilverkauf muss eine Restmenge offen bleiben (offen: ${num(openQty)}). ` +
          'Den letzten Rest über „Abschließen".',
      )
      return
    }
    setBusy(true)
    try {
      const payload = {
        quantity: q,
        price: p,
        fee: fee.trim() === '' ? null : parseFloat(fee),
        note: note.trim() || null,
      }
      if (isSell) await partialClose(trade.id, payload)
      else await addToPosition(trade.id, payload)
      toast.success(isSell ? 'Teilverkauf gebucht.' : 'Nachkauf gebucht.')
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
            {trade.ticker} · {isSell ? 'Teilverkauf' : 'Nachkauf'}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {isSell
              ? 'Einen Teil der Position schließen — der Rest läuft weiter. Den letzten Rest über „Abschließen" schließen (dort greifen Verlust-Annahme und Check-in).'
              : 'Die Position vergrößern (Pyramidisieren). Der Durchschnittseinstieg wird neu gewichtet; das Risiko steigt über den ursprünglichen Einsatz hinaus.'}
          </DialogDescription>
        </DialogHeader>

        {openQty != null && (
          <p className="font-mono text-[11px] text-muted-foreground">
            Offen: <span className="text-foreground">{num(openQty)}</span> Stück
            {avgEntry != null && (
              <>
                {' '}
                · Ø Einstieg <span className="text-foreground">{num(avgEntry)}</span>
              </>
            )}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Stückzahl
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder={isSell && openQty != null ? `max. < ${num(openQty)}` : '0'}
              className="input-ocean font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Ausführungskurs
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0"
              className="input-ocean font-mono text-sm"
            />
          </div>
        </div>

        {trade.tradedWithMoney && (
          <div className="space-y-1.5">
            <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Gebühr (optional)
            </Label>
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
          <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Notiz (optional)
          </Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={isSell ? 'z. B. erste Hälfte bei 1 R realisiert' : 'z. B. Ausbruch bestätigt, nachgelegt'}
            className="input-ocean min-h-16 font-mono text-sm"
          />
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={busy}
            className="btn-teal-glow w-full font-mono text-sm font-bold tracking-wider sm:w-auto"
          >
            {busy ? 'WIRD GEBUCHT…' : isSell ? 'TEILVERKAUF' : 'NACHKAUF'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
