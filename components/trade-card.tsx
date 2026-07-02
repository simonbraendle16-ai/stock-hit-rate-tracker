'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { TradeRow } from '@/app/actions/trades'
import {
  activateTrade,
  abortTrade,
  closeTrade,
  deleteTrade,
  markNoTrade,
} from '@/app/actions/trades'
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
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  FlaskConical,
  Lock,
  Pencil,
  Play,
  Target,
  Trash2,
  Waves,
  X,
} from 'lucide-react'
import { EditTradeDialog } from '@/components/edit-trade-dialog'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  ROUND_TRIP_FEE_EUR,
  projectStopLoss,
  projectTakeProfit,
} from '@/lib/trade-math'

const eur = (n: number) =>
  n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
const num = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 4 })

const statusStyle: Record<string, string> = {
  geplant: 'border-warning/40 bg-warning/10 text-warning',
  aktiv: 'border-primary/40 bg-primary/10 text-primary',
  abgeschlossen: 'border-positive/40 bg-positive/10 text-positive',
  abgebrochen: 'border-border bg-muted/30 text-muted-foreground',
  kein_handel: 'border-warning/30 bg-muted/30 text-warning/80',
}

const statusLabel: Record<string, string> = {
  kein_handel: 'kein Handel',
}

const resultStyle: Record<string, string> = {
  gewinn: 'text-positive',
  verlust: 'text-destructive',
  breakeven: 'text-muted-foreground',
}

export function TradeCard({ t }: { t: TradeRow }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  const [noTradeOpen, setNoTradeOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(ok)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fehler')
    } finally {
      setBusy(false)
    }
  }

  // Nach dem Löschen auf die Liste navigieren — sonst lädt eine offene
  // Detailseite (/trades/[id]) den geloeschten Trade neu und stürzt via notFound() ab.
  const handleDelete = async () => {
    if (!confirm(`Trade „${t.ticker}“ endgültig löschen?`)) return
    setBusy(true)
    try {
      await deleteTrade(t.id)
      toast.success('Trade gelöscht.')
      router.push('/trades')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fehler')
      setBusy(false)
    }
  }

  const isLong = t.direction === 'long'

  return (
    <div className="glass-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'flex size-8 items-center justify-center rounded-lg',
              isLong ? 'bg-positive/15 text-positive' : 'bg-destructive/15 text-destructive',
            )}
          >
            {isLong ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
          </span>
          <div>
            <Link
              href={`/trades/${t.id}`}
              className="font-heading text-base font-bold tracking-wide text-foreground hover:text-primary"
            >
              {t.ticker}
            </Link>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {t.direction} · {t.market}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span
            className={cn(
              'rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest',
              statusStyle[t.status],
            )}
          >
            {statusLabel[t.status] ?? t.status}
          </span>
          <span
            className={cn(
              'flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest',
              t.tradedWithMoney
                ? 'border-positive/40 bg-positive/10 text-positive'
                : 'border-primary/40 bg-primary/10 text-primary',
            )}
          >
            {t.tradedWithMoney ? (
              <>
                <Banknote className="size-3" /> Echtgeld
              </>
            ) : (
              <>
                <FlaskConical className="size-3" /> Demo
              </>
            )}
          </span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-xs">
        <Stat label="Entry" value={t.entryPrice} />
        <Stat label="Stop" value={t.stopLoss} tone="neg" />
        <Stat label="Ziel" value={t.takeProfit} tone="pos" />
      </div>

      <MoneyPanel t={t} />

      {(t.elliottWaveCount || t.waveDegree) && (
        <div className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-primary/80">
          <Waves className="size-3" />
          {[t.waveDegree, t.elliottWaveCount].filter(Boolean).join(' · ')}
        </div>
      )}

      {t.status === 'abgeschlossen' && t.result && (
        <p className={cn('mt-2 font-mono text-xs font-bold uppercase', resultStyle[t.result])}>
          Ergebnis: {t.result}
          {t.followedPlan ? ' · Plan befolgt ✓' : ' · Plan abgewichen ✗'}
        </p>
      )}

      {t.status === 'kein_handel' && (
        <div className="mt-2 flex items-start gap-1.5 font-mono text-xs text-warning/80">
          <Target className="mt-0.5 size-3 shrink-0" />
          <span>
            Kein Handel · Zielzone nicht angelaufen
            {t.noTradeNote ? (
              <span className="mt-0.5 block text-muted-foreground">{t.noTradeNote}</span>
            ) : null}
          </span>
        </div>
      )}

      {/* Aktionen */}
      <div className="mt-4 flex flex-wrap gap-2">
        {t.status === 'geplant' && (
          <>
            <Button
              size="sm"
              disabled={busy || !t.preTradeAnswered}
              onClick={() =>
                run(async () => {
                  const { revengeWarning } = await activateTrade(t.id)
                  if (revengeWarning)
                    toast.warning('Revenge-Guard: kurz nach einem Verlust — handelst du den Plan oder die Wut?')
                }, 'Trade aktiviert.')
              }
              className="btn-teal-glow font-mono text-xs"
            >
              <Play className="size-3" /> Aktivieren
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setNoTradeOpen(true)}
              className="font-mono text-xs"
            >
              <Target className="size-3" /> Kein Handel
            </Button>
            {!t.preTradeAnswered && (
              <span className="flex items-center gap-1 font-mono text-[10px] text-warning">
                <Lock className="size-3" /> Erst die 4 Fragen
              </span>
            )}
          </>
        )}
        {t.status === 'aktiv' && (
          <>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => setCloseOpen(true)}
              className="btn-teal-glow font-mono text-xs"
            >
              Abschließen
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => run(() => abortTrade(t.id), 'Trade abgebrochen.')}
              className="font-mono text-xs"
            >
              <X className="size-3" /> Abbrechen
            </Button>
          </>
        )}
        {(t.status === 'geplant' || t.status === 'aktiv') && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setEditOpen(true)}
            className="ml-auto font-mono text-xs text-muted-foreground"
          >
            <Pencil className="size-3" /> Bearbeiten
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={handleDelete}
          className={cn(
            'font-mono text-xs text-muted-foreground',
            t.status !== 'geplant' && t.status !== 'aktiv' && 'ml-auto',
          )}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>

      <CloseDialog trade={t} open={closeOpen} onOpenChange={setCloseOpen} onDone={() => router.refresh()} />
      <NoTradeDialog trade={t} open={noTradeOpen} onOpenChange={setNoTradeOpen} onDone={() => router.refresh()} />
      <EditTradeDialog trade={t} open={editOpen} onOpenChange={setEditOpen} onDone={() => router.refresh()} />
    </div>
  )
}

