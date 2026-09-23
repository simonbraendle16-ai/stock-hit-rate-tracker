import { db } from '@/lib/db'
import { portfolio } from '@/lib/db/schema'
import { apiResponseError, requireApiScope } from '@/lib/assistant-api'
import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  try {
    const userId = await requireApiScope(req, 'trades:read')
    const rows = await db.select({ id: portfolio.id, name: portfolio.name,
      kind: portfolio.kind, archivedAt: portfolio.archivedAt })
      .from(portfolio).where(eq(portfolio.userId, userId)).orderBy(portfolio.id)
    return NextResponse.json({ items: rows })
  } catch (cause) { return apiResponseError(cause) }
}
