'use client'

// Der Abschluss-Dialog eines Trades — eigene Datei seit der Live-Leiste.
//
// Er stand vorher unten in `trade-card.tsx`. Dort konnte ihn die Leiste
// (`live-position.tsx`) nicht benutzen: Die Karte importiert die Leiste, ein
// Rückimport wäre ein Zyklus gewesen. Verschoben, nicht verändert — `trade-card`
// reicht ihn weiter, damit bestehende Importe unberührt bleiben.

import { useEffect, useState } from 'react'
import { closeTrade } from '@/app/actions/trades'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Banknote, FlaskConical } from 'lucide-react'
import { requiresMoodCheck } from '@/lib/trade-kind'
import {
  MoodBadge,
  MoodCheck,
  emptyMoodDraft,
  isMoodDraftComplete,
  type MoodDraft,
} from '@/components/mood-check'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { DEFAULT_ORDER_FEE } from '@/lib/trade-math'
import type { TradeRow } from '@/lib/trade-stats'

/**
 * Der vollständige Ausstieg — hier hängen die Douglas-Guards dran (bewusste
 * Verlustannahme, Plan-Treue, Emotions-Check-in). Deshalb läuft auch die letzte
 * Teilziel-Stufe (Etappe 13) hier durch und nicht über `executeTarget`: Sie
 * schließt die Position, und ein vollständiger Ausstieg soll nie an den Guards
 * vorbeigehen, nur weil er geplant war. Exportiert, damit die Teilziel-Karte
 * denselben Dialog benutzt statt eines zweiten daneben.
 */
