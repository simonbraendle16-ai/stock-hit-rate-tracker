// Reine Logik über das Event-Log eines Trades (Etappe 6): Teilverkäufe,
// Nachkäufe, Stop-/Ziel-Verschiebungen. Bewusst OHNE 'use server', ohne DB und
// ohne Auth — dadurch direkt testbar (`lib/trade-events.test.ts`). Die Server
// Actions in `app/actions/trades.ts` laden die Event-Zeilen und rufen nur hier
// hinein; die Geldmathematik lebt daneben in `lib/trade-stats.ts`.
//
// Leitidee der Bewertung: Ein Trade MIT Events wird vollständig aus den Events
// gerechnet (Menge, Durchschnittseinstieg, realisierter P&L, Gebühren). Ein Trade
// OHNE Events verhält sich exakt wie bisher (Row-basiert in trade-stats.ts) —
// darum bleibt der Altbestand unberührt.

import type { trade, tradeEvent } from '@/lib/db/schema'
import { directionalDiff, parseViolations } from '@/lib/trade-stats'

export type TradeRow = typeof trade.$inferSelect
export type TradeEventRow = typeof tradeEvent.$inferSelect

/** Geschlossene Liste der Ereignis-Arten — gemeinsame Quelle für Server-Gate,
 *  Settlement und Timeline. Muss mit dem CHECK in 0014_trade_events.sql übereinstimmen. */
export const TRADE_EVENT_TYPES = [
  'eroeffnet',
  'teilverkauf',
  'nachkauf',
  'stop_verschoben',
  'ziel_geaendert',
  'invalidation_ignoriert',
  'notiz',
  'geschlossen',
] as const
export type TradeEventType = (typeof TRADE_EVENT_TYPES)[number]

export function isTradeEventType(v: string): v is TradeEventType {
  return (TRADE_EVENT_TYPES as readonly string[]).includes(v)
}

/** Ereignisse, die Kapital ins Spiel bringen (Menge + Kurs tragen Bedeutung). */
const ENTRY_TYPES = new Set<TradeEventType>(['eroeffnet', 'nachkauf'])
const EXIT_TYPES = new Set<TradeEventType>(['teilverkauf', 'geschlossen'])

/** Chronologische Sortierung: nach fachlichem Zeitpunkt, bei Gleichstand nach id. */
function chronological(events: TradeEventRow[]): TradeEventRow[] {
  return [...events].sort((a, b) => {
    const ta = new Date(a.at).getTime()
    const tb = new Date(b.at).getTime()
    if (ta !== tb) return ta - tb
    return a.id - b.id
  })
}

/** Hat der Trade bereits mindestens einen echten Teilverkauf? Grundlage für die
 *  gelockerte Stop-Regel (Trailing erst nach einem Teilverkauf erlaubt). */
export function hasPartialSale(events: TradeEventRow[]): boolean {
  return events.some((e) => e.type === 'teilverkauf')
}

/**
 * Ist eine Stop-Verschiebung risiko-REDUZIEREND (Trailing in Gewinnrichtung)?
 * Long: Stop höher = näher an/über den Einstieg = weniger Risiko.
 * Short: Stop tiefer = weniger Risiko. Gleichstand ist keine Verschiebung.
 * Nur eine solche Bewegung ist nach einem Teilverkauf regelkonform; das Aufweiten
 * (Risiko rauf) bleibt immer ein Regelbruch.
 */
export function isRiskReducingStop(
  direction: string,
  oldStop: number,
  newStop: number,
): boolean {
  if (newStop === oldStop) return false
  return direction === 'short' ? newStop < oldStop : newStop > oldStop
}

