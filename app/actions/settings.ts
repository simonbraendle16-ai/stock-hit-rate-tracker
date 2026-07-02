'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { userSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

export type UserSettings = {
  startCapital: number
  defaultRiskPct: number
  maxRiskPct: number
}

const DEFAULTS: UserSettings = {
  startCapital: 10000,
  defaultRiskPct: 1,
  maxRiskPct: 2,
}

/** Einstellungen des Users — liefert Defaults, falls noch keine Zeile existiert. */
export async function getSettings(): Promise<UserSettings> {
  const userId = await getUserId()
  const [row] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
  if (!row) return { ...DEFAULTS }
  return {
    startCapital: row.startCapital,
    defaultRiskPct: row.defaultRiskPct,
    maxRiskPct: row.maxRiskPct,
  }
}

function clampPositive(v: number, fallback: number): number {
  return Number.isFinite(v) && v > 0 ? v : fallback
}

function clampPct(v: number, fallback: number): number {
  if (!Number.isFinite(v) || v <= 0) return fallback
  return v > 100 ? 100 : v
}

/** Einstellungen speichern (Upsert). */
export async function updateSettings(input: {
  startCapital: number
  defaultRiskPct: number
  maxRiskPct: number
}): Promise<void> {
  const userId = await getUserId()
  const values = {
    startCapital: clampPositive(input.startCapital, DEFAULTS.startCapital),
    defaultRiskPct: clampPct(input.defaultRiskPct, DEFAULTS.defaultRiskPct),
    maxRiskPct: clampPct(input.maxRiskPct, DEFAULTS.maxRiskPct),
  }

  await db
    .insert(userSettings)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: userSettings.userId, set: values })

  revalidatePath('/')
  revalidatePath('/tracking')
  revalidatePath('/settings')
  revalidatePath('/trades/new')
}
