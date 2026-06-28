'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Check, Shield, X } from 'lucide-react'
import { cn } from '@/lib/utils'

// Die 4 Douglas-Fragen — vor dem Trade bewusst zu beantworten.
export const PRE_TRADE_QUESTIONS = [
  { key: 'wave', question: 'Ist deine Wellenzählung eindeutig?' },
  { key: 'entry', question: 'Ist dein Einstieg klar definiert?' },
  { key: 'stop', question: 'Steht dein Stop-Loss fest?' },
  { key: 'target', question: 'Ist Ziel / Invalidation festgelegt?' },
] as const

export type PreTradeAnswer = {
  key: string
  question: string
  answer: 'ja' | 'nein'
  note: string
}

type DraftAnswer = { answer: 'ja' | 'nein' | null; note: string }

const emptyDrafts = (): DraftAnswer[] =>
  PRE_TRADE_QUESTIONS.map(() => ({ answer: null, note: '' }))

export function PreTradeQuestionsDialog({
  open,
  onOpenChange,
  onComplete,
  submitting = false,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onComplete: (answers: PreTradeAnswer[]) => void
  submitting?: boolean
}) {
  const [step, setStep] = useState(0)
  const [drafts, setDrafts] = useState<DraftAnswer[]>(emptyDrafts)

  // Bei jedem Öffnen frisch starten.
  useEffect(() => {
    if (open) {
      setStep(0)
      setDrafts(emptyDrafts())
    }
  }, [open])

  const total = PRE_TRADE_QUESTIONS.length
  const current = PRE_TRADE_QUESTIONS[step]
  const draft = drafts[step]
  const isLast = step === total - 1
  const canAdvance = draft.answer !== null

  const setAnswer = (answer: 'ja' | 'nein') =>
    setDrafts((p) => p.map((d, i) => (i === step ? { ...d, answer } : d)))
  const setNote = (note: string) =>
    setDrafts((p) => p.map((d, i) => (i === step ? { ...d, note } : d)))

  const next = () => {
    if (!canAdvance) return
    if (isLast) {
      const answers: PreTradeAnswer[] = PRE_TRADE_QUESTIONS.map((q, i) => ({
        key: q.key,
        question: q.question,
        answer: drafts[i].answer as 'ja' | 'nein',
        note: drafts[i].note.trim(),
      }))
      onComplete(answers)
    } else {
      setStep((s) => s + 1)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Shield className="size-4 text-primary" />
            <DialogTitle className="font-heading tracking-wide">
              Die 4 Fragen von Douglas
            </DialogTitle>
          </div>
          <DialogDescription className="font-mono text-xs">
            Frage {step + 1} von {total} — entscheide den Trade, bevor du ihn eingehst.
          </DialogDescription>
        </DialogHeader>

        {/* Fortschritt */}
        <div className="flex gap-1.5">
          {PRE_TRADE_QUESTIONS.map((q, i) => (
            <div
              key={q.key}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors',
                i < step
                  ? drafts[i].answer === 'ja'
                    ? 'bg-positive'
                    : 'bg-destructive'
                  : i === step
                    ? 'bg-primary'
                    : 'bg-border',
              )}
            />
          ))}
        </div>

        <div className="flex flex-col gap-4 py-1">
          <p className="font-heading text-base font-bold text-foreground">
            {current.question}
          </p>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setAnswer('ja')}
              className={cn(
                'flex items-center justify-center gap-2 rounded-lg border py-3 font-mono text-sm font-bold uppercase transition-all',
                draft.answer === 'ja'
                  ? 'border-positive/40 bg-positive/15 text-positive'
                  : 'border-border text-muted-foreground',
              )}
            >
              <Check className="size-4" /> Ja
            </button>
            <button
              type="button"
              onClick={() => setAnswer('nein')}
              className={cn(
                'flex items-center justify-center gap-2 rounded-lg border py-3 font-mono text-sm font-bold uppercase transition-all',
                draft.answer === 'nein'
                  ? 'border-destructive/40 bg-destructive/15 text-destructive'
                  : 'border-border text-muted-foreground',
              )}
            >
              <X className="size-4" /> Nein
            </button>
          </div>

          {draft.answer === 'nein' && (
            <p className="font-mono text-[11px] text-warning">
              Ein „Nein" bedeutet: Der Trade bleibt ein Entwurf und ist nicht aktivierbar.
            </p>
          )}

          <div className="space-y-2">
            <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Kurze Bemerkung (optional)
            </Label>
            <Textarea
              value={draft.note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Gedanke zu dieser Frage…"
              className="input-ocean min-h-16 font-mono text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={step === 0 || submitting}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className="font-mono text-xs"
          >
            Zurück
          </Button>
          <Button
            type="button"
            disabled={!canAdvance || submitting}
            onClick={next}
            className="btn-teal-glow font-mono text-sm font-bold tracking-wider"
          >
            {isLast ? (submitting ? 'WIRD GESPEICHERT…' : 'BESTÄTIGEN') : 'WEITER'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
