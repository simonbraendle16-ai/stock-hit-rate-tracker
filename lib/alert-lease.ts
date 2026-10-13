import { randomUUID } from 'node:crypto'
import { and, eq, or, isNull, lt, sql } from 'drizzle-orm'
import { db } from './db'
import { alertCheckState } from './db/schema'

const KEY = 'alerts'
export async function acquireAlertLease() {
  await db.insert(alertCheckState).values({ id: KEY }).onConflictDoNothing()
  const token = randomUUID()
  const [state] = await db.update(alertCheckState).set({ leaseToken: token, leaseUntil: sql`now() + interval '90 seconds'` })
    .where(and(eq(alertCheckState.id, KEY), or(isNull(alertCheckState.leaseUntil), lt(alertCheckState.leaseUntil, sql`now()`))))
    .returning()
  return state ? { ...state, token } : null
}
export async function checkpointAlertLease(token: string, cursor: number, cycleFailed: boolean) {
  const [row] = await db.update(alertCheckState).set({ cursor, cycleFailed })
    .where(and(eq(alertCheckState.id, KEY), eq(alertCheckState.leaseToken, token))).returning({ id: alertCheckState.id })
  if (!row) throw new Error('Alarmprüfung hat ihre Verarbeitungssperre verloren.')
}
export async function releaseAlertLease(token: string) {
  await db.update(alertCheckState).set({ leaseToken: null, leaseUntil: null })
    .where(and(eq(alertCheckState.id, KEY), eq(alertCheckState.leaseToken, token)))
}
