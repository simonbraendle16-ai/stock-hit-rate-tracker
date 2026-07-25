'use client'

// Nachtrag für den Bot-Zwilling (Etappe 5).
//
// Nur für Trades, die der Bot nicht rechnen kann — weil das Gratis-Tier keine
// Historie mehr liefert, der Ticker nicht mehr existiert oder der Trade zu alt
// ist. Statt solche Trades stumm auszulassen, darf hier von Hand stehen, was aus
// ihnen geworden wäre. In der Auswertung ist jeder Nachtrag als solcher
// gekennzeichnet.
//
// Bei „Ziel erreicht" und „Stop erreicht" wird bewusst KEIN Kurs abgefragt: der
// ergibt sich aus dem Plan. Nachgetragen wird eine Aussage über den Verlauf,
// kein frei gewählter Betrag — sonst wäre die Differenz verhandelbar.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { clearBotOutcome, setBotOutcome } from '@/app/actions/bot-twin'
import type { BotOutcome } from '@/lib/bot-twin'
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
import { PencilLine } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const CHOICES: { key: BotOutcome; label: string; hint: string }[] = [
  { key: 'ziel', label: 'Ziel erreicht', hint: 'Der Kurs hat das Ziel aus dem Plan berührt.' },
  { key: 'stop', label: 'Stop erreicht', hint: 'Der Kurs hat den Stop aus dem Plan berührt.' },
  {
    key: 'offen',
    label: 'Weder noch',
    hint: 'Keins von beidem — bewertet zu dem Kurs, den du einträgst.',
  },
]

export function BotOutcomeDialog({
  tradeId,
  ticker,
  hasTarget,
  existing = null,
}: {
  tradeId: number
  ticker: string
  /** Ohne Ziel im Plan gibt es kein „Ziel erreicht". */
  hasTarget: boolean
  existing?: { outcome: BotOutcome; exitPrice: number | null } | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [outcome, setOutcome] = useState<BotOutcome>(existing?.outcome ?? (hasTarget ? 'ziel' : 'stop'))
  const [price, setPrice] = useState(existing?.exitPrice != null ? String(existing.exitPrice) : '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setOutcome(existing?.outcome ?? (hasTarget ? 'ziel' : 'stop'))
      setPrice(existing?.exitPrice != null ? String(existing.exitPrice) : '')
      setNote('')
    }
  }, [open, existing, hasTarget])

  const submit = async () => {
    const parsed = parseFloat(price.replace(',', '.'))
    if (outcome === 'offen' && (!Number.isFinite(parsed) || parsed <= 0)) {
      toast.error('Bitte den Kurs eintragen, zu dem bewertet werden soll.')
      return
    }
    setBusy(true)
    try {
      await setBotOutcome(tradeId, {
        outcome,
        exitPrice: outcome === 'offen' ? parsed : null,
        note: note.trim() || null,
      })
      toast.success('Nachtrag gespeichert.')
      setOpen(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fehler')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await clearBotOutcome(tradeId)
      toast.success('Nachtrag entfernt.')
      setOpen(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fehler')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
      >
        <PencilLine className="size-3" />
        {existing ? 'Ändern' : 'Nachtragen'}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading tracking-wide">
              {ticker} — was wäre daraus geworden?
            </DialogTitle>
            <DialogDescription className="font-mono text-xs">
              Für diesen Trade gibt es keine Kursdaten mehr. Trag ein, wie der Plan geendet hätte,
              wenn du ihn mechanisch durchgezogen hättest. Der Eintrag zählt in die Auswertung und
              ist dort als Nachtrag gekennzeichnet — sobald doch Kursdaten vorliegen, gilt wieder
              die Messung.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Ausgang
              </Label>
              <div className="grid grid-cols-3 gap-2">
                {CHOICES.map((c) => {
                  const disabled = c.key === 'ziel' && !hasTarget
                  return (
                    <button
                      key={c.key}
                      type="button"
                      disabled={disabled}
                      onClick={() => setOutcome(c.key)}
                      className={cn(
                        'rounded-lg border py-2 font-mono text-[11px] uppercase transition-all',
                        outcome === c.key
                          ? 'border-primary/40 bg-primary/15 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/40',
                        disabled && 'cursor-not-allowed opacity-40 hover:border-border',
                      )}
                    >
                      {c.label}
                    </button>
                  )
                })}
              </div>
              <p className="min-h-4 font-mono text-[10px] text-muted-foreground">
                {hasTarget
                  ? CHOICES.find((c) => c.key === outcome)?.hint
                  : 'Dieser Trade hat kein Ziel im Plan — „Ziel erreicht" ist deshalb nicht wählbar.'}
              </p>
            </div>

            {outcome === 'offen' && (
              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Bewertungskurs <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  step="any"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0.00"
                  className="input-ocean font-mono"
                />
                <p className="font-mono text-[10px] text-muted-foreground">
                  Der Kurs, zu dem die noch offene Position bewertet wird.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Notiz (optional)
              </Label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Woher weißt du das?"
                className="input-ocean font-mono"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {existing ? (
              <Button variant="ghost" onClick={remove} disabled={busy} className="font-mono text-xs">
                Nachtrag entfernen
              </Button>
            ) : (
              <span />
            )}
            <Button onClick={submit} disabled={busy} className="font-mono text-xs">
              {busy ? 'Speichert…' : 'Speichern'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
