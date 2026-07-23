'use client'

// Der Emotions-Check-in: Skala + Tags + optionale Notiz.
//
// Bewusst eine kontrollierte Komponente ohne eigenen Speicher-Aufruf — sie wird
// an zwei Stellen eingesetzt (Aktivieren-Dialog und Abschließen-Dialog) und
// darf dort nicht zwei verschiedene Wege in die Datenbank kennen.
//
// Skala und Tags kommen aus `lib/emotions.ts`, derselben Quelle, gegen die der
// Server validiert und aus der die Auswertung rechnet.

import type { MoodScore, MoodTone } from '@/lib/emotions'
import {
  EMOTION_TAGS,
  MOOD_NOTE_MAX,
  MOOD_SCALE,
  emotionTagLabel,
  moodScoreLabel,
  normalizeMoodScore,
  parseMoodTags,
  type EmotionTagKey,
} from '@/lib/emotions'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { Activity } from 'lucide-react'

export type MoodDraft = {
  score: MoodScore | null
  tags: EmotionTagKey[]
  note: string
}

export const emptyMoodDraft = (): MoodDraft => ({ score: null, tags: [], note: '' })

/** Fertig zum Absenden, sobald ein Skalenwert gewählt ist — Tags sind freiwillig. */
export const isMoodDraftComplete = (d: MoodDraft): boolean => d.score !== null

// Tailwind braucht statische Klassennamen — deshalb feste Maps statt Interpolation.
const toneSelected: Record<MoodTone, string> = {
  ruhig: 'border-positive/50 bg-positive/15 text-positive',
  mittel: 'border-warning/50 bg-warning/15 text-warning',
  unruhig: 'border-destructive/50 bg-destructive/15 text-destructive',
}

const tagSelected: Record<'belastend' | 'tragend', string> = {
  belastend: 'border-destructive/50 bg-destructive/15 text-destructive',
  tragend: 'border-positive/50 bg-positive/15 text-positive',
}

const phaseText = {
  entry: {
    title: 'Wie ruhig bist du gerade?',
    lead: 'Vor dem Einstieg — die Momentaufnahme wird mit dem Trade gespeichert und später gegen dein Ergebnis gerechnet.',
    tagLead: 'Was ist gerade da? (optional, Mehrfachauswahl)',
    notePlaceholder: 'Was geht dir kurz vor dem Einstieg durch den Kopf …',
  },
  exit: {
    title: 'Wie gehst du aus dem Trade?',
    lead: 'Beim Abschließen — zusammen mit dem Einstieg zeigt sie, was der Trade mit dir gemacht hat.',
    tagLead: 'Was war beim Ausstieg da? (optional, Mehrfachauswahl)',
    notePlaceholder: 'Was hat den Ausstieg bestimmt …',
  },
} as const

export function MoodCheck({
  value,
  onChange,
  phase = 'entry',
  disabled = false,
}: {
  value: MoodDraft
  onChange: (next: MoodDraft) => void
  phase?: 'entry' | 'exit'
  disabled?: boolean
}) {
  const text = phaseText[phase]
  const selected = value.score !== null ? MOOD_SCALE[value.score - 1] : null

  const toggleTag = (key: EmotionTagKey) =>
    onChange({
      ...value,
      tags: value.tags.includes(key)
        ? value.tags.filter((t) => t !== key)
        : [...value.tags, key],
    })

  return (
    <div className="space-y-4 rounded-lg border border-primary/20 bg-primary/5 p-3">
      <div className="flex items-start gap-2">
        <Activity className="mt-0.5 size-4 shrink-0 text-primary" />
        <div>
          <p className="font-heading text-sm font-bold text-foreground">{text.title}</p>
          <p className="mt-0.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
            {text.lead}
          </p>
        </div>
      </div>

      {/* Skala 1–5 */}
      <div className="space-y-2">
        <div className="grid grid-cols-5 gap-1.5">
          {MOOD_SCALE.map((step) => {
            const active = value.score === step.value
            return (
              <button
                key={step.value}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                aria-label={`${step.value} — ${step.label}`}
                onClick={() => onChange({ ...value, score: step.value })}
                className={cn(
                  'flex flex-col items-center gap-0.5 rounded-lg border py-2 transition-all disabled:opacity-50',
                  active
                    ? toneSelected[step.tone]
                    : 'border-border text-muted-foreground hover:border-primary/40',
                )}
              >
                <span className="font-heading text-lg font-bold leading-none">{step.value}</span>
                <span className="font-mono text-[8px] uppercase tracking-wider">{step.label}</span>
              </button>
            )
          })}
        </div>
        <p className="min-h-4 font-mono text-[10px] text-muted-foreground">
          {selected ? selected.hint : '1 = ruhig · 5 = aufgewühlt'}
        </p>
      </div>

      {/* Tags */}
      <div className="space-y-2">
        <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {text.tagLead}
        </Label>
        <div className="flex flex-wrap gap-1.5">
          {EMOTION_TAGS.map((tag) => {
            const active = value.tags.includes(tag.key)
            return (
              <button
                key={tag.key}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                title={tag.hint}
                onClick={() => toggleTag(tag.key)}
                className={cn(
                  'rounded-full border px-2.5 py-1 font-mono text-[11px] transition-all disabled:opacity-50',
                  active
                    ? tagSelected[tag.tone]
                    : 'border-border text-muted-foreground hover:border-primary/40',
                )}
              >
                {tag.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Notiz */}
      <div className="space-y-2">
        <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Notiz (optional)
        </Label>
        <Textarea
          value={value.note}
          disabled={disabled}
          maxLength={MOOD_NOTE_MAX}
          onChange={(e) => onChange({ ...value, note: e.target.value })}
          placeholder={text.notePlaceholder}
          className="input-ocean min-h-14 font-mono text-sm"
        />
      </div>
    </div>
  )
}

/**
 * Kompakte Anzeige einer gespeicherten Momentaufnahme (Trade-Karte, Detailseite).
 * Gibt `null` zurück, wenn kein Check-in vorliegt — Alt-Trades bleiben leer,
 * statt einen Platzhalter zu zeigen, der wie ein Wert aussieht.
 */
export function MoodBadge({
  score,
  tags,
  phase,
}: {
  score: number | null
  tags: string | null
  phase: 'entry' | 'exit'
}) {
  const value = normalizeMoodScore(score)
  if (value === null) return null

  const step = MOOD_SCALE[value - 1]
  const keys = parseMoodTags(tags)

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className={cn(
          'rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider',
          toneSelected[step.tone],
        )}
      >
        {phase === 'entry' ? 'ein' : 'aus'} · {moodScoreLabel(value)}
      </span>
      {keys.map((k) => (
        <span
          key={k}
          className="rounded-full border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
        >
          {emotionTagLabel(k)}
        </span>
      ))}
    </span>
  )
}
