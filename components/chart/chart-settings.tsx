'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Settings2, X } from 'lucide-react'
import {
  APPEARANCE_PRESETS,
  DEFAULT_APPEARANCE,
  matchingPreset,
  type ChartAppearance,
} from '@/lib/chart-appearance'

/** Die Felder in der Reihenfolge, in der man sie beim Einrichten braucht. */
const FELDER: { key: keyof ChartAppearance; label: string; hint?: string }[] = [
  { key: 'bg', label: 'Hintergrund', hint: 'transparent = die Karte scheint durch' },
  { key: 'up', label: 'Kerze steigend' },
  { key: 'down', label: 'Kerze fallend' },
  { key: 'borderUp', label: 'Rand steigend' },
  { key: 'borderDown', label: 'Rand fallend' },
  { key: 'wickUp', label: 'Docht steigend' },
  { key: 'wickDown', label: 'Docht fallend' },
  { key: 'grid', label: 'Gitter' },
  { key: 'text', label: 'Achsenschrift' },
  { key: 'border', label: 'Achsenlinie' },
  { key: 'accent', label: 'Linie / Marke', hint: 'Linien- und Flächenchart, Crosshair' },
]

/** `transparent` und rgba() kann der Farbwähler nicht — dann bleibt das Textfeld. */
function alsHex(v: string): string | null {
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : null
}

/**
 * Das Aussehen des Charts einstellen.
 *
 * Bewusst kein Vorschau-Fenster im Dialog: Der Chart dahinter IST die Vorschau
 * — jede Änderung greift sofort. Gespeichert wird erst auf Knopfdruck, und
 * „Abbrechen" stellt den Stand von vorher wieder her.
 */
export function ChartSettings({
  value,
  onChange,
  onSave,
  onReset,
}: {
  value: ChartAppearance
  onChange: (next: ChartAppearance) => void
  onSave: (next: ChartAppearance) => Promise<void>
  onReset: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  /** Stand beim Öffnen — „Abbrechen" kehrt hierhin zurück. */
  const vorher = useRef<ChartAppearance>(value)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') abbrechen()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function oeffnen() {
    vorher.current = value
    setFehler(null)
    setOpen(true)
  }

  function abbrechen() {
    onChange(vorher.current)
    setOpen(false)
  }

  function setzen(key: keyof ChartAppearance, v: string | boolean) {
    onChange({ ...value, [key]: v } as ChartAppearance)
  }

  async function speichern() {
    setSaving(true)
    setFehler(null)
    try {
      await onSave(value)
      setOpen(false)
    } catch {
      setFehler('Konnte nicht gespeichert werden. Die Ansicht bleibt bis zum Neuladen.')
    } finally {
      setSaving(false)
    }
  }

  async function zuruecksetzen() {
    setSaving(true)
    setFehler(null)
    try {
      onChange(DEFAULT_APPEARANCE)
      await onReset()
      setOpen(false)
    } catch {
      setFehler('Konnte nicht zurückgesetzt werden.')
    } finally {
      setSaving(false)
    }
  }

  const aktivesPreset = matchingPreset(value)

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 w-7 p-0"
        title="Chart-Aussehen"
        aria-label="Chart-Aussehen"
        onClick={oeffnen}
      >
        <Settings2 className="size-3.5" />
      </Button>

      {open &&
        createPortal(
          // `position` inline: `body > * { position: relative }` in globals.css
          // liegt außerhalb der Tailwind-Layer und schlüge die Utility sonst.
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 60 }}
            className="flex items-start justify-end p-3 sm:p-6"
          >
            <div
              className="absolute inset-0 bg-black/50"
              onClick={abbrechen}
              aria-hidden
            />
            <div className="panel-raised relative flex max-h-full w-full max-w-sm flex-col overflow-y-auto p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="eyebrow">Chart-Aussehen</p>
                  <p className="note mt-1">
                    Gilt in jedem Chart der App — auch im Trainer. Änderungen sind sofort
                    zu sehen.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 shrink-0 p-0"
                  onClick={abbrechen}
                  aria-label="Schließen"
                >
                  <X className="size-4" />
                </Button>
              </div>

              <p className="eyebrow mb-1.5">Vorlage</p>
              <div className="mb-4 flex flex-wrap gap-1.5">
                {APPEARANCE_PRESETS.map((p) => (
                  <Button
                    key={p.id}
                    size="sm"
                    variant={aktivesPreset === p.id ? 'secondary' : 'outline'}
                    className="h-7 px-2 font-mono text-[11px]"
                    title={p.hint}
                    onClick={() => onChange(p.values)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>

              <p className="eyebrow mb-1.5">Farben</p>
              <div className="flex flex-col gap-1.5">
                {FELDER.map((f) => {
                  const wert = value[f.key] as string
                  const hex = alsHex(wert)
                  return (
                    <label key={f.key} className="flex items-center gap-2">
                      <span
                        className="w-32 shrink-0 font-mono text-[11px] text-muted-foreground"
                        title={f.hint}
                      >
                        {f.label}
                      </span>
                      <input
                        type="color"
                        value={hex ?? '#000000'}
                        onChange={(e) => setzen(f.key, e.target.value)}
                        className="h-7 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent"
                        aria-label={`${f.label} — Farbwähler`}
                      />
                      <input
                        type="text"
                        value={wert}
                        onChange={(e) => setzen(f.key, e.target.value)}
                        spellCheck={false}
                        className="input-ocean h-7 min-w-0 flex-1 rounded px-2 font-mono text-[11px]"
                        aria-label={`${f.label} — Wert`}
                      />
                    </label>
                  )
                })}
              </div>

              <p className="eyebrow mb-1.5 mt-4">Darstellung</p>
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-2 font-mono text-[11px]">
                  <input
                    type="checkbox"
                    checked={value.gridVisible}
                    onChange={(e) => setzen('gridVisible', e.target.checked)}
                  />
                  Gitter anzeigen
                </label>
                <label className="flex items-center gap-2 font-mono text-[11px]">
                  <input
                    type="checkbox"
                    checked={value.hollow}
                    onChange={(e) => setzen('hollow', e.target.checked)}
                  />
                  Hohlkerzen (steigende nur als Umriss)
                </label>
              </div>

              {fehler && <p className="note mt-3 text-destructive">{fehler}</p>}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button size="sm" className="h-8 px-3" disabled={saving} onClick={speichern}>
                  Speichern
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-3"
                  disabled={saving}
                  onClick={abbrechen}
                >
                  Abbrechen
                </Button>
                <span className="grow" />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 font-mono text-[11px] text-muted-foreground"
                  disabled={saving}
                  onClick={zuruecksetzen}
                >
                  Zurücksetzen
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