export type PositionSettlement = {
  /** Noch offene Stückzahl (0 = vollständig geschlossen). */
  openQty: number
  /** Gewichteter Durchschnittseinstieg über alle Ein-/Nachkäufe. */
  avgEntry: number
  /** Insgesamt eingegangene Stückzahl (Eröffnung + Nachkäufe). */
  totalEntered: number
  /** Insgesamt verkaufte Stückzahl (Teilverkäufe + Abschluss). */
  totalExited: number
  /** Realisierter Brutto-P&L aller Ausstiege, vor Gebühren (Kontowährung). */
  realizedGross: number
  /** Summe der Ausstiegsgebühren der realisierten Teile. */
  realizedExitFees: number
  /** Summe der Einstiegsgebühren (Eröffnung + Nachkäufe). */
  entryFees: number
  /** Schon realisiert, netto Ausstiegsgebühren (OHNE Einstiegsgebühr) — „was ist bisher hereingekommen". */
  realizedNet: number
  /** Gesamt-Netto des Trades (realizedGross − Ausstiegs- − Einstiegsgebühren) — aussagekräftig bei vollständigem Abschluss. */
  totalNet: number
  /** Geplantes 1R in Kontowährung = |Einstieg − Stop| × Anfangsstückzahl. */
  plannedRiskMoney: number
  /** Realisiertes R-Vielfaches (brutto, größenanteilig) — für die Live-Anzeige des Fortschritts. */
  realizedR: number
  /** true, sobald keine Stückzahl mehr offen ist. */
  isFullyClosed: boolean
  /** Trägt der Trade überhaupt Events? (Sonst gilt der Row-basierte Altpfad.) */
  hasEvents: boolean
}

const EPS = 1e-9

/**
 * Faltet die Events eines Trades chronologisch zu Menge, Durchschnittseinstieg,
 * realisiertem P&L und R. Fehlt ein `eroeffnet`-Event (Trade vor Etappe 6
 * aktiviert), wird der Anfangszustand aus der Trade-Zeile geerbt — so lässt sich
 * auch ein vor dem Feature eröffneter Trade teilweise schließen.
 *
 * Das geplante 1R (`plannedRiskMoney`) bezieht sich bewusst auf den
 * URSPRÜNGLICHEN Plan: |Anfangseinstieg − Anfangsstop| × Anfangsstückzahl. R wird
 * beim Trade-Planen einmal definiert und wandert nicht mit einem nachgezogenen
 * Stop — genau das ist die Douglas-Lesart. Der Anfangsstop ist der `from`-Wert
 * der ersten Stop-Verschiebung, sonst der aktuelle Stop (nie verschoben).
 */
export function settlePosition(t: TradeRow, events: TradeEventRow[]): PositionSettlement {
  const withMoney = t.tradedWithMoney
  const fee = (raw: number | null | undefined) => (withMoney ? (raw ?? 0) : 0)
  const sorted = chronological(events)

  // --- Anfangszustand: aus dem eroeffnet-Event, sonst aus der Trade-Zeile ------
  const opened = sorted.find((e) => e.type === 'eroeffnet')
  const firstStopMove = sorted.find((e) => e.type === 'stop_verschoben')
  const initialStop = firstStopMove
    ? (parsePayload(firstStopMove.payload).from ?? t.stopLoss)
    : t.stopLoss
  const initialEntry = opened?.price ?? t.entryPrice
  const initialQty = opened?.quantity ?? t.positionSize ?? 0
  const plannedRiskMoney = Math.abs(initialEntry - initialStop) * initialQty

  let openQty = initialQty
  let avgEntry = initialEntry
  let totalEntered = initialQty
  let totalExited = 0
  let realizedGross = 0
  let realizedExitFees = 0
  // Ohne eroeffnet-Event trägt die Trade-Zeile die (bei Abschluss eingefrorene)
  // Einstiegsgebühr; mit Event steckt sie im Event.
  let entryFees = opened ? fee(opened.fee) : fee(t.feeEntry)

  for (const ev of sorted) {
    const q = ev.quantity ?? 0
    const price = ev.price ?? avgEntry
    if (ev.type === 'nachkauf') {
      const next = openQty + q
      if (next > EPS) avgEntry = (openQty * avgEntry + q * price) / next
      openQty = next
      totalEntered += q
      entryFees += fee(ev.fee)
    } else if (EXIT_TYPES.has(ev.type as TradeEventType)) {
      // Beim Abschluss ohne ausdrückliche Menge wird der gesamte Rest geschlossen.
      const sellQty = ev.type === 'geschlossen' && q <= 0 ? openQty : q
      const perShare = directionalDiff(price, avgEntry, t.direction)
      realizedGross += perShare * sellQty
      realizedExitFees += fee(ev.fee)
      openQty -= sellQty
      totalExited += sellQty
    }
    // 'eroeffnet' ist bereits als Anfangszustand verrechnet; Level-/Notiz-Events
    // verändern die Menge nicht.
  }

  const realizedNet = realizedGross - realizedExitFees
  const totalNet = realizedGross - realizedExitFees - entryFees
  const realizedR = plannedRiskMoney > EPS ? realizedGross / plannedRiskMoney : 0

  return {
    openQty,
    avgEntry,
    totalEntered,
    totalExited,
    realizedGross,
    realizedExitFees,
    entryFees,
    realizedNet,
    totalNet,
    plannedRiskMoney,
    realizedR,
    isFullyClosed: openQty <= EPS,
    hasEvents: events.length > 0,
  }
}

