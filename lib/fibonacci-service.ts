import { db } from '@/lib/db'
import { fibonacciObservation as observation, stock } from '@/lib/db/schema'
import { and, eq, desc, sql } from 'drizzle-orm'
import { ApiError } from '@/lib/assistant-api'
import {
  FibonacciError,
  validateFibInput,
  type FibObservation,
} from '@/lib/fibonacci'
export function fibValues(raw: Record<string, unknown>) {
  try {
    return validateFibInput(raw)
  } catch (e) {
    if (e instanceof FibonacciError) throw new ApiError(422, e.message)
    throw e
  }
}
export async function listFib(
  userId: string,
  stockId?: number,
): Promise<FibObservation[]> {
  const rows = await db
    .select({
      observation,
      ticker: stock.ticker,
      name: stock.name,
      market: stock.market,
    })
    .from(observation)
    .innerJoin(
      stock,
      and(eq(stock.id, observation.stockId), eq(stock.userId, userId)),
    )
    .where(
      and(
        eq(observation.userId, userId),
        stockId ? eq(observation.stockId, stockId) : undefined,
      ),
    )
    .orderBy(
      desc(observation.observedOn),
      desc(observation.createdAt),
      desc(observation.id),
    )
  return rows.map(({ observation: row, ...instrument }) => {
    const { userId: _, createdAt: __, updatedAt: ___, ...data } = row
    return { ...data, ...instrument }
  })
}
export async function getFib(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(observation)
    .where(and(eq(observation.id, id), eq(observation.userId, userId)))
  if (!row) throw new ApiError(404, 'Beobachtung nicht gefunden.')
  const { userId: _, ...result } = row
  return result
}
export async function saveFib(
  userId: string,
  id: string,
  raw: Record<string, unknown>,
  version?: number,
) {
  const values = fibValues(raw)
  const [owned] = await db
    .select({ id: stock.id })
    .from(stock)
    .where(and(eq(stock.id, values.stockId), eq(stock.userId, userId)))
  if (!owned) throw new ApiError(404, 'Instrument nicht gefunden.')
  if (version !== undefined) {
    if (!Number.isSafeInteger(version) || version < 1)
      throw new ApiError(400, 'Gültige Version erforderlich.')
    const [row] = await db
      .update(observation)
      .set({
        ...values,
        version: sql`${observation.version}+1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(observation.id, id),
          eq(observation.userId, userId),
          eq(observation.version, version),
        ),
      )
      .returning()
    if (!row) {
      await getFib(userId, id)
      throw new ApiError(
        409,
        'Beobachtung wurde inzwischen geändert. Neu laden.',
      )
    }
  } else {
    const [inserted] = await db
      .insert(observation)
      .values({ ...values, id, userId })
      .onConflictDoNothing()
      .returning()
    if (!inserted) {
      const existing = await getFib(userId, id)
      if (
        Object.entries(values).some(
          ([key, value]) => existing[key as keyof typeof existing] !== value,
        )
      )
        throw new ApiError(
          409,
          'Diese Erfassungs-ID gehört zu einer anderen Beobachtung.',
        )
    }
  }
  return getFib(userId, id)
}
