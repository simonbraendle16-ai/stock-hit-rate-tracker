'use client'

// Teilziele planen (Etappe 13) — der Eingabeteil für mehrere Take-Profits.
//
// EIN Baustein für beide Erfassungswege: das Formular unter /trades/new und den
// Bearbeiten-Dialog. Zwei Eingaben für dieselbe Sache wären zwei Gelegenheiten,
// verschieden zu prüfen.
//
// Geprüft wird hier NICHT selbst: Reihenfolge, Profitseite, Anteile und Dubletten
// entscheidet `lib/trade-targets.ts` — dieselbe reine Funktion, die auch die
// Server-Action anwendet. Hier steht nur, was davon zu sehen ist. Der Hinweis
// erscheint deshalb schon beim Tippen und nicht erst nach dem Absenden.

import { Trash2, Plus, Target } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  MAX_TARGETS,
  blendedRiskReward,
  normalizeTargets,
  remainderPct,
  type TargetPlanInput,
} from '@/lib/trade-targets'

/** Eine Stufe im Formular — Strings, weil das Eingabefelder sind. */
export type TargetDraft = { price: string; sharePct: string }

export const emptyTargetDraft = (): TargetDraft => ({ price: '', sharePct: '' })

const num = (n: number, d = 2) => n.toLocaleString('de-DE', { maximumFractionDigits: d })

/**
 * Die ausgefüllten Stufen eines Entwurfs. Leere Zeilen fallen heraus, halb
 * ausgefüllte bleiben drin — sie sollen als Fehler sichtbar werden und nicht
 * stillschweigend verschwinden.
 */
export function parseTargetDrafts(drafts: TargetDraft[]): TargetPlanInput[] {
  return drafts
    .filter((d) => d.price.trim() !== '' || d.sharePct.trim() !== '')
    .map((d) => ({
      price: parseFloat(d.price),
      sharePct: parseFloat(d.sharePct),
    }))
}

/** Prüfergebnis für die Anzeige: Fehlertext oder der gewichtete Plan. */
export function checkTargets(args: {
  entry: number
  stopLoss: number
  direction: string
  drafts: TargetDraft[]
}): { error: string | null; targets: TargetPlanInput[]; rr: number | null; rest: number } {
  const roh = parseTargetDrafts(args.drafts)
  if (roh.length === 0) return { error: null, targets: [], rr: null, rest: 0 }
  if (!args.entry || !args.stopLoss) {
    return { error: 'Erst Einstieg und Stop eintragen — daran hängt jede Stufe.', targets: [], rr: null, rest: 0 }
  }
  try {
    const targets = normalizeTargets({
      entry: args.entry,
      stopLoss: args.stopLoss,
      direction: args.direction,
      targets: roh,
    })
    return {
      error: null,
      targets,
      rr: blendedRiskReward({ entry: args.entry, stopLoss: args.stopLoss, targets }),
      rest: remainderPct(targets),
    }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Teilziele sind nicht schlüssig.',
      targets: [],
      rr: null,
      rest: 0,
    }
  }
}

export function TargetStages({
  entry,
  stopLoss,
  direction,
  drafts,
  onChange,
  disabled = false,
  lockedCount = 0,
}: {
  entry: number
  stopLoss: number
  direction: string
  drafts: TargetDraft[]
  onChange: (next: TargetDraft[]) => void
  disabled?: boolean
  /** Bereits ausgeführte Stufen — sie stehen fest und werden hier nicht bearbeitet. */
  lockedCount?: number
}) {
  const pruefung = checkTargets({ entry, stopLoss, direction, drafts })
  const risiko = entry && stopLoss ? Math.abs(entry - stopLoss) : 0

  const setRow = (i: number, patch: Partial<TargetDraft>) => {
    onChange(drafts.map((d, k) => (k === i ? { ...d, ...patch } : d)))
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow flex items-center gap-1.5 text-primary/70">
          <Target className="size-3.5" /> Teilziele (optional)
        </p>
        {drafts.length < MAX_TARGETS && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onChange([...drafts, emptyTargetDraft()])}
            className="h-8 font-mono text-[11px]"
          >
            <Plus className="mr-1 size-3" /> Stufe hinzufügen
          </Button>
        )}
      </div>

      {drafts.length === 0 ? (
        <p className="note">
          Ohne Stufen gilt das eine Ziel oben. Wer gestaffelt aussteigt — „die halbe Position bei
          1 R, der Rest läuft" —, legt die Stufen hier fest, <strong>bevor</strong> die Position
          steht. Danach ist der Ausstieg eine Ausführung und keine Entscheidung mehr.
        </p>
      ) : (
        <div className="space-y-2">
          {drafts.map((d, i) => {
            const kurs = parseFloat(d.price)
            const stufenR = kurs && risiko ? Math.abs(kurs - entry) / risiko : null
            const fest = i < lockedCount
            return (
              <div
                key={i}
                className="panel-sunken grid grid-cols-[1fr_1fr_auto] items-end gap-2 p-2.5"
              >
                <label className="space-y-1">
                  <span className="eyebrow">
                    Stufe {i + 1} · Kurs{fest && ' (ausgeführt)'}
                  </span>
                  <Input
                    type="number"
                    step="any"
                    value={d.price}
                    disabled={disabled || fest}
                    onChange={(e) => setRow(i, { price: e.target.value })}
                    placeholder="0.00"
                    className="input-ocean h-10 font-mono"
                  />
                </label>
                <label className="space-y-1">
                  <span className="eyebrow">
                    Anteil %{stufenR != null && ` · ${num(stufenR)} R`}
                  </span>
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    max="100"
                    value={d.sharePct}
                    disabled={disabled || fest}
                    onChange={(e) => setRow(i, { sharePct: e.target.value })}
                    placeholder="50"
                    className="input-ocean h-10 font-mono"
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled || fest}
                  onClick={() => onChange(drafts.filter((_, k) => k !== i))}
                  aria-label={`Stufe ${i + 1} entfernen`}
                  className="h-10 px-2 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            )
          })}
        </div>
      )}

      {pruefung.error ? (
        <p className="font-mono text-xs text-destructive">{pruefung.error}</p>
      ) : (
        pruefung.targets.length > 0 && (
          <p className="note">
            Gewichtetes CRV{' '}
            <span className="font-bold text-foreground">
              1:{pruefung.rr != null ? num(pruefung.rr) : '—'}
            </span>{' '}
            über {pruefung.targets.length}{' '}
            {pruefung.targets.length === 1 ? 'Stufe' : 'Stufen'}
            {pruefung.rest > 0 && (
              <>
                {' '}
                · <span className="text-foreground">{num(pruefung.rest)} %</span> laufen bis zur
                letzten Stufe
              </>
            )}
            . Die Reihenfolge ordnet die App nach Abstand zum Einstieg.
          </p>
        )
      )}
    </div>
  )
}