function MoneyPanel({ t }: { t: TradeRow }) {
  if (!t.tradedWithMoney || t.investedAmount == null) return null

  const invested = t.investedAmount
  const shares = t.positionSize ?? null
  const closed = t.status === 'abgeschlossen' && !!t.result

  // Realisiertes Netto-Ergebnis (spiegelt die Server-Logik: Brutto − 18 € Gebühren).
  let realizedNet: number | null = null
  if (closed && shares != null) {
    let gross = 0
    if (t.result === 'gewinn') {
      gross =
        t.actualExitPrice != null
          ? (t.actualExitPrice - t.entryPrice) * (t.direction === 'short' ? -shares : shares)
          : t.takeProfit != null
            ? Math.abs(t.takeProfit - t.entryPrice) * shares
            : 0
    } else if (t.result === 'verlust') {
      gross =
        t.actualExitPrice != null
          ? (t.actualExitPrice - t.entryPrice) * (t.direction === 'short' ? -shares : shares)
          : -(t.stopLoss != null ? Math.abs(t.entryPrice - t.stopLoss) * shares : 0)
    }
    realizedNet = gross - ROUND_TRIP_FEE_EUR
  }

  const tp =
    !closed && t.takeProfit != null
      ? projectTakeProfit({
          invested,
          entry: t.entryPrice,
          tp: t.takeProfit,
          direction: t.direction as 'long' | 'short',
          sellPct: t.takeProfitPct ?? 100,
        })
      : null
  const sl = !closed
    ? projectStopLoss({
        invested,
        entry: t.entryPrice,
        sl: t.stopLoss,
        direction: t.direction as 'long' | 'short',
      })
    : null

  return (
    <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
      <p className="mb-2 font-mono text-[9px] font-bold uppercase tracking-widest text-primary/70">
        Kapital & Gebühren
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-xs sm:grid-cols-3">
        <MRow label="Kapitaleinsatz" value={eur(invested)} />
        {shares != null && <MRow label="Stückzahl" value={num(shares)} />}
        <MRow label="Ordergebühr" value={`${eur(ROUND_TRIP_FEE_EUR)} (Round-Trip)`} />

        {closed ? (
          realizedNet != null && (
            <MRow
              label="Netto-Ergebnis"
              value={eur(realizedNet)}
              tone={realizedNet >= 0 ? 'pos' : 'neg'}
              strong
            />
          )
        ) : (
          <>
            {tp && (
              <MRow
                label={`Netto-Gewinn (TP · ${num(t.takeProfitPct ?? 100)} %)`}
                value={eur(tp.netProfit)}
                tone={tp.netProfit >= 0 ? 'pos' : 'neg'}
                strong
              />
            )}
            {sl && (
              <MRow label="Netto-Verlust (SL)" value={eur(sl.netLoss)} tone="neg" strong />
            )}
          </>
        )}
      </dl>
    </div>
  )
}