export function CloseDialog({
  trade,
  open,
  onOpenChange,
  onDone,
  // Vorbelegter Ausstiegskurs und die Stufe, die damit abgetragen wird.
  prefillExit = null,
  targetId = null,
}: {
  trade: TradeRow
  open: boolean
  onOpenChange: (v: boolean) => void
  onDone: () => void
  prefillExit?: number | null
  targetId?: number | null
}) {
  const [result, setResult] = useState<'gewinn' | 'verlust' | 'breakeven'>('gewinn')
  const [exit, setExit] = useState('')
  const [followed, setFollowed] = useState(true)
  const [accepted, setAccepted] = useState(false)
  // Nur noch zum Anzeigen und zum Ein-/Ausblenden der Gebührenfelder — die
  // Handelsart ist seit Etappe 12 nicht mehr im Abschluss-Dialog änderbar.
  const money = trade.tradedWithMoney
  const [feeEntry, setFeeEntry] = useState(String(trade.feeEntry ?? DEFAULT_ORDER_FEE))
  const [feeExit, setFeeExit] = useState(String(trade.feeExit ?? DEFAULT_ORDER_FEE))
  const [mood, setMood] = useState<MoodDraft>(emptyMoodDraft)
  const [busy, setBusy] = useState(false)

  // Der Check-in gehört in den Moment des Abschließens, nicht in einen alten
  // Entwurf aus einem vorher geöffneten und wieder geschlossenen Dialog.
  useEffect(() => {
    if (open) {
      setMood(emptyMoodDraft())
      // Kommt der Abschluss aus einer geplanten Stufe, steht deren Kurs schon
      // im Feld — überschreibbar, denn der tatsächliche Fill zählt.
      if (prefillExit != null) setExit(String(prefillExit))
    }
  }, [open, prefillExit])

  const submit = async () => {
    if (result === 'verlust' && !accepted) {
      toast.error('Bitte den Verlust bewusst akzeptieren.')
      return
    }
    // Ohne Ausstiegskurs kein berechenbares Ergebnis — der Server lehnt es
    // ebenfalls ab, hier nur früher und freundlicher.
    if (result !== 'breakeven' && !exit.trim()) {
      toast.error('Bitte den tatsächlichen Ausstiegskurs eintragen.')
      return
    }
    // Freiwillig beim schnellen Trade — Ausstiegskurs und Verlustannahme oben
    // gelten dagegen in beiden Wegen.
    if (requiresMoodCheck(trade.tradeKind) && !isMoodDraftComplete(mood)) {
      toast.error('Bitte auf der Skala eintragen, wie du aus dem Trade gehst.')
      return
    }
    setBusy(true)
    try {
      await closeTrade(trade.id, {
        result,
        actualExitPrice: exit ? parseFloat(exit) : null,
        followedPlan: followed,
        lossAccepted: accepted,
        // Die Handelsart wird beim Abschließen NICHT mehr mitgeschickt (Etappe 12):
        // Sie gehört zum Depot. Ein Umschalter hier hätte den Trade nach dem
        // Abrechnen in die andere Bilanz springen lassen, ohne dass es irgendwo
        // sichtbar war. Umbuchen geht über das Depot (`moveTrade`).
        feeEntry: feeEntry.trim() === '' ? null : parseFloat(feeEntry),
        feeExit: feeExit.trim() === '' ? null : parseFloat(feeExit),
        mood,
        // Trägt die Stufe ab, aus der der Abschluss ausgelöst wurde (Etappe 13).
        targetId,
      })
      toast.success('Trade abgeschlossen.')
      onOpenChange(false)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fehler')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading tracking-wide">
            {trade.ticker} abschließen
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            Erfasse Ergebnis und ob du deinen Plan befolgt hast.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Ergebnis
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {(['gewinn', 'verlust', 'breakeven'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setResult(r)}
                  className={cn(
                    'rounded-lg border py-2 font-mono text-xs uppercase transition-all',
                    result === r
                      ? r === 'gewinn'
                        ? 'border-positive/40 bg-positive/15 text-positive'
                        : r === 'verlust'
                          ? 'border-destructive/40 bg-destructive/15 text-destructive'
                          : 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Ausstiegskurs {result !== 'breakeven' && <span className="text-destructive">*</span>}
            </Label>
            <Input
              type="number"
              step="any"
              value={exit}
              onChange={(e) => setExit(e.target.value)}
              placeholder="0.00"
              className="input-ocean font-mono"
              required={result !== 'breakeven'}
            />
            <p className="font-mono text-[10px] text-muted-foreground">
              {result === 'breakeven'
                ? 'Bei Breakeven optional — das Ergebnis ist ohnehin null.'
                : 'Zu welchem Kurs bist du tatsächlich ausgestiegen? Ohne ihn lässt sich dein Ergebnis nicht berechnen.'}
            </p>
          </div>

          {/* Gebühren letztmalig korrigierbar — danach sind sie eingefroren und
              keine spätere Einstellungsänderung verschiebt diesen Trade mehr. */}
          {money && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Gebühr Kauf
                </Label>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  value={feeEntry}
                  onChange={(e) => setFeeEntry(e.target.value)}
                  className="input-ocean font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Gebühr Verkauf
                </Label>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  value={feeExit}
                  onChange={(e) => setFeeExit(e.target.value)}
                  className="input-ocean font-mono"
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Plan befolgt?
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFollowed(true)}
                className={cn(
                  'rounded-lg border py-2 font-mono text-xs uppercase',
                  followed
                    ? 'border-positive/40 bg-positive/15 text-positive'
                    : 'border-border text-muted-foreground',
                )}
              >
                Ja, diszipliniert
              </button>
              <button
                type="button"
                onClick={() => setFollowed(false)}
                className={cn(
                  'rounded-lg border py-2 font-mono text-xs uppercase',
                  !followed
                    ? 'border-destructive/40 bg-destructive/15 text-destructive'
                    : 'border-border text-muted-foreground',
                )}
              >
                Nein, abgewichen
              </button>
            </div>
          </div>

          {/* Die Handelsart ist hier eine ANZEIGE, keine Wahl (Etappe 12).
              Vorher standen an dieser Stelle zwei Knöpfe — damit ließ sich ein
              Trade beim Abrechnen von echt auf Demo umstellen und verschwand
              stillschweigend aus der Bilanz. Sie gehört zum Depot; ändern geht
              nur durch Umbuchen, und das zeigt seine Folgen an. */}
          <div className="space-y-2">
            <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Handelsart
            </Label>
            <div
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-3 py-2 font-mono text-xs uppercase',
                money
                  ? 'border-positive/40 bg-positive/10 text-positive'
                  : 'border-[color-mix(in_oklab,var(--warning)_40%,transparent)] bg-[color-mix(in_oklab,var(--warning)_10%,transparent)] text-[var(--warning)]',
              )}
            >
              {money ? (
                <>
                  <Banknote className="size-3" /> Echtgeld
                </>
              ) : (
                <>
                  <FlaskConical className="size-3" /> Papiergeld
                </>
              )}
            </div>
            <p className="note">
              Ergibt sich aus dem Depot des Trades. Zum Ändern den Trade umbuchen.
            </p>
          </div>

          {result === 'verlust' && (
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mt-0.5 accent-[var(--primary)]"
              />
              <span className="font-mono text-[11px] text-foreground">
                „Meine Zählung war für diesen Trade falsch. Der nächste Trade zählt." — Ich
                akzeptiere den Verlust vollständig.
              </span>
            </label>
          )}

          {/* Zweite Momentaufnahme. Der Zustand beim Einstieg steht daneben —
              erst der Vergleich zeigt, was der Trade mit dir gemacht hat. */}
          <div className="space-y-2">
            {trade.moodEntry != null && (
              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                <span className="uppercase tracking-widest">Beim Einstieg:</span>
                <MoodBadge score={trade.moodEntry} tags={trade.moodEntryTags} phase="entry" />
              </div>
            )}
            <MoodCheck value={mood} onChange={setMood} phase="exit" disabled={busy} />
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={
              busy || (requiresMoodCheck(trade.tradeKind) && !isMoodDraftComplete(mood))
            }
            className="btn-teal-glow w-full font-mono text-sm font-bold tracking-wider sm:w-auto"
          >
            {busy ? 'WIRD GESPEICHERT…' : 'ABSCHLIESSEN'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
