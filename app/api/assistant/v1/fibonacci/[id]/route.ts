import { NextRequest, NextResponse } from 'next/server'
import {
  apiResponseError,
  requireApiScope,
  readJsonObject,
  uuidId,
  versionFromHeader,
} from '@/lib/assistant-api'
import { getFib, saveFib } from '@/lib/fibonacci-service'
type Context = { params: Promise<{ id: string }> }
export async function GET(req: NextRequest, ctx: Context) {
  try {
    return NextResponse.json(
      await getFib(
        await requireApiScope(req, 'trades:read'),
        uuidId((await ctx.params).id),
      ),
    )
  } catch (e) {
    return apiResponseError(e)
  }
}
export async function PATCH(req: NextRequest, ctx: Context) {
  try {
    return NextResponse.json(
      await saveFib(
        await requireApiScope(req, 'trades:write'),
        uuidId((await ctx.params).id),
        await readJsonObject(req),
        versionFromHeader(req),
      ),
    )
  } catch (e) {
    return apiResponseError(e)
  }
}
