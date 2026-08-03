'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Field, FormSection, ChoiceButton, InlineNotice } from '@/components/form-frame'
import { SetupTagsInput } from '@/components/setup-tags-input'
import { commitTrainingThesis } from '@/app/actions/training'
import {
  TRAINING_DIRECTIONS,
  requiresElliott,
  validateThesis,
  type TrainingDirection,
  type TrainingMode,
} from '@/lib/training'
import { AlertTriangle, Lock, PenLine } from 'lucide-react'
import { toast } from 'sonner'

function zahl(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/**
 * Die These VOR dem Aufdecken. Sie ist der Grund, warum die Übung überhaupt
 * etwas misst: Erst wenn sie steht, gibt der Replay die nächste Kerze frei.
 *
 * Bewusst dieselben Felder wie im Trade-Formular (Einstieg, Stop, Ziel,
 * Invalidation) — geübt wird der Plan, den man auch im Ernstfall schreibt.
 */
export function ThesisForm({
  sessionId,
  mode,
  onCommitted,
}: {
  sessionId: number
  mode: TrainingMode
  onCommitted: () => void
}) {
  const [direction, setDirection] = useState<TrainingDirection>('long')
  const [entry, setEntry] = useState('')
  const [stop, setStop] = useState('')
  const [target, setTarget] = useState('')
  const [invalidation, setInvalidation] = useState('')
  const [elliott, setElliott] = useState('')
  const [setupTags, setSetupTags] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const thesis = {
    direction,
    elliottCount: elliott.trim() || null,
    invalidation: zahl(invalidation),
    entryPrice: zahl(entry),
    stopLoss: zahl(stop),
    takeProfit: zahl(target),
    note: note.trim() || null,
    setupTags,
  }
  const maengel = validateThesis(mode, thesis)
  const mitPosition = direction === 'long' || direction === 'short'

  async function submit() {
    if (maengel.length > 0) return
    setSaving(true)
    const res = await commitTrainingThesis({ sessionId, ...thesis })
    setSaving(false)
    if ('error' in res) {
      toast.error(res.error)
      return
    }
    toast.success('These steht fest — jetzt darf der Markt antworten.')
    onCommitted()
  }

  return (
    <FormSection
      icon={PenLine}
      title="Deine These"
      hint="Erst festschreiben, dann aufdecken. Danach ist sie unveränderlich."
    >
      <Field label="Richtung" as="div">
        <div className="grid grid-cols-3 gap-2">
          {TRAINING_DIRECTIONS.map((d) => (
            <ChoiceButton
              key={d.id}
              active={direction === d.id}
              tone={d.id === 'long' ? 'positive' : d.id === 'short' ? 'destructive' : 'neutral'}
              onClick={() => setDirection(d.id)}
            >
              {d.label}
            </ChoiceButton>
          ))}
        </div>
      </Field>

      {mitPosition && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Einstieg">
            <Input
              inputMode="decimal"
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              placeholder="optional"
              className="font-mono"
            />
          </Field>
          <Field label="Stop">
            <Input
              inputMode="decimal"
              value={stop}
              onChange={(e) => setStop(e.target.value)}
              placeholder="optional"
              className="font-mono"
            />
          </Field>
          <Field label="Ziel">
            <Input
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="optional"
              className="font-mono"
            />
          </Field>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label={requiresElliott(mode) ? 'Wellenzählung (Pflicht)' : 'Wellenzählung'}
          hint="Zum Beispiel: Welle 4 einer übergeordneten 3."
        >
          <Input
            value={elliott}
            onChange={(e) => setElliott(e.target.value)}
            placeholder="Welle 3, Impuls"
            className="font-mono text-xs"
          />
        </Field>
        <Field
          label={requiresElliott(mode) ? 'Invalidation (Pflicht)' : 'Invalidation'}
          hint="Der Kurs, ab dem die Zählung widerlegt ist."
        >
          <Input
            inputMode="decimal"
            value={invalidation}
            onChange={(e) => setInvalidation(e.target.value)}
            placeholder="optional"
            className="font-mono"
          />
        </Field>
      </div>

      <SetupTagsInput value={setupTags} onChange={setSetupTags} />

      <Field label="Begründung" hint="Woran machst du das fest? Der Satz zählt später mehr als das Ergebnis.">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="input-ocean w-full rounded-lg px-3 py-2 font-mono text-xs"
          placeholder="Struktur, Auslöser, Ungültigkeit ..."
        />
      </Field>

      {maengel.length > 0 && (
        <InlineNotice tone="warning" icon={AlertTriangle}>
          {maengel.join(' ')}
        </InlineNotice>
      )}

      <Button
        onClick={submit}
        disabled={saving || maengel.length > 0}
        className="w-full gap-2 font-mono"
      >
        <Lock className="size-4" />
        {saving ? 'Wird festgeschrieben ...' : 'These festschreiben'}
      </Button>
    </FormSection>
  )
}
