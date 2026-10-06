import { NextRequest, NextResponse } from 'next/server'
import { apiResponseError, positiveId, readJsonObject, requestKey, requireApiScope, versionFromHeader } from '@/lib/assistant-api'
import { mutateTrade, reviseExecution } from '@/lib/trade-mutation-service'

export async function POST(req: NextRequest, context: { params: Promise<{ id: string; eventId: string }> }) {
  try {
    const userId=await requireApiScope(req,'trades:write'), params=await context.params
    const id=positiveId(params.id), eventId=positiveId(params.eventId)
    const body=await readJsonObject(req), version=versionFromHeader(req), key=requestKey(req)
    return NextResponse.json(await mutateTrade(userId,id,version,key,`events/${eventId}/revisions`,body,()=>reviseExecution(userId,id,eventId,body)))
  } catch(e) { return apiResponseError(e) }
}
