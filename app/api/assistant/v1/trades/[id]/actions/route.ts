import { NextRequest, NextResponse } from 'next/server'
import { apiResponseError, positiveId, readJsonObject, requestKey, requireApiScope, versionFromHeader } from '@/lib/assistant-api'
import { mutateTrade, performTradeAction } from '@/lib/trade-mutation-service'

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId=await requireApiScope(req,'trades:write'), id=positiveId((await context.params).id)
    const body=await readJsonObject(req), version=versionFromHeader(req), key=requestKey(req)
    return NextResponse.json(await mutateTrade(userId,id,version,key,'actions',body,row=>performTradeAction(userId,id,row,body)))
  } catch(e) { return apiResponseError(e) }
}
