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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { changeCurrency } from '@/app/actions/settings'
import { exportTradesCsv } from '@/app/actions/trades'
import { AlertTriangle, Download } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

/**
 * Währungswechsel — der einzige Vorgang der App, der bestehende Geldbeträge
 * verändert. Deshalb drei Sicherungen: erzwungener Export vorher, manuell
 * eingegebener Kurs (keine stille Abhängigkeit von einer Kursquelle) und eine
 * ausdrückliche Bestätigung.
 */
export function CurrencyChangeDialog({
  open,
  onOpenChange,
  from,
  to,
  otherSettings,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  from: string
  to: string
  otherSettings: {
    startCapital: number
    defaultRiskPct: number
    maxRiskPct: number
    defaultFeeEntry: number
    defaultFeeExit: number
  }
}) {
  const router = useRouter()
  const [rate, setRate] = useState('1')
  const [convert, setConvert] = useState(true)
  const [exported, setExported] = useState(false)
  const [busy, setBusy] = useState(false)

  const parsedRate = parseFloat(rate)
  const rateValid = Number.isFinite(parsedRate) && parsedRate > 0
  const canSubmit = !busy && (!convert || (exported && rateValid))

  const doExport = async () => {
    try {
      const csv = await exportTradesCsv()
      const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `trades-vor-waehrungswechsel-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      setExported(true)
      toast.success('Sicherung heruntergeladen.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export fehlgeschlagen.')
    }
  }

  const submit = async () => {
    setBusy(true)
    try {
      const result = await changeCurrency({
        currency: to,
        rate: convert ? parsedRate : null,
        ...otherSettings,
      })
      toast.success(
        convert
          ? `Währung auf ${to} umgestellt · ${result.converted} Beträge umgerechnet.`
          : `Währung auf ${to} umgestellt — Beträge unverändert.`,
      )
      onOpenChange(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Umstellung fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-heading tracking-wide">
            Währung {from} → {to}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            Das ist der einzige Vorgang, der bestehende Beträge verändert. Kurse (Einstieg,
            Stop, Ziel) bleiben unangetastet — sie notieren in der Währung des Instruments.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setConvert(true)}
              className={cn(
                'rounded-lg border p-3 text-left font-mono text-xs transition-all',
                convert
                  ? 'border-primary/40 bg-primary/15 text-primary'
                  : 'border-border text-muted-foreground',
              )}
            >
              <span className="block font-bold uppercase">Umrechnen</span>
              <span className="mt-1 block text-[10px] leading-snug opacity-80">
                Kapitaleinsätze, Gebühren, Startkapital und Cashflows werden mit deinem Kurs
                umgerechnet.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setConvert(false)}
              className={cn(
                'rounded-lg border p-3 text-left font-mono text-xs transition-all',
                !convert
                  ? 'border-primary/40 bg-primary/15 text-primary'
                  : 'border-border text-muted-foreground',
              )}
            >
              <span className="block font-bold uppercase">Nur Anzeige</span>
              <span className="mt-1 block text-[10px] leading-snug opacity-80">
                Zahlen bleiben, nur das Symbol ändert sich. Aus 10.000 {from} werden 10.000{' '}
                {to}.
              </span>
            </button>
          </div>

          {convert && (
            <>
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                <p className="font-mono text-[11px] leading-relaxed text-warning">
                  Dieser Schritt schreibt in deine Historie und lässt sich nicht rückgängig
                  machen. Lade zuerst die Sicherung herunter — sie ist dein einziger Rückweg.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Umrechnungskurs · 1 {from} = ? {to}
                </Label>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  className="input-ocean font-mono"
                />
                <p className="font-mono text-[10px] text-muted-foreground">
                  Bewusst manuell: Bei einem schreibenden Eingriff soll keine Kursquelle
                  stillschweigend entscheiden, was mit deinen Zahlen passiert.
                </p>
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={doExport}
                className="h-10 font-mono text-xs"
              >
                <Download className="size-4" />
                {exported ? 'Sicherung erneut laden' : 'Sicherung herunterladen (nötig)'}
              </Button>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={!canSubmit}
            className="btn-teal-glow w-full font-mono text-sm font-bold tracking-wider sm:w-auto"
          >
            {busy ? 'WIRD UMGESTELLT…' : `AUF ${to} UMSTELLEN`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
