'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { cashflow } from '@/lib/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import type { CashflowRow } from '@/lib/trade-stats'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

export type Cashflow = CashflowRow & { id: number }

/** Postgres „undefined table" (42P01) — Migration 0010 noch nicht angewendet. */
function isMissingTable(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { code?: string; cause?: { code?: string }; message?: string }
  return e.code === '42P01' || e.cause?.code === '42P01' || /cashflow/.test(e.message ?? '')
}

/**
 * Ein- und Auszahlungen des Nutzers, chronologisch.
 *
 * Tolerant gegenüber fehlender Migration 0010 (`drizzle/0010_money_foundation.sql`):
 * Existiert die Tabelle noch nicht, wird eine leere Liste geliefert statt zu
 * crashen — Bilanz und Equity verhalten sich dann exakt wie vorher.
 */
export async function listCashflows(): Promise<Cashflow[]> {
  const userId = await getUserId()
  try {
    const rows = await db
      .select()
      .from(cashflow)
      .where(eq(cashflow.userId, userId))
      .orderBy(asc(cashflow.occurredAt), asc(cashflow.id))
    return rows.map((r) => ({
      id: r.id,
      amount: r.amount,
      kind: r.kind === 'auszahlung' ? 'auszahlung' : 'einzahlung',
      occurredAt: r.occurredAt,
      note: r.note,
    }))
  } catch (err) {
    if (!isMissingTable(err)) throw err
    return []
  }
}

/** Ein- oder Auszahlung erfassen. Der Betrag wird immer positiv gespeichert. */
export async function addCashflow(input: {
  amount: number
  kind: 'einzahlung' | 'auszahlung'
  occurredAt?: Date | string | null
  note?: string | null
}): Promise<{ id: number }> {
  const userId = await getUserId()

  const amount = Math.abs(Number(input.amount))
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Bitte einen Betrag größer als 0 eintragen.')
  }
  const kind = input.kind === 'auszahlung' ? 'auszahlung' : 'einzahlung'

  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date()
  if (Number.isNaN(occurredAt.getTime())) {
    throw new Error('Das Datum ist ungültig.')
  }

  const [row] = await db
    .insert(cashflow)
    .values({ userId, amount, kind, occurredAt, note: input.note?.trim() || null })
    .returning({ id: cashflow.id })

  revalidateAll()
  return { id: row.id }
}

export async function deleteCashflow(id: number): Promise<void> {
  const userId = await getUserId()
  await db.delete(cashflow).where(and(eq(cashflow.id, id), eq(cashflow.userId, userId)))
  revalidateAll()
}

/** Cashflows verändern Bilanz, Rendite und Equity — überall neu rechnen lassen. */
function revalidateAll(): void {
  revalidatePath('/')
  revalidatePath('/tracking')
  revalidatePath('/settings')
}
