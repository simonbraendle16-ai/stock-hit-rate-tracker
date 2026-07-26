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
import { Textarea } from '@/components/ui/textarea'
import { ChoiceButton, Field } from '@/components/form-frame'
import { Check, Shield, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PRE_TRADE_QUESTIONS, type PreTradeAnswer } from '@/lib/pre-trade-questions'

export { PRE_TRADE_QUESTIONS, type PreTradeAnswer }

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
              Die Fragen von Douglas
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
            <ChoiceButton
              active={draft.answer === 'ja'}
              tone="positive"
              icon={Check}
              onClick={() => setAnswer('ja')}
              className="py-3 uppercase"
            >
              Ja
            </ChoiceButton>
            <ChoiceButton
              active={draft.answer === 'nein'}
              tone="destructive"
              icon={X}
              onClick={() => setAnswer('nein')}
              className="py-3 uppercase"
            >
              Nein
            </ChoiceButton>
          </div>

          {draft.answer === 'nein' && (
            <p className="note text-warning">
              Ein „Nein" bedeutet: Der Trade bleibt ein Entwurf und ist nicht aktivierbar.
            </p>
          )}

          <Field label="Kurze Bemerkung (optional)">
            <Textarea
              value={draft.note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Gedanke zu dieser Frage…"
              className="input-ocean min-h-16 font-mono text-sm"
            />
          </Field>
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
