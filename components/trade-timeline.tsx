// Chronik eines Trades (Etappe 6): jede Veränderung als lesbarer Eintrag mit
// Zeitstempel. Bei Alt-Trades ohne Event-Log wird die Chronik aus den vorhandenen
// Feldern abgeleitet (ohne erfundene Zeitpunkte) — die Logik dafür liegt rein und
// getestet in `deriveTimeline`. Reine Anzeige, kein Client-State.

import type { TradeRow } from '@/lib/trade-stats'
import { deriveTimeline, type TimelineItem, type TradeEventRow } from '@/lib/trade-events'
import {
  AlertTriangle,
  ArrowRightLeft,
  Flag,
  Minus,
  Plus,
  ShieldAlert,
  StickyNote,
  Target,
} from 'lucide-react'

const fmtNum = (n: number | null): string =>
  n == null ? '' : n.toLocaleString('de-DE', { maximumFractionDigits: 4 })

function fmtWhen(at: Date | null): string {
  if (at == null) return 'ohne Zeitstempel'
  return new Date(at).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function iconFor(type: TimelineItem['type']) {
  switch (type) {
    case 'eroeffnet':
      return Flag
    case 'teilverkauf':
      return Minus
    case 'nachkauf':
      return Plus
    case 'stop_verschoben':
      return ArrowRightLeft
    case 'ziel_geaendert':
      return Target
    case 'invalidation_ignoriert':
      return ShieldAlert
    case 'geschlossen':
      return Flag
    default:
      return StickyNote
  }
}

/** Kurze Überschrift + Detailzeile je Ereignis. */
function describe(item: TimelineItem): { title: string; detail: string | null } {
  const qtyAt =
    item.quantity != null && item.price != null
      ? `${fmtNum(item.quantity)} Stück zu ${fmtNum(item.price)}`
      : item.price != null
        ? `zu ${fmtNum(item.price)}`
        : null
  const fromTo =
    item.from != null && item.to != null ? `${fmtNum(item.from)} → ${fmtNum(item.to)}` : null

  switch (item.type) {
    case 'eroeffnet':
      return { title: 'Eröffnet', detail: qtyAt }
    case 'teilverkauf':
      return { title: 'Teilverkauf', detail: qtyAt }
    case 'nachkauf':
      return { title: 'Nachkauf', detail: qtyAt }
    case 'stop_verschoben':
      return { title: 'Stop verschoben', detail: fromTo ?? item.note }
    case 'ziel_geaendert':
      return { title: 'Ziel geändert', detail: fromTo ?? item.note }
    case 'invalidation_ignoriert':
      return { title: 'Invalidation geändert', detail: fromTo ?? item.note }
    case 'geschlossen':
      return { title: item.note ?? 'Geschlossen', detail: item.price != null ? `zu ${fmtNum(item.price)}` : null }
    default:
      return { title: item.note ?? 'Notiz', detail: null }
  }
}

export function TradeTimeline({ trade, events }: { trade: TradeRow; events: TradeEventRow[] }) {
  const items = deriveTimeline(trade, events)
  if (items.length === 0) return null

  return (
    <div className="glass-card p-4">
      <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-primary/70">
        Chronik
      </p>
      <ol className="mt-3 space-y-3">
        {items.map((item, i) => {
          const Icon = iconFor(item.type)
          const { title, detail } = describe(item)
          return (
            <li key={i} className="flex items-start gap-3">
              <span
                className={
                  'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border ' +
                  (item.isViolation
                    ? 'border-destructive/40 bg-destructive/10 text-destructive'
                    : 'border-primary/25 bg-primary/5 text-primary/80')
                }
              >
                <Icon className="size-3" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="font-mono text-xs font-bold text-foreground">
                    {title}
                    {item.isViolation && (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 font-normal text-destructive">
                        <AlertTriangle className="inline size-3" /> Regelbruch
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {fmtWhen(item.at)}
                  </span>
                </div>
                {detail && (
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{detail}</p>
                )}
                {item.note && detail !== item.note && item.type !== 'notiz' && (
                  <p className="mt-0.5 font-mono text-[11px] italic text-muted-foreground/80">
                    {item.note}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      {items.some((i) => i.derived) && (
        <p className="mt-3 font-mono text-[10px] text-muted-foreground/70">
          Teile dieser Chronik sind aus dem Trade abgeleitet (vor dem Event-Log erfasst) — deshalb
          ohne genauen Zeitstempel.
        </p>
      )}
    </div>
  )
}
