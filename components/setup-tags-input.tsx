'use client'

// Setup-Tags eingeben (Etappe 7b) — die auswertbare Schublade zum Trade.
//
// Bewusst eine kontrollierte Komponente ohne eigenen Speicher-Aufruf: sie wird
// im Neuanlage-Formular, im Bearbeiten-Dialog und auf der Trade-Seite benutzt
// und darf dort nicht drei verschiedene Wege in die Datenbank kennen — dieselbe
// Bauweise wie beim Emotions-Check-in.
//
// Normalisierung, Grenzen und Vorschläge kommen aus `lib/setups.ts`, derselben
// Quelle, gegen die der Server säubert und aus der die Auswertung gruppiert.

import { useEffect, useMemo, useState } from 'react'
import {
  MAX_SETUP_TAGS,
  SETUP_TAG_MAX_LEN,
  normalizeSetupTag,
  sanitizeSetupTags,
  setupTagKey,
  suggestSetupTags,
} from '@/lib/setups'
import { listSetupTagOptions } from '@/app/actions/trades'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { Tag, X } from 'lucide-react'

export function SetupTagsInput({
  value,
  onChange,
  freetext,
  disabled = false,
  label = 'Setup',
}: {
  value: string[]
  onChange: (next: string[]) => void
  /** Der Strategie-Freitext desselben Trades, als Migrationshilfe. */
  freetext?: string | null
  disabled?: boolean
  label?: string
}) {
  const [draft, setDraft] = useState('')

  // Den persönlichen Katalog holt die Komponente selbst statt ihn sich durch
  // jede Aufrufstelle reichen zu lassen (Formular, Bearbeiten-Dialog,
  // Trade-Seite) — ein Weg, der nicht an einer vergessenen Prop abbricht.
  // Nur lesend, und erst wenn die Eingabe wirklich sichtbar ist.
  const [options, setOptions] = useState<string[]>([])
  useEffect(() => {
    let live = true
    listSetupTagOptions()
      .then((tags) => {
        if (live) setOptions(tags)
      })
      // Ohne Vorschläge ist die Eingabe voll benutzbar — ein Fehler hier darf
      // das Formular nicht stören.
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  const keys = useMemo(() => new Set(value.map((t) => setupTagKey(t))), [value])
  const full = value.length >= MAX_SETUP_TAGS

  const add = (raw: string) => {
    const tag = normalizeSetupTag(raw)
    if (!tag || full || keys.has(tag.key)) return
    onChange(sanitizeSetupTags([...value, tag.label]))
  }

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag))

  const commitDraft = () => {
    add(draft)
    setDraft('')
  }

  // Nur anbieten, was noch nicht gewählt ist — eine Liste, in der die Hälfte
  // wirkungslos ist, liest sich wie ein Fehler.
  const offered = options.filter((o) => !keys.has(setupTagKey(o)))
  const fromFreetext = suggestSetupTags(freetext).filter(
    (s) => !keys.has(setupTagKey(s)) && !offered.some((o) => setupTagKey(o) === setupTagKey(s)),
  )

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </Label>
        <span className="font-mono text-[10px] text-muted-foreground">
          {value.length}/{MAX_SETUP_TAGS}
        </span>
      </div>

      {/* Gewählte Tags */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full border border-primary/50 bg-primary/15 px-2.5 py-1 font-mono text-[11px] text-primary"
            >
              <Tag className="size-3" aria-hidden />
              {tag}
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(tag)}
                aria-label={`${tag} entfernen`}
                className="ml-0.5 rounded-full text-primary/70 transition-colors hover:text-primary disabled:opacity-50"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <Input
        value={draft}
        disabled={disabled || full}
        maxLength={SETUP_TAG_MAX_LEN}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // Enter darf hier NICHT das umgebende Formular abschicken.
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commitDraft()
          }
        }}
        // Ein getippter, aber nicht bestätigter Name ginge sonst beim Speichern
        // verloren — der häufigste Weg, ein Feld für „kaputt" zu halten.
        onBlur={commitDraft}
        placeholder={
          full ? `Höchstens ${MAX_SETUP_TAGS} Setups je Trade` : 'z. B. Breakout — Enter zum Übernehmen'
        }
        className="input-ocean h-10 font-mono text-sm"
      />

      {offered.length > 0 && !full && (
        <div className="flex flex-wrap gap-1.5">
          {offered.map((tag) => (
            <ChipButton key={tag} disabled={disabled} onClick={() => add(tag)}>
              {tag}
            </ChipButton>
          ))}
        </div>
      )}

      {fromFreetext.length > 0 && !full && (
        <div className="space-y-1 rounded-lg border border-border/70 bg-muted/20 p-2">
          <p className="font-mono text-[10px] text-muted-foreground">
            Aus deinem Strategie-Text — übernehmen?
          </p>
          <div className="flex flex-wrap gap-1.5">
            {fromFreetext.map((tag) => (
              <ChipButton key={tag} disabled={disabled} onClick={() => add(tag)}>
                {tag}
              </ChipButton>
            ))}
          </div>
        </div>
      )}

      <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
        Kurze, gleichbleibende Namen — sie sind die Zeilen im Setup-Vergleich. Der
        Strategie-Text daneben bleibt die Begründung.
      </p>
    </div>
  )
}

function ChipButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-full border border-border px-2.5 py-1 font-mono text-[11px] text-muted-foreground',
        'transition-all hover:border-primary/40 hover:text-foreground disabled:opacity-50',
      )}
    >
      + {children}
    </button>
  )
}
