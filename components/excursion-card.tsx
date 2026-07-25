'use client'

// Gegenlauf und Mitlauf eines einzelnen Trades auf `/trades/[id]` (Etappe 7c).
//
// Hier steht die Zahl, die man beim Nachbesprechen eines Trades sucht: wie tief
// lief er gegen mich, wie weit für mich, und wo bin ich ausgestiegen. Gemessen
// wird über die Kerzen der Haltedauer (`getTradeExcursion`); die Karte zeigt
// dazu ehrlich, WOHER die Zahl kommt — gemessene Auflösung, grob gemessen oder
// von Hand nachgetragen.
//
// Der Nachtrag ändert nichts am Plan und keine Geldkennzahl: er trägt nur nach,
// was der Chart ohnehin zeigt, wenn der Kursanbieter nichts liefert. Deshalb ist
// er auch bei abgeschlossenen Trades erlaubt (wie das Setup-Tag in 7b).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ExcursionEntry } from '@/lib/excursion'
import { SKIP_LABELS } from '@/lib/bot-twin'
import { clearTradeExcursion, setTradeExcursion } from '@/app/actions/excursion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Ruler } from 'lucide-react'
import { toast } from 'sonner'

const rMultiple = (v: number) =>
  `${v >= 0 ? '+' : '−'}${Math.abs(v).toLocaleString('de-DE', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} R`

const price = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 4 })

export function ExcursionCard({ entry }: { entry: ExcursionEntry }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [worst, setWorst] = useState(
    entry.manual?.worstPrice != null ? String(entry.manual.worstPrice) : '',
  )
  const [best, setBest] = useState(
    entry.manual?.bestPrice != null ? String(entry.manual.bestPrice) : '',
  )
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await setTradeExcursion(entry.tradeId, {
        worstPrice: worst.trim() ? Number(worst.replace(',', '.')) : null,
        bestPrice: best.trim() ? Number(best.replace(',', '.')) : null,
      })
      toast.success('Nachgetragen.')
      setOpen(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fehler')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await clearTradeExcursion(entry.tradeId)
      toast.success('Nachtrag entfernt — es zählt wieder die Messung.')
      setWorst('')
      setBest('')
      setOpen(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fehler')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel sheen p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Ruler className="size-4 text-primary" />
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-primary/70">
            Gegenlauf &amp; Mitlauf
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={() => setOpen((v) => !v)}
          className="h-auto px-2 py-1 font-mono text-[10px] text-muted-foreground"
        >
          {open ? 'Schließen' : entry.source === 'nachgetragen' ? 'Nachtrag ändern' : 'Nachtragen'}
        </Button>
      </div>

      {entry.run.measured ? (
        <>
          <p className="mt-2 font-mono text-sm leading-relaxed text-foreground">
            Dieser Trade lief bis{' '}
            <strong className="text-destructive">{rMultiple(entry.run.maeR)}</strong> gegen dich
            (Kurs {price(entry.run.worstPrice)}) und bis{' '}
            <strong className="text-positive">{rMultiple(entry.run.mfeR)}</strong> für dich (Kurs{' '}
            {price(entry.run.bestPrice)}). Ausgestiegen bist du bei{' '}
            <strong className={entry.realR >= 0 ? 'text-positive' : 'text-destructive'}>
              {rMultiple(entry.realR)}
            </strong>
            .
          </p>
          <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
            {entry.source === 'nachgetragen'
              ? 'Von Hand nachgetragen — sobald belastbare Kerzen vorliegen, gilt wieder die Messung.'
              : `Gemessen aus ${entry.resolution ?? 'Kerzen'} zwischen Einstieg und Ausstieg.`}
            {entry.run.coarse && entry.source !== 'nachgetragen' && (
              <>
                {' '}
                <strong className="text-warning">Grob:</strong> die Kerze ist länger als die
                Haltedauer — das Extrem kann aus Zeit stammen, in der die Position noch gar nicht
                offen war. Der echte Wert lässt sich hier nachtragen.
              </>
            )}
          </p>
        </>
      ) : (
        <p className="mt-2 font-mono text-xs leading-relaxed text-muted-foreground">
          Nicht messbar: {SKIP_LABELS[entry.run.reason]}. Beim Minutenlimit hilft ein späterer
          Aufruf; sonst lässt sich der Extremkurs hier von Hand nachtragen.
        </p>
      )}

      {open && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
            Eingetragen werden <strong>Kurse</strong>, wie du sie am Chart abliest — das
            R-Vielfache rechnet die App daraus. Eine Seite darf leer bleiben; sie gilt dann als
            „nicht über den Einstieg hinaus gelaufen".
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="worst" className="font-mono text-[10px]">
                Tiefster Punkt gegen dich
              </Label>
              <Input
                id="worst"
                inputMode="decimal"
                value={worst}
                onChange={(e) => setWorst(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="best" className="font-mono text-[10px]">
                Höchster Punkt für dich
              </Label>
              <Input
                id="best"
                inputMode="decimal"
                value={best}
                onChange={(e) => setBest(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            {entry.manual && (
              <Button
                variant="ghost"
                onClick={remove}
                disabled={busy}
                className="font-mono text-xs"
              >
                Nachtrag entfernen
              </Button>
            )}
            <Button onClick={save} disabled={busy} className="font-mono text-xs">
              Speichern
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
