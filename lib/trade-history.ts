import { AsyncLocalStorage } from 'node:async_hooks'
import type { TradeEventRow } from './trade-events'
import { ApiError, onlyKeys } from './assistant-api'

export type ConfirmedSource = { kind: 'user_statement'; capturedAt: string; confirmedByUser: true }
const context = new AsyncLocalStorage<{ at: Date; source: ConfirmedSource; reason?: string }>()
export const eventTime = () => new Date(context.getStore()?.at ?? Date.now())
export const eventSource = () => context.getStore()?.source ?? { kind: 'user_statement', capturedAt: new Date().toISOString(), confirmedByUser: true }
export const revisionReason = () => context.getStore()?.reason ?? 'Änderung in der App bestätigt'
export function withEventContext<T>(at: Date, source: ConfirmedSource, reason: string | undefined, callback: () => Promise<T>) {
  return context.run({ at, source, reason }, callback)
}
export function confirmedSource(raw: unknown): ConfirmedSource {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError(422, 'Bestätigte Nutzeraussage fehlt.')
  const r = raw as Record<string, unknown>
  onlyKeys(r, ['kind', 'capturedAt', 'confirmedByUser'])
  if (r.kind !== 'user_statement' || r.confirmedByUser !== true) throw new ApiError(422, 'Bestätigte Nutzeraussage fehlt.')
  return { kind: 'user_statement', capturedAt: actualTime(r.capturedAt).toISOString(), confirmedByUser: true }
}
export function actualTime(raw: unknown): Date {
  if (typeof raw !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) throw new ApiError(422, 'Zeitpunkt mit Zeitzone erforderlich.')
  const at = new Date(raw)
  if (!Number.isFinite(at.getTime()) || at.getTime() > Date.now() + 60_000) throw new ApiError(422, 'Zeitpunkt ist ungültig oder liegt in der Zukunft.')
  return at
}
export const orderedEvents = (events: readonly TradeEventRow[]) => [...events].sort((a,b) => new Date(a.at).getTime() - new Date(b.at).getTime() || a.id-b.id)
export function eventsBeforeAction(events: TradeEventRow[]): TradeEventRow[] {
  return context.getStore() ? events.filter(e => new Date(e.at).getTime() <= eventTime().getTime()) : events
}
/** Settlement is permissive for legacy display; writes must enforce the complete chronology. */
export function validateEventSequence(events: readonly TradeEventRow[]): void {
  let qty = 0, opened = false, closed = false
  for (const e of orderedEvents(events)) {
    if (!['eroeffnet','nachkauf','teilverkauf','geschlossen'].includes(e.type)) continue
    if (closed) throw new ApiError(409, 'Ausführung nach einem vollständigen Abschluss. Spätere Ereignisse zuerst klären.')
    if (!(typeof e.quantity === 'number' && Number.isFinite(e.quantity) && e.quantity > 0) ||
        !(typeof e.price === 'number' && Number.isFinite(e.price) && e.price > 0)) throw new ApiError(409, 'Historische Ausführungsmenge oder Kurs fehlt. Vor der Änderung klären.')
    if (e.type === 'eroeffnet') {
      if (opened) throw new ApiError(409, 'Mehrere Eröffnungen widersprechen sich.')
      opened = true; qty = e.quantity
    } else {
      if (!opened) throw new ApiError(409, 'Ausführung liegt vor der dokumentierten Eröffnung.')
      if (e.type === 'nachkauf') qty += e.quantity
      else {
        if (e.quantity > qty + 1e-8) throw new ApiError(409, 'Ausführung würde einen negativen Bestand erzeugen. Spätere Ereignisse prüfen.')
        qty -= e.quantity
        if (e.type === 'geschlossen') {
          if (Math.abs(qty) > 1e-8) throw new ApiError(409, 'Der Abschluss würde eine Restposition lassen. Abschlussmenge klären.')
          closed = true
        } else if (qty <= 1e-8) throw new ApiError(409, 'Der Teilverkauf schließt vollständig. Als Abschluss erfassen.')
      }
    }
  }
}
export function payloadObject(raw: string | null): Record<string, unknown> {
  try { const v = JSON.parse(raw ?? '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : { priorPayload: raw } }
  catch { return { priorPayload: raw } }
}
export function eventFacts(e: TradeEventRow) {
  return { at: new Date(e.at).toISOString(), quantity: e.quantity, price: e.price, fee: e.fee, note: e.note }
}
