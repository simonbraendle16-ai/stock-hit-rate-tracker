'use client'

import { useMemo, useState } from 'react'
import type { TradeRow } from '@/app/actions/trades'
import { updateTradePlan } from '@/app/actions/trades'
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
import { Textarea } from '@/components/ui/textarea'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

const labelCls = 'font-mono text-[10px] tracking-widest uppercase text-primary/60'

const numOrNull = (s: string): number | null => {
  const v = parseFloat(s)
  return Number.isFinite(v) ? v : null
}

export function EditTradeDialog({
  trade,
  open,
  onOpenChange,
  onDone,
}: {
  trade: TradeRow
  open: boolean
  onOpenChange: (v: boolean) => void
  onDone: () => void
}) {
  const isActive = trade.status === 'aktiv'
  const [entryPrice, setEntryPrice] = useState(String(trade.entryPrice ?? ''))
  const [stopLoss, setStopLoss] = useState(String(trade.stopLoss ?? ''))
  const [takeProfit, setTakeProfit] = useState(
    trade.takeProfit != null ? String(trade.takeProfit) : '',
  )
  const [investedAmount, setInvestedAmount] = useState(
    trade.investedAmount != null ? String(trade.investedAmount) : '',
  )
  const [takeProfitPct, setTakeProfitPct] = useState(String(trade.takeProfitPct ?? 100))
  const [elliottInvalidation, setElliottInvalidation] = useState(
    trade.elliottInvalidation != null ? String(trade.elliottInvalidation) : '',
  )
  const [elliottWaveCount, setElliottWaveCount] = useState(trade.elliottWaveCount ?? '')
  const [strategy, setStrategy] = useState(trade.strategy ?? '')
  const [notes, setNotes] = useState(trade.notes ?? '')
  const [ackViolation, setAckViolation] = useState(false)
  const [busy, setBusy] = useState(false)

  // Bei aktiven Trades ist das Verschieben von Stop/Invalidation ein Regelbruch.
  const movesLocked = useMemo(() => {
    if (!isActive) return false
    const nextStop = numOrNull(stopLoss)
    const nextInval = numOrNull(elliottInvalidation)
    const stopMoved = nextStop != null && nextStop !== trade.stopLoss
    const invalMoved = nextInval != null && nextInval !== trade.elliottInvalidation
    return stopMoved || invalMoved
  }, [isActive, stopLoss, elliottInvalidation, trade.stopLoss, trade.elliottInvalidation])

  const submit = async () => {
    if (movesLocked && !ackViolation) {
      toast.error('Stop/Invalidation eines aktiven Trades: bitte den Regelbruch bestätigen.')
      return
    }
    setBusy(true)
    try {
      await updateTradePlan(
        trade.id,
        {
          entryPrice: numOrNull(entryPrice) ?? undefined,
          stopLoss: numOrNull(stopLoss) ?? undefined,
          takeProfit: takeProfit === '' ? null : numOrNull(takeProfit),
          investedAmount: investedAmount === '' ? null : numOrNull(investedAmount),
          takeProfitPct: numOrNull(takeProfitPct) ?? undefined,
          elliottInvalidation:
            elliottInvalidation === '' ? null : numOrNull(elliottInvalidation),
          elliottWaveCount: elliottWaveCount,
          strategy,
          notes,
        },
        movesLocked, // force = Regelbruch bewusst protokollieren
      )
      toast.success(
        movesLocked ? 'Gespeichert — Regelbruch protokolliert.' : 'Trade aktualisiert.',
      )
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
            {trade.ticker} bearbeiten
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {isActive
              ? 'Aktiver Trade: Einstieg, Ziel und Kapital sind frei. Stop und Invalidation sind Plan-Lock — Änderungen werden als Regelbruch protokolliert (Douglas).'
              : 'Geplanter Trade: alle Felder frei editierbar.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Einstieg">
            <Input type="number" step="any" value={entryPrice}
              onChange={(e) => setEntryPrice(e.target.value)} className="input-ocean font-mono" />
          </Field>
          <Field label="Stop-Loss">
            <Input type="number" step="any" value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)} className="input-ocean font-mono" />
          </Field>
          <Field label="Take-Profit">
            <Input type="number" step="any" value={takeProfit}
              onChange={(e) => setTakeProfit(e.target.value)} className="input-ocean font-mono" />
          </Field>
          {trade.tradedWithMoney && (
            <>
              <Field label="Kapitaleinsatz (€)">
                <Input type="number" step="any" value={investedAmount}
                  onChange={(e) => setInvestedAmount(e.target.value)} className="input-ocean font-mono" />
              </Field>
              <Field label="Verkaufsanteil TP (%)">
                <Input type="number" step="any" value={takeProfitPct}
                  onChange={(e) => setTakeProfitPct(e.target.value)} className="input-ocean font-mono" />
              </Field>
            </>
          )}
          <Field label="Invalidation">
            <Input type="number" step="any" value={elliottInvalidation}
              onChange={(e) => setElliottInvalidation(e.target.value)} className="input-ocean font-mono" />
          </Field>
        </div>

        <div className="mt-1 space-y-3">
          <Field label="Wellenzählung">
            <Input value={elliottWaveCount}
              onChange={(e) => setElliottWaveCount(e.target.value)} className="input-ocean font-mono" />
          </Field>
          <Field label="Strategie / Setup">
            <Textarea value={strategy} onChange={(e) => setStrategy(e.target.value)}
              className="input-ocean min-h-16 font-mono text-sm" />
          </Field>
          <Field label="Notizen">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              className="input-ocean min-h-16 font-mono text-sm" />
          </Field>
        </div>

        {movesLocked && (
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <input
              type="checkbox"
              checked={ackViolation}
              onChange={(e) => setAckViolation(e.target.checked)}
              className="mt-0.5 accent-[var(--destructive)]"
            />
            <span className="flex items-start gap-1.5 font-mono text-[11px] text-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
              Ich verschiebe Stop/Invalidation eines aktiven Trades bewusst. Das wird als
              Regelbruch protokolliert und senkt meinen Disziplin-Score.
            </span>
          </label>
        )}

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={busy}
            className="btn-teal-glow w-full font-mono text-sm font-bold tracking-wider sm:w-auto"
          >
            {busy ? 'WIRD GESPEICHERT…' : 'SPEICHERN'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className={labelCls}>{label}</Label>
      {children}
    </div>
  )
}
