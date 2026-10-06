import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { db } from './db'
import { trade, tradeActionRequest, tradeEvent, tradeEventRevision, tradeSettlementReceipt, tradeTarget } from './db/schema'
import { ApiError, hashToken, onlyKeys, positiveId } from './assistant-api'
import { canonicalBody } from './assistant-trade-input'
import { normalizePlanPatch } from './assistant-trade-patch'
import { actualTime, confirmedSource, eventFacts, payloadObject, withEventContext } from './trade-history'
import { withTradeLock } from './trade-lock'
import { activateTradeForUser, updateTradePlanForUser, addToPositionForUser, partialCloseForUser, executeTargetForUser, closeTradeForUser } from './trade-position-service'
import { projectPosition } from './trade-projection'
import { normalizeMoodCheck, serializeMoodTags, type MoodCheckInput } from './emotions'
import { requiresMoodCheck } from './trade-kind'
import { serializeSetupTags } from './setups'
export { pendingReview } from './trade-review-state'

export function publicTrade(row: typeof trade.$inferSelect) {
  const { userId: _u, externalRequestKey: _k, externalRequestHash: _h, ...result } = row
  return result
}
function positive(raw: unknown, label: string) {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) throw new ApiError(422, `${label} muss größer als null sein.`)
  return raw
}
function optionalFee(raw: unknown): number | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) throw new ApiError(422, 'Gebühr muss eine nicht negative Zahl in der Kontowährung sein.')
  return raw
}
function optionalNote(raw: unknown): string | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'string' || raw.length > 8000) throw new ApiError(422, 'Notiz ist ungültig.')
  return raw.trim()
}
/** Preserve the published metadata PATCH without inventing a user confirmation. */
export async function patchPlannedTrade(userId: string, id: number, row: typeof trade.$inferSelect, body: Record<string, unknown>) {
  if (row.status !== 'geplant') throw new ApiError(422, 'Nur geplante Trades können über diese Route geändert werden.')
  const { source, at, reason, ...fields } = body
  const patch = normalizePlanPatch(fields)
  const metadataOnly = Object.keys(fields).every(key => ['notes', 'strategy', 'setupTags'].includes(key))
  if (metadataOnly && source === undefined && at === undefined && reason === undefined) {
    const values: Partial<typeof trade.$inferInsert> = {
      ...('notes' in patch ? { notes: patch.notes } : {}),
      ...('strategy' in patch ? { strategy: patch.strategy } : {}),
      ...('setupTags' in patch ? { setupTags: serializeSetupTags(patch.setupTags!) } : {}),
    }
    const [saved] = await db.update(trade).set(values).where(and(eq(trade.id, id), eq(trade.userId, userId))).returning()
    const metadata = (t: typeof trade.$inferSelect) => ({ notes: t.notes, strategy: t.strategy, setupTags: t.setupTags })
    await db.insert(tradeEvent).values({ userId, tradeId: id, type: 'notiz',
      note: 'Metadaten aktualisiert; vorherige Fassung erhalten',
      payload: JSON.stringify({ source: { kind: 'assistant_interpretation' }, before: metadata(row), after: metadata(saved) }) })
    return publicTrade(saved)
  }
  return performTradeAction(userId, id, row, { action: 'management', source,
    at: at ?? (source as { capturedAt?: string } | undefined)?.capturedAt,
    reason: reason ?? 'Planangaben ergänzt', patch })
}
export async function mutateTrade(userId: string, id: number, version: number, key: string, route: string,
  body: Record<string, unknown>, callback: (row: typeof trade.$inferSelect) => Promise<unknown>) {
  const hash = hashToken(canonicalBody({ route, id, body }))
  try {
    return await withTradeLock(userId, id, async row => {
      const [old] = await db.select().from(tradeActionRequest).where(and(eq(tradeActionRequest.userId, userId), eq(tradeActionRequest.requestKey, key)))
      if (old) {
        if (old.requestHash !== hash || old.tradeId !== id) throw new ApiError(409, 'Idempotenzschlüssel wurde mit anderen Angaben verwendet.')
        return old.response
      }
      if (row.version !== version) throw new ApiError(409, 'Trade wurde inzwischen geändert. Aktuellen Stand lesen.')
      const result = await callback(row)
      await db.insert(tradeActionRequest).values({ userId, tradeId: id, requestKey: key, requestHash: hash, response: result })
      return result
    })
  } catch (e) {
    if (e instanceof ApiError) throw e
    if (e instanceof Error && e.message === 'Diesen Trade gibt es nicht.') throw new ApiError(404, 'Trade nicht gefunden.')
    if (e instanceof Error && !('code' in e) && !('cause' in e)) throw new ApiError(422, e.message)
    // A simultaneous reuse across trades can hit the global owner/key index.
    if (e && typeof e === 'object' && ('code' in e && e.code === '23505' || 'cause' in e && (e.cause as { code?: string })?.code === '23505')) throw new ApiError(409, 'Idempotenzschlüssel bereits verwendet. Ursprünglichen Aufruf wiederholen.')
    throw e
  }
}
export async function performTradeAction(userId: string, id: number, row: typeof trade.$inferSelect, body: Record<string, unknown>) {
  onlyKeys(body, ['action','at','source','reason','patch','assessment','quantity','price','fee','note','targetId','mood'])
  const source = confirmedSource(body.source), at = actualTime(body.at)
  if (at > new Date(source.capturedAt)) throw new ApiError(422, 'Handlung liegt nach ihrer Beobachtung. Zeitpunkte klären.')
  const events = await db.select().from(tradeEvent).where(and(eq(tradeEvent.tradeId, id), eq(tradeEvent.userId, userId))).orderBy(asc(tradeEvent.at), asc(tradeEvent.id))
  const action = body.action
  if (!['activate','management','add','partialClose','executeTarget','close'].includes(String(action))) throw new ApiError(422, 'Unbekannte Aktion.')
  const fields: Record<string, string[]> = {
    activate: ['price','quantity','fee','mood'], management: ['patch','assessment','reason'],
    add: ['price','quantity','fee','note'], partialClose: ['price','quantity','fee','note'],
    executeTarget: ['price','quantity','targetId','fee','note'], close: ['price','quantity','targetId','fee','note'],
  }
  onlyKeys(body, ['action','at','source', ...fields[String(action)]])
  const reason = optionalNote(body.reason)
  if (action === 'management' && !reason) throw new ApiError(422, 'Änderungsgrund erforderlich.')
  if (action === 'management' && events.some(e => e.at > at)) throw new ApiError(409, 'Spätere Ereignisse vorhanden. Rückdatierte Managementänderung zuerst klären.')
  const eventType = action==='activate'?'eroeffnet':action==='add'?'nachkauf':action==='close'?'geschlossen':'teilverkauf'
  if (action !== 'management' && events.some(e => { const p = payloadObject(e.payload); return (p.source === 'broker' || p.auto === true) &&
    e.type===eventType && e.price===body.price && e.quantity===body.quantity && Math.abs(e.at.getTime()-at.getTime())<1000 })) {
    throw new ApiError(409, 'Broker- oder Demo-Ausführungen vorhanden. Über den zugehörigen Belegweg erfassen, damit keine Doppelbuchung entsteht.')
  }
  if (action !== 'activate' && action !== 'management' && !events.some(e => e.type === 'eroeffnet') && !row.openedAt) {
    throw new ApiError(409, 'Historischer Eröffnungszeitpunkt fehlt. Vor der Ausführung klären.')
  }
  await withEventContext(at, source, reason, async () => {
    if (action === 'management') {
      if (!body.patch || typeof body.patch !== 'object' || Array.isArray(body.patch)) throw new ApiError(422, 'Planänderungen fehlen.')
      const patch = normalizePlanPatch(body.patch as Record<string, unknown>, row.status === 'aktiv')
      const review = normalizeManagementAssessment(body.assessment)
      await updateTradePlanForUser(userId, id, patch, false, review, row.version)
    } else {
      const price = positive(body.price, 'Ausführungskurs'), fee = optionalFee(body.fee), note = optionalNote(body.note)
      if (action === 'activate') {
        const quantity = positive(body.quantity, 'Ausführungsmenge')
        await activateTradeForUser(userId, id, body.mood as MoodCheckInput, { execution: { price, quantity, fee } })
      } else if (action === 'add' || action === 'partialClose') {
        const quantity = positive(body.quantity, 'Ausführungsmenge')
        await (action === 'add' ? addToPositionForUser : partialCloseForUser)(userId, id, { quantity, price, fee, note })
      } else if (action === 'executeTarget') {
        await executeTargetForUser(userId, id, positiveId(String(body.targetId ?? '')), { quantity: positive(body.quantity, 'Ausführungsmenge'), price, fee, note })
      } else {
        await closeTradeForUser(userId, id, { quantity: positive(body.quantity, 'Ausführungsmenge'), actualExitPrice: price, feeExit: fee,
          targetId: body.targetId == null ? undefined : positiveId(String(body.targetId)), note })
      }
    }
  })
  // Same boundary as manual UI changes; no automatic replay may create a second fill.
  await db.update(trade).set({ demoBoundaryAt: new Date() }).where(and(eq(trade.id, id), eq(trade.userId, userId)))
  const [saved] = await db.select().from(trade).where(and(eq(trade.id, id), eq(trade.userId, userId)))
  return publicTrade(saved)
}
function normalizeManagementAssessment(raw: unknown) {
  if (raw === undefined) return undefined
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError(422, 'Managementbewertung ist ungültig.')
  const r = raw as Record<string, unknown>; onlyKeys(r, ['assessment','reason','source'])
  if (!['plan','violation','unknown'].includes(String(r.assessment)) || r.source !== 'user_statement' || typeof r.reason !== 'string' || r.reason.length > 4000 || (r.assessment !== 'unknown' && !r.reason.trim())) throw new ApiError(422, 'Begründete Nutzerbewertung erforderlich; bei Unklarheit unknown verwenden.')
  return { assessment: r.assessment as import('./management-review').ManagementReview['assessment'], reason: r.reason.trim() || 'Planbezug noch nicht geklärt.' }
}
export async function reviseExecution(userId: string, id: number, eventId: number, body: Record<string, unknown>) {
  onlyKeys(body, ['patch','reason','source'])
  const source = confirmedSource(body.source), reason = optionalNote(body.reason)
  if (!reason) throw new ApiError(422, 'Korrekturgrund erforderlich.')
  if (!body.patch || typeof body.patch !== 'object' || Array.isArray(body.patch)) throw new ApiError(422, 'Korrekturangaben fehlen.')
  const raw = body.patch as Record<string, unknown>; onlyKeys(raw, ['at','price','quantity','fee','note'])
  if (!Object.keys(raw).length) throw new ApiError(422, 'Korrekturangaben fehlen.')
  const owned = and(eq(tradeEvent.tradeId,id),eq(tradeEvent.userId,userId))
  const events = await db.select().from(tradeEvent).where(owned)
  const original = events.find(e => e.id === eventId)
  if (!original || !['eroeffnet','nachkauf','teilverkauf','geschlossen'].includes(original.type)) throw new ApiError(404, 'Ausführungsereignis nicht gefunden.')
  const affected = events.filter(e => e.id === eventId || ['eroeffnet','nachkauf'].includes(original.type))
  const receipts = await db.select().from(tradeSettlementReceipt).where(and(eq(tradeSettlementReceipt.tradeId,id),eq(tradeSettlementReceipt.userId,userId)))
  if (affected.some(e => { const p=payloadObject(e.payload); return p.source === 'broker' || p.auto === true || p.settlement || receipts.some(r=>r.eventId===e.id) })) {
    throw new ApiError(409, 'Ausführung ist an einen Broker-, Demo- oder Abrechnungsnachweis gebunden. Belegkorrektur zuerst klären.')
  }
  const patch: Partial<typeof tradeEvent.$inferInsert> = {}
  if ('at' in raw) { patch.at = actualTime(raw.at); if (patch.at > new Date(source.capturedAt)) throw new ApiError(422, 'Ausführung liegt nach ihrer Beobachtung.') }
  if ('price' in raw) patch.price = positive(raw.price,'Ausführungskurs')
  if ('quantity' in raw) patch.quantity = positive(raw.quantity,'Ausführungsmenge')
  if ('fee' in raw) patch.fee = optionalFee(raw.fee)
  if ('note' in raw) patch.note = optionalNote(raw.note)
  const [previous] = await db.select().from(tradeEventRevision).where(and(eq(tradeEventRevision.eventId,eventId),eq(tradeEventRevision.userId,userId))).orderBy(desc(tradeEventRevision.version)).limit(1)
  const [saved] = await db.update(tradeEvent).set(patch).where(and(owned,eq(tradeEvent.id,eventId))).returning()
  await db.insert(tradeEventRevision).values({ userId,tradeId:id,eventId,version:(previous?.version??0)+1,before:eventFacts(original),after:eventFacts(saved),reason,source })
  await db.update(tradeTarget).set({ executedAt:saved.at,executedPrice:saved.price,executedQty:saved.quantity }).where(and(eq(tradeTarget.tradeId,id),eq(tradeTarget.userId,userId),eq(tradeTarget.eventId,eventId)))
  const t = await projectPosition(userId,id)
  await db.insert(tradeEvent).values({ userId,tradeId:id,type:'notiz',note:'Ausführung berichtigt: '+reason,
    payload:JSON.stringify({ eventId, revision:(previous?.version??0)+1, before:eventFacts(original), after:eventFacts(saved), source }) })
  return publicTrade(t)
}
export async function saveTradeReview(userId: string, id: number, body: Record<string, unknown>) {
  onlyKeys(body,['status','deferredUntil','followedPlan','lossAccepted','mood','reason','source'])
  const source=confirmedSource(body.source), status=body.status, reason=optionalNote(body.reason)
  if (!['completed','deferred','skipped','pending'].includes(String(status))) throw new ApiError(422,'Bewertungsstatus ist ungültig.')
  const owned=and(eq(trade.id,id),eq(trade.userId,userId))
  const [t]=await db.select().from(trade).where(owned)
  if (!t || t.status!=='abgeschlossen') throw new ApiError(422,'Bewertung nur für abgeschlossene Trades möglich.')
  const values: Partial<typeof trade.$inferInsert>={reviewStatus:String(status),reviewDeferredUntil:null}
  if (status==='deferred') {
    if (typeof body.deferredUntil!=='string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(body.deferredUntil)) throw new ApiError(422,'Erinnerungszeitpunkt mit Zeitzone angeben.')
    const until=new Date(body.deferredUntil)
    if (!Number.isFinite(until.getTime()) || until<=new Date()) throw new ApiError(422,'Erinnerungszeitpunkt muss in der Zukunft liegen.')
    values.reviewDeferredUntil=until
  } else if ('deferredUntil' in body) throw new ApiError(422,'Erinnerungszeitpunkt nur beim Zurückstellen angeben.')
  if (status==='skipped' && !reason) throw new ApiError(422,'Grund für das bewusste Überspringen angeben.')
  if (status==='completed') {
    if (typeof body.followedPlan!=='boolean') throw new ApiError(422,'Planbefolgung ausdrücklich bewerten.')
    values.followedPlan=body.followedPlan
    if (t.result==='verlust' && typeof body.lossAccepted!=='boolean') throw new ApiError(422,'Verlustreflexion ausdrücklich beantworten; Nein ist zulässig.')
    if ('lossAccepted' in body) {
      if (typeof body.lossAccepted!=='boolean') throw new ApiError(422,'Verlustreflexion ist ungültig.')
      values.lossAccepted=body.lossAccepted; values.reviewLossAccepted=body.lossAccepted
    }
    if (body.mood || requiresMoodCheck(t.tradeKind)) {
      let mood
      try { mood=normalizeMoodCheck(body.mood as MoodCheckInput) } catch { throw new ApiError(422,'Gefühlsantwort ist ungültig.') }
      if (!mood) throw new ApiError(422,'Eine eigene Gefühlsantwort fehlt.')
      values.moodExit=mood.score;values.moodExitTags=serializeMoodTags(mood.tags);values.moodExitNote=mood.note
    }
  } else if (['followedPlan','lossAccepted','mood'].some(k=>k in body)) throw new ApiError(422,'Bewertungen beim Abschließen der Reflexion ergänzen.')
  const [saved]=await db.update(trade).set(values).where(owned).returning()
  await db.insert(tradeEvent).values({userId,tradeId:id,type:'notiz',note:status==='completed'?'Abschlussbewertung nachgeholt':status==='deferred'?'Bewertung zurückgestellt':status==='skipped'?'Bewertung bewusst übersprungen':'Bewertung wieder geöffnet',
    payload:JSON.stringify({source,reason,before:{reviewStatus:t.reviewStatus,followedPlan:t.followedPlan,lossAccepted:t.reviewLossAccepted,moodExit:t.moodExit,moodExitTags:t.moodExitTags,moodExitNote:t.moodExitNote,reviewDeferredUntil:t.reviewDeferredUntil},
      after:{reviewStatus:saved.reviewStatus,followedPlan:saved.followedPlan,lossAccepted:saved.reviewLossAccepted,moodExit:saved.moodExit,moodExitTags:saved.moodExitTags,moodExitNote:saved.moodExitNote,reviewDeferredUntil:saved.reviewDeferredUntil}})})
  return publicTrade(saved)
}