function parsePayload(raw: string | null): { from?: number; to?: number; violation?: boolean } {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export type TimelineItem = {
  type: TradeEventType
  /** Fachlicher Zeitpunkt; null = abgeleitet ohne bekannten Zeitpunkt. */
  at: Date | null
  /** true = aus Trade-Feldern rekonstruiert (Alt-Trade ohne Events), nicht aus einem echten Event. */
  derived: boolean
  /** true = markiert einen Regelbruch (⚠ in der Anzeige). */
  isViolation: boolean
  quantity: number | null
  price: number | null
  fee: number | null
  from: number | null
  to: number | null
  note: string | null
}

function itemFromEvent(ev: TradeEventRow): TimelineItem {
  const payload = parsePayload(ev.payload)
  const isViolation =
    ev.type === 'invalidation_ignoriert' ||
    (ev.type === 'stop_verschoben' && payload.violation === true)
  return {
    type: ev.type as TradeEventType,
    at: new Date(ev.at),
    derived: false,
    isViolation,
    quantity: ev.quantity ?? null,
    price: ev.price ?? null,
    fee: ev.fee ?? null,
    from: payload.from ?? null,
    to: payload.to ?? null,
    note: ev.note ?? null,
  }
}

/**
 * Lesbare Chronik eines Trades. Hat der Trade echte Events, werden diese
 * chronologisch abgebildet. Fehlt jedes Event (Alt-Trade vor Etappe 6), wird die
 * Chronik zur Anzeigezeit aus den vorhandenen Feldern ABGELEITET — Eröffnung aus
 * `openedAt`, Regelbrüche aus `ruleViolations` (ohne Zeitstempel, da unbekannt),
 * Abschluss aus `closedAt`/`result`. Es werden bewusst keine Zeitpunkte erfunden.
 */
export function deriveTimeline(t: TradeRow, events: TradeEventRow[]): TimelineItem[] {
  if (events.length > 0) {
    return chronological(events).map(itemFromEvent)
  }

  const items: TimelineItem[] = []
  const base = (over: Partial<TimelineItem>): TimelineItem => ({
    type: 'notiz',
    at: null,
    derived: true,
    isViolation: false,
    quantity: null,
    price: null,
    fee: null,
    from: null,
    to: null,
    note: null,
    ...over,
  })

  if (t.openedAt) {
    items.push(
      base({
        type: 'eroeffnet',
        at: new Date(t.openedAt),
        quantity: t.positionSize ?? null,
        price: t.entryPrice ?? null,
      }),
    )
  }

  for (const v of parseViolations(t.ruleViolations)) {
    if (v === 'stop_moved') {
      items.push(base({ type: 'stop_verschoben', isViolation: true, note: 'Stop-Loss verschoben' }))
    } else if (v === 'invalidation_ignored') {
      items.push(base({ type: 'invalidation_ignoriert', isViolation: true, note: 'Invalidation geändert' }))
    } else if (v === 'revenge') {
      items.push(base({ type: 'notiz', isViolation: true, note: 'Revenge-Trade (kurz nach Verlust eröffnet)' }))
    }
  }

  if (t.closedAt && (t.status === 'abgeschlossen' || t.status === 'abgebrochen')) {
    items.push(
      base({
        type: 'geschlossen',
        at: new Date(t.closedAt),
        price: t.actualExitPrice ?? null,
        note:
          t.status === 'abgebrochen'
            ? 'Abgebrochen'
            : t.result
              ? `Geschlossen (${t.result})`
              : 'Geschlossen',
      }),
    )
  }

  return items
}
