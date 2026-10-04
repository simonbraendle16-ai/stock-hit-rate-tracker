import { NextRequest, NextResponse } from 'next/server'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { portfolio } from '@/lib/db/schema'
import { ApiError, apiResponseError, onlyKeys, positiveId, readJsonObject, requireApiScope } from '@/lib/assistant-api'
import { currencyAssignment } from '@/lib/money-currency'

/** First declaration only; never converts balances or historical snapshots. */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiScope(req, 'trades:write')
    const id = positiveId((await context.params).id)
    const body = await readJsonObject(req)
    onlyKeys(body, ['currency'])
    if (typeof body.currency !== 'string') throw new ApiError(422, 'Depotwährung fehlt.')
    const row = await db.transaction(async tx => {
      await tx.execute(sql`SELECT id FROM portfolio WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE`)
      const [current] = await tx.select().from(portfolio).where(and(eq(portfolio.id, id), eq(portfolio.userId, userId))).limit(1)
      if (!current) throw new ApiError(404, 'Depot nicht gefunden.')
      let assignment
      try { assignment = currencyAssignment(current.currency, body.currency as string) }
      catch (e) { throw new ApiError(422, e instanceof Error ? e.message : 'Währungszuordnung ist ungültig.') }
      if (assignment) await tx.update(portfolio).set(assignment).where(eq(portfolio.id, id))
      return { id, name: current.name, currency: assignment?.currency ?? current.currency }
    })
    return NextResponse.json(row)
  } catch (e) { return apiResponseError(e) }
}
