'use client'

// Teilziele eines Trades (Etappe 13) — der Plan als Liste, und die Stelle, an
// der er ausgeführt wird.
//
// Der Ton ist bewusst nüchtern: Die Karte trifft keine Entscheidung, sie trägt
// eine ab, die schon vor dem Einstieg getroffen wurde. Deshalb steht der geplante
// Kurs im Ausführen-Dialog vorbelegt und muss nur noch mit dem tatsächlichen
// Fill abgeglichen werden.
//
// Gerechnet wird hier nichts: Reihenfolge, Anteile und Fortschritt kommen aus
// `lib/trade-targets.ts`, die offene Menge aus `settlePosition` — dieselben
// reinen Funktionen wie auf dem Server.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Flag, Target } from 'lucide-react'
import type { TradeRow } from '@/lib/trade-stats'
import type { TradeEventRow } from '@/lib/trade-events'
import { settlePosition } from '@/lib/trade-events'
import {
  effectiveTargets,
  plannedQty,
  targetProgress,
  type TradeTargetRow,
} from '@/lib/trade-targets'
import { executeTarget } from '@/app/actions/trades'
import { CloseDialog } from '@/components/trade-card'
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
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const num = (n: number, d = 4) => n.toLocaleString('de-DE', { maximumFractionDigits: d })
const pct = (n: number) => `${n.toLocaleString('de-DE', { maximumFractionDigits: 2 })} %`

export function TradeTargetsCard({
  trade,
  targets,
  events,
}: {
  trade: TradeRow
  targets: TradeTargetRow[]
  events: TradeEventRow[]
}) {
  const router = useRouter()
  const [offen, setOffen] = useState<number | null>(null)
  const [abschluss, setAbschluss] = useState<{ id: number; price: number } | null>(null)

  const stufen = useMemo(() => effectiveTargets(trade, targets), [trade, targets])
  const fortschritt = useMemo(() => targetProgress(stufen), [stufen])
  const settle = useMemo(() => settlePosition(trade, events), [trade, events])

  // Bezug der Anteile ist die Anfangsposition (siehe `basisQuantity` serverseitig).
  const basis = useMemo(() => {
    const opened = events.find((e) => e.type === 'eroeffnet')
    return opened?.quantity ?? trade.positionSize ?? 0
  }, [events, trade])

  // Ein Trade ohne eigene Stufen (Altbestand) hat nichts abzuarbeiten — sein
  // einzelnes Ziel steht schon auf der Trade-Karte. Dann bleibt die Karte weg,
  // statt eine Stufe vorzutäuschen, die niemand geplant hat.
  if (stufen.length === 0 || stufen.every((s) => s.id == null)) return null

  const aktiv = trade.status === 'aktiv'

  return (
    <div className="panel sheen p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="eyebrow flex items-center gap-1.5 text-primary/70">
          <Target className="size-3.5" /> Teilziele
        </p>
        <p className="font-mono text-[10px] text-muted-foreground">
          {fortschritt.executed} von {fortschritt.total} erreicht
          {fortschritt.remainderPct > 0 && ` · ${pct(fortschritt.remainderPct)} laufen weiter`}
        </p>
      </div>

      <ul className="mt-3 space-y-2">
        {stufen.map((s) => {
          const menge = Math.min(plannedQty(basis, s.sharePct), settle.openQty)
          const schliesstAlles = aktiv && menge >= settle.openQty - 1e-9
          const erledigt = s.executedAt != null
          const verfallen =
            !erledigt && (trade.status === 'abgeschlossen' || trade.status === 'abgebrochen')

          return (
            <li
              key={s.id ?? `implizit-${s.sortOrder}`}
              className={cn(
                'panel-sunken flex flex-wrap items-center gap-x-4 gap-y-2 p-3 font-mono text-xs',
                erledigt && 'opacity-80',
              )}
            >
              <span className="flex items-center gap-1.5 font-bold text-foreground">
                {erledigt ? (
                  <Check className="size-3.5 text-positive" />
                ) : (
                  <Flag className="size-3.5 text-muted-foreground" />
                )}
                Stufe {s.sortOrder + 1}
              </span>

              <span className="tabular text-positive">{num(s.price)}</span>
              <span className="tabular text-muted-foreground">{pct(s.sharePct)}</span>
              {basis > 0 && !erledigt && (
                <span className="tabular text-muted-foreground">
                  ≈ {num(plannedQty(basis, s.sharePct))} Stück
                </span>
              )}

              {erledigt ? (
                <span className="tabular ml-auto text-positive">
                  ausgeführt zu {s.executedPrice != null ? num(s.executedPrice) : '—'}
                  {s.executedQty != null && ` · ${num(s.executedQty)} Stück`}
                </span>
              ) : verfallen ? (
                <span className="ml-auto text-muted-foreground">nicht erreicht</span>
              ) : aktiv ? (
                <Button
                  size="sm"
                  variant={schliesstAlles ? 'outline' : 'default'}
                  onClick={() =>
                    schliesstAlles
                      ? setAbschluss({ id: s.id!, price: s.price })
                      : setOffen(s.id!)
                  }
                  className="ml-auto h-8 font-mono text-[11px]"
                >
                  {schliesstAlles ? 'Abschließen' : 'Ausführen'}
                </Button>
              ) : (
                <span className="ml-auto text-muted-foreground">wartet auf den Einstieg</span>
              )}
            </li>
          )
        })}
      </ul>

      <p className="note mt-3">
        Die Stufen standen fest, bevor die Position stand. Ausführen heißt hier: den Plan
        abtragen, nicht neu entscheiden. Die letzte Stufe schließt die Position und läuft
        deshalb über den Abschluss — dort greifen Verlust-Annahme, Plan-Treue und Check-in.
      </p>

      <ExecuteDialog
        trade={trade}
        target={stufen.find((s) => s.id === offen) ?? null}
        basis={basis}
        openQty={settle.openQty}
        open={offen != null}
        onOpenChange={(v) => !v && setOffen(null)}
        onDone={() => router.refresh()}
      />

      <CloseDialog
        trade={trade}
        open={abschluss != null}
        onOpenChange={(v) => !v && setAbschluss(null)}
        onDone={() => router.refresh()}
        prefillExit={abschluss?.price ?? null}
        targetId={abschluss?.id ?? null}
      />
    </div>
  )
}

