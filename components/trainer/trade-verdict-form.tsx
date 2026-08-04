'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FormSection, ChoiceButton, InlineNotice } from '@/components/form-frame'
import { rateTrainingTrade } from '@/app/actions/training-trades'
import {
  MAX_TRAINING_ERRORS,
  TRAINING_ERROR_TAGS,
  TRAINING_RATINGS,
  type TrainingErrorTag,
  type TrainingRating,
} from '@/lib/training'
import { suggestRating, type TrainingTradeView } from '@/lib/training-trade'
import { Scale } from 'lucide-react'
import { toast } from 'sonner'

function fmt(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Die eigene Einordnung eines gemessenen Trades.
 *
 * Das Ergebnis steht schon fest und ist nicht änderbar — gemessen wird aus den
 * Kerzen. Bewertet wird die ANALYSE, und das ist eine andere Frage: Ein Trade
 * kann sein Ziel erreichen und die Zählung trotzdem falsch gewesen sein. Genau
 * deshalb ist die Vorbelegung nur ein Vorschlag.
 */
export function TradeVerdictForm({
  sessionId,
  trade,
  onSaved,
}: {
  sessionId: number
  trade: TrainingTradeView
  onSaved: () => void
}) {
  const vorschlag = trade.outcome ? suggestRating(trade.outcome) : 'teilweise'
  const [rating, setRating] = useState<TrainingRating>(vorschlag)
  const [tags, setTags] = useState<TrainingErrorTag[]>([])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  function toggle(id: TrainingErrorTag) {
    setTags((t) =>
      t.includes(id)
        ? t.filter((x) => x !== id)
        : t.length >= MAX_TRAINING_ERRORS
          ? t
          : [...t, id],
    )
  }

  async function speichern() {
    setSaving(true)
    try {
      const res = await rateTrainingTrade({
        sessionId,
        tradeId: trade.id,
        rating,
        errorTags: tags,
        note: note.trim() || null,
      })
      if (!res.ok) {
        toast.error(res.reason)
        return
      }
      onSaved()
    } catch {
      toast.error('Konnte nicht gespeichert werden.')
    } finally {
      setSaving(false)
    }
  }

  const gewonnen = trade.outcome === 'ziel'

  return (
    <FormSection
      icon={Scale}
      title={`Trade #${trade.seq} einordnen`}
      hint="Das Ergebnis ist gemessen. Hier geht es darum, ob die Analyse gestimmt hat."
    >
      {/* Das Ergebnis groß und mit Ton — es ist der Moment, um den es geht.
          Das R-Vielfache steht dabei vor dem Kurs: Was zählt, ist das Verhältnis
          zum eingegangenen Risiko, nicht der Betrag. */}
      <div
        className={`panel-sunken flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-3 ${
          gewonnen
            ? 'text-positive'
            : trade.outcome === 'stop'
              ? 'text-destructive'
              : 'text-muted-foreground'
        }`}
      >
        <span className="font-mono text-2xl font-semibold">
          {trade.rMultiple != null
            ? `${trade.rMultiple >= 0 ? '+' : ''}${fmt(trade.rMultiple)} R`
            : '—'}
        </span>
        <span className="font-mono text-sm">
          {trade.outcome === 'ziel' && 'Ziel erreicht'}
          {trade.outcome === 'stop' && 'Stop ausgelöst'}
          {trade.outcome === 'offen' && 'weder Stop noch Ziel berührt'}
        </span>
      </div>

      {trade.ambiguous && (
        <InlineNotice tone="warning">
          Stop und Ziel lagen in derselben Kerze. Aus einer Kerze geht nicht hervor, was
          zuerst kam — es gilt der Stop.
        </InlineNotice>
      )}

      <Field label="War die Analyse richtig?">
        <div className="flex flex-wrap gap-1.5">
          {TRAINING_RATINGS.map((r) => (
            <ChoiceButton key={r.id} active={rating === r.id} onClick={() => setRating(r.id)}>
              {r.label}
            </ChoiceButton>
          ))}
        </div>
      </Field>

      <Field
        label="Fehler"
        hint={`Fester Katalog, damit sich über Monate zählen lässt. Höchstens ${MAX_TRAINING_ERRORS}.`}
      >
        <div className="flex flex-wrap gap-1.5">
          {TRAINING_ERROR_TAGS.map((t) => (
            <ChoiceButton key={t.id} active={tags.includes(t.id)} onClick={() => toggle(t.id)}>
              {t.label}
            </ChoiceButton>
          ))}
        </div>
      </Field>

      <Field label="Notiz">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Was war zu sehen, was hast du übersehen?"
          className="input-ocean w-full rounded-lg px-3 py-2 font-mono text-xs"
        />
      </Field>

      <Button size="sm" className="h-9 px-3" disabled={saving} onClick={speichern}>
        Einordnung speichern
      </Button>
    </FormSection>
  )
}
