'use server'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { stock } from '@/lib/db/schema'
import { eq, asc } from 'drizzle-orm'
import { listFib, saveFib } from '@/lib/fibonacci-service'
import { ApiError, uuidId } from '@/lib/assistant-api'
async function owner() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}
export async function getFibonacciData(stockId?: number) {
  const userId = await owner()
  const [observations, instruments] = await Promise.all([
    listFib(userId, stockId),
    db
      .select({
        id: stock.id,
        name: stock.name,
        ticker: stock.ticker,
        market: stock.market,
      })
      .from(stock)
      .where(eq(stock.userId, userId))
      .orderBy(asc(stock.name)),
  ])
  return { observations, instruments }
}
export async function saveFibonacci(
  id: string,
  input: Record<string, unknown>,
  version?: number,
) {
  const userId = await owner()
  try {
    const row = await saveFib(userId, uuidId(id), input, version)
    revalidatePath('/analysis')
    revalidatePath(`/stock/${row.stockId}`)
    return { ok: true as const, row }
  } catch (e) {
    if (e instanceof ApiError) return { ok: false as const, error: e.message }
    throw e
  }
}
