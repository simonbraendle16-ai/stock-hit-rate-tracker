import { NextRequest, NextResponse } from 'next/server'
import { apiResponseError, positiveId, readJsonObject, requestKey, requireApiScope, versionFromHeader } from '@/lib/assistant-api'
import { mutateTrade } from '@/lib/trade-mutation-service'
import { closeImportedExecution } from '@/lib/execution-import-close'

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiScope(req, 'trades:write'), id = positiveId((await context.params).id)
    const body = await readJsonObject(req), version = versionFromHeader(req), key = requestKey(req)
    return NextResponse.json(await mutateTrade(userId, id, version, key, 'execution-import-close', body,
      row => closeImportedExecution(userId, row, body)))
  } catch (e) { return apiResponseError(e) }
}
