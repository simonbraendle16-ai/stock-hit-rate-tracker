import { db } from '@/lib/db'
import { trade, tradeEvent, tradeEventRevision, tradeTarget } from '@/lib/db/schema'
import { ApiError, apiResponseError, hashToken, positiveId, readJsonObject, requestKey, requireApiScope, versionFromHeader } from '@/lib/assistant-api'
import { canonicalBody } from '@/lib/assistant-trade-input'
import { mutateTrade, patchPlannedTrade, publicTrade, pendingReview } from '@/lib/trade-mutation-service'
import { and, asc, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId=await requireApiScope(req,'trades:read'), id=positiveId((await context.params).id)
    const result=await db.transaction(async tx => {
      const [row]=await tx.select().from(trade).where(and(eq(trade.id,id),eq(trade.userId,userId))).limit(1)
      if (!row) throw new ApiError(404,'Trade nicht gefunden.')
      const events=await tx.select().from(tradeEvent).where(and(eq(tradeEvent.tradeId,id),eq(tradeEvent.userId,userId))).orderBy(asc(tradeEvent.at),asc(tradeEvent.id))
      const targets=await tx.select().from(tradeTarget).where(and(eq(tradeTarget.tradeId,id),eq(tradeTarget.userId,userId))).orderBy(asc(tradeTarget.sortOrder),asc(tradeTarget.id))
      const revisions=await tx.select().from(tradeEventRevision).where(and(eq(tradeEventRevision.tradeId,id),eq(tradeEventRevision.userId,userId))).orderBy(asc(tradeEventRevision.createdAt),asc(tradeEventRevision.id))
      return {...publicTrade(row),reviewPending:pendingReview(row),events:events.map(({userId:_u,...r})=>r),
        targets:targets.map(({userId:_u,...r})=>r),eventRevisions:revisions.map(({userId:_u,...r})=>r)}
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
    return NextResponse.json(result)
  } catch(e) { return apiResponseError(e) }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId=await requireApiScope(req,'trades:write'), id=positiveId((await context.params).id)
    const version=versionFromHeader(req), body=await readJsonObject(req)
    // Preserve existing planned-PATCH callers; their version/body is the stable request identity.
    const key=req.headers.has('idempotency-key')?requestKey(req):`plan-${hashToken(canonicalBody({userId,id,version,body}))}`
    return NextResponse.json(await mutateTrade(userId,id,version,key,'plan',body,row=>patchPlannedTrade(userId,id,row,body)))
  } catch(e) { return apiResponseError(e) }
}
