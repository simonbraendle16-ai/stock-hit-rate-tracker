'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { addCashflow, deleteCashflow, type Cashflow } from '@/app/actions/cashflows'
import { formatMoney } from '@/lib/format'
import { ArrowDownToLine, ArrowUpFromLine, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const labelCls = 'font-mono text-[10px] tracking-widest uppercase text-primary/60'

function isoDate(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10)
}

/**
 * Ein- und Auszahlungen. Ohne sie rechnet die Rendite gegen ein fixes
 * Startkapital und wird ab der ersten Nachzahlung falsch.
 */
export function CashflowList({
  items,
  currency = 'EUR',
}: {
  items: Cashflow[]
  currency?: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState<'einzahlung' | 'auszahlung'>('einzahlung')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(isoDate(new Date()))
  const [note, setNote] = useState('')

  const net = items.reduce(
    (acc, c) => acc + (c.kind === 'auszahlung' ? -c.amount : c.amount),
    0,
  )

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await addCashflow({ amount: parseFloat(amount), kind, occurredAt: date, note })
      setAmount('')
      setNote('')
      toast.success(kind === 'einzahlung' ? 'Einzahlung erfasst.' : 'Auszahlung erfasst.')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Konnte nicht gespeichert werden.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: number) => {
    setBusy(true)
    try {
      await deleteCashflow(id)
      toast.success('Eintrag gelöscht.')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fehler')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="glass-card space-y-4 p-5">
      <div className="flex items-center gap-2">
        <ArrowDownToLine className="size-4 text-primary" />
        <p className="font-mono text-[10px] font-bold tracking-widest text-primary">
          EIN- & AUSZAHLUNGEN
        </p>
        {items.length > 0 && (
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
            Netto {formatMoney(net, currency)}
          </span>
        )}
      </div>

      <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
        Geld, das du auf das Handelskonto einzahlst oder entnimmst. Die Rendite misst danach
        gegen dein tatsächlich eingesetztes Kapital — eine Auszahlung ist kein Verlust und
        zählt nicht in den Drawdown.
      </p>

      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {(['einzahlung', 'auszahlung'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-lg border py-2 font-mono text-xs uppercase transition-all',
                kind === k
                  ? k === 'einzahlung'
                    ? 'border-positive/40 bg-positive/15 text-positive'
                    : 'border-warning/40 bg-warning/15 text-warning'
                  : 'border-border text-muted-foreground',
              )}
            >
              {k === 'einzahlung' ? (
                <ArrowDownToLine className="size-3.5" />
              ) : (
                <ArrowUpFromLine className="size-3.5" />
              )}
              {k}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className={labelCls}>Betrag</Label>
            <Input
              type="number"
              step="any"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="z. B. 2000"
              className="input-ocean h-11 font-mono"
              required
            />
          </div>
          <div className="space-y-2">
            <Label className={labelCls}>Datum</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input-ocean h-11 font-mono"
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label className={labelCls}>Notiz (optional)</Label>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="z. B. Sparplan, Entnahme für Miete"
            className="input-ocean h-11 font-mono"
          />
        </div>

        <Button
          type="submit"
          disabled={busy}
          className="btn-teal-glow h-10 font-mono text-xs font-bold tracking-wider"
        >
          {busy ? 'WIRD GESPEICHERT…' : 'ERFASSEN'}
        </Button>
      </form>

      {items.length > 0 && (
        <div className="divide-y divide-border border-t border-border pt-1">
          {items.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 py-2 font-mono text-xs">
              <span className="flex items-center gap-2">
                {c.kind === 'einzahlung' ? (
                  <ArrowDownToLine className="size-3.5 text-positive" />
                ) : (
                  <ArrowUpFromLine className="size-3.5 text-warning" />
                )}
                <span
                  className={cn(
                    'font-bold',
                    c.kind === 'einzahlung' ? 'text-positive' : 'text-warning',
                  )}
                >
                  {c.kind === 'auszahlung' ? '−' : '+'}
                  {formatMoney(c.amount, currency)}
                </span>
                <span className="text-muted-foreground">
                  {new Date(c.occurredAt).toLocaleDateString('de-DE')}
                </span>
                {c.note && <span className="text-muted-foreground/70">· {c.note}</span>}
              </span>
              <button
                type="button"
                onClick={() => remove(c.id)}
                disabled={busy}
                className="text-muted-foreground transition-colors hover:text-destructive"
                aria-label="Eintrag löschen"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
