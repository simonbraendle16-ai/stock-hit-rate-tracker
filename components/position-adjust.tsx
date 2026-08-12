'use client'

// Teilverkauf / Nachkauf einer offenen Position (Etappe 6). Ein Dialog für beide
// Richtungen. Der Teilverkauf verlangt eine offene Restmenge (der letzte Rest
// läuft über „Abschließen", damit die Douglas-Guards greifen); der Nachkauf
// vergrößert die Position und verschiebt den gewichteten Durchschnittseinstieg.
//
// Die aktuell offene Menge wird beim Öffnen aus dem Event-Log gerechnet
// (`settlePosition`, dieselbe reine Logik wie auf dem Server) — als Orientierung
// und für eine frühe, freundliche Validierung. Der Server prüft nochmals hart.
//
// Beim Teilverkauf steht die Menge außerdem schon im Staffelplan: Vorbelegt wird
// die nächste noch offene Stufe. Bleibt sie unverändert, wird über `executeTarget`
// gebucht und die Stufe gilt als abgetragen; wird sie geändert, läuft es als
// freier Teilverkauf über `partialClose` und die Stufe bleibt offen. Ein
// abweichender Fill, der trotzdem als „Plan erfüllt" gebucht wird, wäre genau der
// stille Falschwert, den der Soll/Ist-Vergleich später nicht mehr aufdecken kann.

import { useEffect, useState } from 'react'
import type { TradeRow } from '@/lib/trade-stats'
import { settlePosition } from '@/lib/trade-events'
import { nextPlannedSale, type PlannedSale } from '@/lib/trade-targets'
import {
  addToPosition,
  executeTarget,
  listTradeEvents,
  listTradeTargets,
  partialClose,
} from '@/app/actions/trades'
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
  const [plan, setPlan] = useState<PlannedSale | null>(null)

  // Beim Öffnen Felder zurücksetzen und die aktuelle Restmenge laden.
  useEffect(() => {
    if (!open) return
    setQuantity('')
    setPrice('')
    setFee('')
    setNote('')
    setOpenQty(null)
    setAvgEntry(null)
    setPlan(null)
    // Die Stufen braucht nur der Teilverkauf — beim Nachkauf gibt es nichts
    // abzutragen, also wird dafür auch nichts geladen.
    Promise.all([listTradeEvents(trade.id), isSell ? listTradeTargets(trade.id) : []])
      .then(([events, targets]) => {
        const s = settlePosition(trade, events)
        setOpenQty(s.openQty)
        setAvgEntry(s.avgEntry)
        if (!isSell) return
        // Bezug ist die ANFANGSposition, genau wie serverseitig — sonst ergäben
        // 50/30/20 nach dem ersten Teilverkauf nicht mehr die ganze Position.
        const basis = events.find((e) => e.type === 'eroeffnet')?.quantity ?? trade.positionSize ?? 0
        const vorschlag = nextPlannedSale(trade, targets, basis, s.openQty)
        if (vorschlag) {
          setPlan(vorschlag)
          setQuantity(String(vorschlag.quantity))
          setPrice(String(vorschlag.price))
        }
      })
      .catch(() => {
        setOpenQty(trade.positionSize ?? null)
        setAvgEntry(trade.entryPrice ?? null)
      })
  }, [open, trade, isSell])

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
      // Menge unverändert übernommen → das IST die geplante Stufe, also wird sie
      // auch als solche abgetragen. Verglichen wird der Zahlenwert, nicht der
      // Text: „50" und „50,0" sind dieselbe Menge.
      const alsStufe = plan != null && Math.abs(q - plan.quantity) < 1e-9
      if (alsStufe) {
        // Die Rückmeldung nennt die Menge, die der SERVER gebucht hat, nicht die
        // aus dem Feld — er deckelt auf die offene Position und ist die Wahrheit.
        const { quantity } = await executeTarget(trade.id, plan!.targetId, {
          price: p,
          fee: payload.fee,
          note: payload.note,
        })
        toast.success(`Stufe ${plan!.sortOrder + 1} ausgeführt — ${num(quantity)} Stück verkauft.`)
      } else {
        if (isSell) await partialClose(trade.id, payload)
        else await addToPosition(trade.id, payload)
        toast.success(isSell ? 'Teilverkauf gebucht.' : 'Nachkauf gebucht.')
      }
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

        {/* Der Hinweis steht NACH dem Raster, nicht darin: Als Kind des
            `grid-cols-2` schob er den Ausführungskurs in eine eigene Zeile und
            ließ rechts eine leere Spalte stehen. Er gehört unter beide Felder,
            denn er erklärt, worauf gebucht wird — Menge UND Kurs. */}
        {plan != null && (
          <p className="-mt-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
            Vorbelegt aus Stufe {plan.sortOrder + 1} — {num(plan.sharePct)} % der
            Anfangsposition bei {num(plan.price)}. Unverändert gebucht, gilt die Stufe als
            ausgeführt. Änderst du die Menge, wird es ein freier Teilverkauf und die Stufe
            bleibt offen.
          </p>
        )}

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
