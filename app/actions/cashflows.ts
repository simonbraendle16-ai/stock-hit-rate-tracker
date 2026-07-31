'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { cashflow } from '@/lib/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import type { CashflowRow } from '@/lib/trade-stats'
import {
  cashflowScopeWhere,
  loadOwnedPortfolio,
  loadScopeContext,
} from '@/lib/portfolio-context'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

export type Cashflow = CashflowRow & { id: number; portfolioId: number }

/** Postgres „undefined table" (42P01) — Migration 0010 noch nicht angewendet. */
function isMissingTable(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { code?: string; cause?: { code?: string }; message?: string }
  return e.code === '42P01' || e.cause?.code === '42P01' || /cashflow/.test(e.message ?? '')
}

/**
 * Ein- und Auszahlungen der AKTIVEN AUSWAHL, chronologisch (Etappe 12).
 *
 * Seit den Depots hängt jede Zahlung an genau einem Depot: Eine Einzahlung, die
 * kontoweit gälte, würde die Rendite ALLER Depots gleichzeitig verfälschen — und
 * ein Papier-Startkapital wäre durch eine echte Einzahlung plötzlich größer.
 *
 * Tolerant gegenüber fehlender Migration 0010 (`drizzle/0010_money_foundation.sql`):
 * Existiert die Tabelle noch nicht, wird eine leere Liste geliefert statt zu
 * crashen — Bilanz und Equity verhalten sich dann exakt wie vorher.
 */
export async function listCashflows(): Promise<Cashflow[]> {
  const userId = await getUserId()
  try {
    const { portfolioIds } = await loadScopeContext(userId)
    if (portfolioIds.length === 0) return []
    const rows = await db
      .select()
      .from(cashflow)
      .where(cashflowScopeWhere(userId, portfolioIds))
      .orderBy(asc(cashflow.occurredAt), asc(cashflow.id))
    return rows.map((r) => ({
      id: r.id,
      portfolioId: r.portfolioId,
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

/**
 * Ein- oder Auszahlung erfassen. Der Betrag wird immer positiv gespeichert.
 *
 * Das Depot ist Pflicht. Ohne ausdrückliche Angabe wird das aktive genommen —
 * aber nur, wenn eines gewählt ist: In das Aggregat „Alle Echtgeld-Depots" lässt
 * sich nicht einzahlen, weil nicht bestimmt wäre, welches Konto das Geld bekommt.
 */
export async function addCashflow(input: {
  amount: number
  kind: 'einzahlung' | 'auszahlung'
  occurredAt?: Date | string | null
  note?: string | null
  portfolioId?: number | null
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

  const portfolioId = await resolveZielDepot(userId, input.portfolioId)

  const [row] = await db
    .insert(cashflow)
    .values({
      userId,
      portfolioId,
      amount,
      kind,
      occurredAt,
      note: input.note?.trim() || null,
    })
    .returning({ id: cashflow.id })

  revalidateAll()
  return { id: row.id }
}

/** Das Depot, dem eine Zahlung zugeschrieben wird — geprüft, nicht geraten. */
async function resolveZielDepot(
  userId: string,
  portfolioId: number | null | undefined,
): Promise<number> {
  if (portfolioId != null) {
    const p = await loadOwnedPortfolio(userId, portfolioId)
    return p.id
  }
  const { active } = await loadScopeContext(userId)
  if (active) return active.id
  throw new Error(
    'Bitte wähle das Depot, zu dem diese Zahlung gehört — in die Zusammenfassung „Alle Echtgeld-Depots" lässt sich nicht einzahlen.',
  )
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
