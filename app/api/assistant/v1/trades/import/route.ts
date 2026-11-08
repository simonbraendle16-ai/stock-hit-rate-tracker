import { NextRequest, NextResponse } from 'next/server'
import { requireApiScope, readJsonObject, apiResponseError } from '@/lib/assistant-api'
import { importExecution } from '@/lib/execution-import-service'
import { publicTrade } from '@/lib/trade-mutation-service'
import { invalidateTradeAnalysis } from '@/lib/invalidate-trade-analysis'

export async function POST(req:NextRequest) {
  try {
    const userId=await requireApiScope(req,'trades:write')
    const result=await importExecution(userId,await readJsonObject(req))
    invalidateTradeAnalysis()
    return NextResponse.json(publicTrade(result.row),{status:result.created?201:200})
  } catch(e) {return apiResponseError(e)}
}