/** Ausführen einer Stufe: der geplante Kurs steht drin, der echte Fill zählt. */
function ExecuteDialog({
  trade,
  target,
  basis,
  openQty,
  open,
  onOpenChange,
  onDone,
}: {
  trade: TradeRow
  target: { id: number | null; sortOrder: number; price: number; sharePct: number } | null
  basis: number
  openQty: number
  open: boolean
  onOpenChange: (v: boolean) => void
  onDone: () => void
}) {
  const [price, setPrice] = useState('')
  const [fee, setFee] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open && target) {
      setPrice(String(target.price))
      setFee('')
      setNote('')
    }
  }, [open, target])

  if (!target || target.id == null) return null

  const menge = Math.min(plannedQty(basis, target.sharePct), openQty)

  const submit = async () => {
    const p = parseFloat(price)
    if (!(p > 0)) {
      toast.error('Bitte den Ausführungskurs eintragen.')
      return
    }
    setBusy(true)
    try {
      const { quantity } = await executeTarget(trade.id, target.id!, {
        price: p,
        fee: fee.trim() === '' ? null : parseFloat(fee),
        note: note.trim() || null,
      })
      toast.success(`Stufe ${target.sortOrder + 1} ausgeführt — ${num(quantity)} Stück verkauft.`)
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-heading tracking-wide">
            {trade.ticker} · Stufe {target.sortOrder + 1} ausführen
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            Geplant: {pct(target.sharePct)} der Anfangsposition bei {num(target.price)} — das
            sind {num(menge)} Stück. Der Rest der Position läuft weiter.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label className="eyebrow">Ausführungskurs</Label>
          <Input
            type="number"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="input-ocean font-mono text-sm"
          />
          <p className="note">
            Vorbelegt mit dem geplanten Kurs. Weicht der tatsächliche Fill ab, zählt der
            tatsächliche — die Bilanz soll stimmen, nicht der Plan.
          </p>
        </div>

        {trade.tradedWithMoney && (
          <div className="space-y-1.5">
            <Label className="eyebrow">Gebühr (optional)</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              placeholder="0"
              className="input-ocean font-mono text-sm"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="eyebrow">Notiz (optional)</Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="z. B. Fill leicht unter dem Ziel"
            className="input-ocean min-h-16 font-mono text-sm"
          />
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={busy}
            className="btn-teal-glow w-full font-mono text-sm font-bold tracking-wider sm:w-auto"
          >
            {busy ? 'WIRD GEBUCHT…' : 'STUFE AUSFÜHREN'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
