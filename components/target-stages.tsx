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
  MAX_TEILZIELE,
  blendedRiskReward,
  buildTargetPlan,
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

/**
 * Prüfergebnis für die Anzeige: Fehlertext oder der vollständige Plan.
 *
 * Rechnet über **dieselbe** Funktion wie der Server (`buildTargetPlan`), damit
 * der Hinweis schon beim Tippen erscheint und nicht erst nach dem Absenden —
 * und damit beide dieselbe Antwort geben. Das Kursziel ist Teil des Plans, auch
 * wenn es oben im Formular steht: Es ist die äußerste Stufe, und der nicht
 * verteilte Rest der Position gehört ihm.
 */
export function checkTargets(args: {
  entry: number
  stopLoss: number
  direction: string
  /** Das Kursziel aus dem Hauptformular — Pflicht, und die letzte Stufe. */
  kursziel: number
  drafts: TargetDraft[]
}): { error: string | null; targets: TargetPlanInput[]; rr: number | null; rest: number } {
  const roh = parseTargetDrafts(args.drafts)
  const leer = { error: null, targets: [] as TargetPlanInput[], rr: null, rest: 0 }
  if (!args.entry || !args.stopLoss || !args.kursziel) {
    if (roh.length === 0) return leer
    return {
      ...leer,
      error: 'Erst Einstieg, Stop und Kursziel eintragen — daran hängt jede Stufe.',
    }
  }
  try {
    const targets = buildTargetPlan({
      entry: args.entry,
      stopLoss: args.stopLoss,
      direction: args.direction,
      kursziel: args.kursziel,
      teilziele: roh,
    })
    return {
      error: null,
      targets,
      rr: blendedRiskReward({ entry: args.entry, stopLoss: args.stopLoss, targets }),
      // Nach dem Umbau bleibt hier nie etwas übrig — der Rest ist im Kursziel.
      // Die Zahl steht trotzdem, weil `targetProgress` sie weiterhin führt.
      rest: remainderPct(targets),
    }
  } catch (err) {
    return {
      ...leer,
      error: err instanceof Error ? err.message : 'Teilziele sind nicht schlüssig.',
    }
  }
}

export function TargetStages({
  entry,
  stopLoss,
  direction,
  kursziel,
  drafts,
  onChange,
  disabled = false,
  lockedCount = 0,
}: {
  entry: number
  stopLoss: number
  direction: string
  /** Das Kursziel aus dem Hauptformular — die äußerste Stufe. */
  kursziel: number
  drafts: TargetDraft[]
  onChange: (next: TargetDraft[]) => void
  disabled?: boolean
  /** Bereits ausgeführte Stufen — sie stehen fest und werden hier nicht bearbeitet. */
  lockedCount?: number
}) {
  const pruefung = checkTargets({ entry, stopLoss, direction, kursziel, drafts })
  const risiko = entry && stopLoss ? Math.abs(entry - stopLoss) : 0
  const zielR = kursziel && risiko ? Math.abs(kursziel - entry) / risiko : null
  /** Was nach den Teilzielen für das Kursziel übrig bleibt. */
  const zielAnteil =
    pruefung.targets.length > 0
      ? pruefung.targets[pruefung.targets.length - 1].sharePct
      : 100

  const setRow = (i: number, patch: Partial<TargetDraft>) => {
    onChange(drafts.map((d, k) => (k === i ? { ...d, ...patch } : d)))
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow flex items-center gap-1.5 text-primary/70">
          <Target className="size-3.5" /> Teilziele (optional)
        </p>
        {/* `MAX_TEILZIELE`, nicht `MAX_TARGETS`: Das Kursziel belegt die letzte
            Stufe. Stand hier die Gesamtzahl, bot das Formular eine Stufe an,
            die der Server danach ablehnte. */}
        {drafts.length < MAX_TEILZIELE && (
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
          Ohne Teilziele geht die ganze Position auf einmal ins Kursziel. Wer gestaffelt
          aussteigt — „die halbe Position bei 1 R, der Rest läuft bis zum Ziel" —, legt die
          Stufen hier fest, <strong>bevor</strong> die Position steht. Danach ist der Ausstieg
          eine Ausführung und keine Entscheidung mehr.
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

      {/* Das Kursziel als LETZTE Stufe — nicht eingebbar (es steht oben im
          Formular), aber sichtbar. Ohne diese Zeile sähe man drei Teilziele mit
          zusammen 75 % und müsste raten, wohin der Rest läuft; genau diese
          Lücke war der Grund für den Umbau. */}
      {kursziel > 0 && drafts.length > 0 && !pruefung.error && (
        <div className="panel-sunken grid grid-cols-[1fr_1fr_auto] items-end gap-2 border border-primary/25 p-2.5">
          <div className="space-y-1">
            <span className="eyebrow text-primary/70">
              Kursziel{zielR != null && ` · ${num(zielR)} R`}
            </span>
            <p className="font-mono text-sm font-semibold">{num(kursziel, 6)}</p>
          </div>
          <div className="space-y-1">
            <span className="eyebrow">Anteil %</span>
            <p className="font-mono text-sm font-semibold">{num(zielAnteil)}</p>
          </div>
          <span className="pb-1 pr-1 font-mono text-[10px] text-muted-foreground">
            Rest läuft hierher
          </span>
        </div>
      )}

      {pruefung.error ? (
        <p className="font-mono text-xs text-destructive">{pruefung.error}</p>
      ) : (
        pruefung.targets.length > 1 && (
          <p className="note">
            Gewichtetes CRV{' '}
            <span className="font-bold text-foreground">
              1:{pruefung.rr != null ? num(pruefung.rr) : '—'}
            </span>{' '}
            über {pruefung.targets.length} Stufen, zusammen 100 % der Position. Die Reihenfolge
            ordnet die App nach Abstand zum Einstieg; das Kursziel bleibt die letzte.
          </p>
        )
      )}
    </div>
  )
}
