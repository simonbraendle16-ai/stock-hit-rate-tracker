'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FormSection, ChoiceButton, InlineNotice } from '@/components/form-frame'
import { saveTrainingResult } from '@/app/actions/training'
import {
  MAX_TRAINING_ERRORS,
  TRAINING_ERROR_TAGS,
  TRAINING_RATINGS,
  type TrainingErrorTag,
  type TrainingRating,
} from '@/lib/training'
import { cn } from '@/lib/utils'
import { Eye, Info, Scale } from 'lucide-react'
import { toast } from 'sonner'

/**
 * Die Bewertung NACH dem Aufdecken (Phase 3 des Trainer-Plans).
 *
 * Die Fehler kommen aus einem festen Katalog, nicht aus einem Textfeld: Nur so
 * lässt sich nach zwanzig Übungen sagen, welcher Fehler der eigene ist. Die
 * Notiz daneben bleibt für alles, was kein Muster ist.
 */
export function VerdictForm({
  sessionId,
  revealedCandles,
  enoughRevealed,
  onSaved,
}: {
  sessionId: number
  revealedCandles: number
  /** Solange nichts aufgedeckt ist, gibt es nichts zu bewerten. */
  enoughRevealed: boolean
  onSaved: () => void
}) {
  const [rating, setRating] = useState<TrainingRating | null>(null)
  const [errors, setErrors] = useState<TrainingErrorTag[]>([])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  function toggle(id: TrainingErrorTag) {
    setErrors((prev) => {
      if (prev.includes(id)) return prev.filter((t) => t !== id)
      if (id === 'kein_fehler') return ['kein_fehler']
      const ohneLeer = prev.filter((t) => t !== 'kein_fehler')
      if (ohneLeer.length >= MAX_TRAINING_ERRORS) return ohneLeer
      return [...ohneLeer, id]
    })
  }

  async function submit() {
    if (!rating) return
    setSaving(true)
    const res = await saveTrainingResult({
      sessionId,
      rating,
      errorTags: errors,
      note: note.trim() || null,
      revealedCandles,
    })
    setSaving(false)
    if ('error' in res) {
      toast.error(res.error)
      return
    }
    toast.success('Bewertet — die Übung zählt jetzt in der Statistik.')
    onSaved()
  }

  return (
    <FormSection
      icon={Scale}
      title="Bewertung"
      hint="Ehrlich, nicht freundlich. Ein guter Trade ist ein plan-konformer Trade."
    >
      {!enoughRevealed && (
        <InlineNotice tone="warning" icon={Eye}>
          Gib erst Kerzen frei — vor dem Aufdecken gibt es nichts zu bewerten.
        </InlineNotice>
      )}

      <Field label="Ergebnis der These" as="div">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {TRAINING_RATINGS.map((r) => (
            <ChoiceButton
              key={r.id}
              active={rating === r.id}
              tone={
                r.id === 'korrekt' ? 'positive' : r.id === 'falsch' ? 'destructive' : 'warning'
              }
              disabled={!enoughRevealed}
              onClick={() => setRating(r.id)}
              className="flex-col gap-0.5 py-3"
            >
              <span>{r.label}</span>
            </ChoiceButton>
          ))}
        </div>
        {rating && (
          <p className="note">{TRAINING_RATINGS.find((r) => r.id === rating)!.hint}</p>
        )}
      </Field>

      <Field
        label={`Was ist schiefgelaufen? (bis zu ${MAX_TRAINING_ERRORS})`}
        as="div"
        hint="Fester Katalog — nur so lässt sich zählen, welcher Fehler wiederkommt."
      >
        <div className="flex flex-wrap gap-1.5">
          {TRAINING_ERROR_TAGS.map((t) => {
            const active = errors.includes(t.id)
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={active}
                disabled={!enoughRevealed}
                onClick={() => toggle(t.id)}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5 font-mono text-[11px] transition-colors disabled:opacity-50',
                  active
                    ? 'border-primary/60 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                )}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </Field>

      <Field label="Notiz" hint="Was nimmst du aus dieser Übung mit?">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          disabled={!enoughRevealed}
          className="input-ocean w-full rounded-lg px-3 py-2 font-mono text-xs disabled:opacity-50"
          placeholder="Die Zählung stimmte, der Einstieg war zwei Kerzen zu früh ..."
        />
      </Field>

      <InlineNotice tone="neutral" icon={Info}>
        Bewertet nach {revealedCandles} freigegebenen Kerze{revealedCandles === 1 ? '' : 'n'}.
      </InlineNotice>

      <Button
        onClick={submit}
        disabled={saving || !rating || !enoughRevealed}
        className="w-full gap-2 font-mono"
      >
        <Scale className="size-4" />
        {saving ? 'Wird gespeichert ...' : 'Bewertung speichern und auflösen'}
      </Button>
    </FormSection>
  )
}