function MRow({
  label,
  value,
  tone,
  strong,
}: {
  label: string
  value: string
  tone?: 'pos' | 'neg'
  strong?: boolean
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          strong ? 'font-bold' : 'font-medium',
          tone === 'pos' && 'text-positive',
          tone === 'neg' && 'text-destructive',
          !tone && 'text-foreground',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: number | null
  tone?: 'pos' | 'neg'
}) {
  return (
    <div className="rounded-md border border-border bg-background/40 px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p
        className={cn(
          'font-bold',
          tone === 'pos' && 'text-positive',
          tone === 'neg' && 'text-destructive',
        )}
      >
        {value != null ? value : '—'}
      </p>
    </div>
  )
}

function NoTradeDialog({
  trade,
  open,
  onOpenChange,
  onDone,
}: {
  trade: TradeRow
  open: boolean
  onOpenChange: (v: boolean) => void
  onDone: () => void
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      await markNoTrade(trade.id, note)
      toast.success('Als „kein Handel" markiert.')
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
            {trade.ticker} · kein Handel
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            Die Zielzone wurde nicht angelaufen oder war falsch gesetzt — es kam kein Trade
            zustande. Zählt nicht als Gewinn oder Verlust.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Notiz (optional)
          </Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="z. B. Kurs lief vorher in die Gegenrichtung, Zone zu eng gesetzt …"
            className="input-ocean min-h-20 font-mono text-sm"
          />
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={busy}
            className="btn-teal-glow w-full font-mono text-sm font-bold tracking-wider sm:w-auto"
          >
            {busy ? 'WIRD GESPEICHERT…' : 'KEIN HANDEL'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CloseDialog({
  trade,
  open,
  onOpenChange,
  onDone,
}: {
  trade: TradeRow
  open: boolean
  onOpenChange: (v: boolean) => void
  onDone: () => void
}) {
  const [result, setResult] = useState<'gewinn' | 'verlust' | 'breakeven'>('gewinn')
  const [exit, setExit] = useState('')
  const [followed, setFollowed] = useState(true)
  const [accepted, setAccepted] = useState(false)
  const [money, setMoney] = useState(trade.tradedWithMoney)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (result === 'verlust' && !accepted) {
      toast.error('Bitte den Verlust bewusst akzeptieren.')
      return
    }
    setBusy(true)
    try {
      await closeTrade(trade.id, {
        result,
        actualExitPrice: exit ? parseFloat(exit) : null,
        followedPlan: followed,
        lossAccepted: accepted,
        tradedWithMoney: money,
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
      <DialogContent>
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
              Ausstiegskurs
            </Label>
            <Input
              type="number"
              step="any"
              value={exit}
              onChange={(e) => setExit(e.target.value)}
              placeholder="0.00"
              className="input-ocean font-mono"
            />
          </div>

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

          <div className="space-y-2">
            <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Mit echtem Geld gehandelt?
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMoney(true)}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-lg border py-2 font-mono text-xs uppercase',
                  money
                    ? 'border-positive/40 bg-positive/15 text-positive'
                    : 'border-border text-muted-foreground',
                )}
              >
                <Banknote className="size-3" /> Echtgeld
              </button>
              <button
                type="button"
                onClick={() => setMoney(false)}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-lg border py-2 font-mono text-xs uppercase',
                  !money
                    ? 'border-primary/40 bg-primary/15 text-primary'
                    : 'border-border text-muted-foreground',
                )}
              >
                <FlaskConical className="size-3" /> Demo
              </button>
            </div>
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
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={busy}
            className="btn-teal-glow w-full font-mono text-sm font-bold tracking-wider sm:w-auto"
          >
            {busy ? 'WIRD GESPEICHERT…' : 'ABSCHLIESSEN'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
