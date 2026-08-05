'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { userSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import {
  normalizeDrawingDefaults,
  type DrawingDefaults,
} from '@/lib/drawing-defaults'

// ACHTUNG: 'use server' erlaubt ausschließlich async Funktionen als Export.
// Typ und Standardwerte stehen deshalb in `lib/drawing-defaults.ts`.

async function userIdOrNull(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user?.id ?? null
}

/**
 * Die eigenen Zeichen-Standards laden.
 *
 * Wirft bewusst NIE: Ohne Anmeldung, ohne Zeile oder bei kaputtem Eintrag kommt
 * der Auslieferungszustand zurück. Zeichnen darf an einer Einstellungsfrage
 * nicht scheitern — dieselbe Haltung wie bei `loadChartAppearance`.
 */
export async function loadDrawingDefaults(): Promise<DrawingDefaults> {
  try {
    const userId = await userIdOrNull()
    if (!userId) return normalizeDrawingDefaults(null)
    const [row] = await db
      .select({ v: userSettings.drawingDefaults })
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
    return normalizeDrawingDefaults(row?.v ?? null)
  } catch {
    return normalizeDrawingDefaults(null)
  }
}

/**
 * Zeichen-Standards speichern (Upsert). Geprüft wird auf dem Server erneut
 * über dieselbe Funktion wie im Client — der Client ist keine Prüfstelle.
 */
export async function saveDrawingDefaults(input: unknown): Promise<void> {
  const userId = await userIdOrNull()
  if (!userId) throw new Error('Unauthorized')

  const sauber = normalizeDrawingDefaults(input)
  const values = { drawingDefaults: JSON.stringify(sauber) }

  await db
    .insert(userSettings)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: userSettings.userId, set: values })
}

/** Zurück auf den Auslieferungszustand — NULL statt geschriebener Standard. */
export async function resetDrawingDefaults(): Promise<void> {
  const userId = await userIdOrNull()
  if (!userId) throw new Error('Unauthorized')
  await db
    .update(userSettings)
    .set({ drawingDefaults: null })
    .where(eq(userSettings.userId, userId))
}
