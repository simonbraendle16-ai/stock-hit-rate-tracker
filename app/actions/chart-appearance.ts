'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { userSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { normalizeAppearance, type ChartAppearance } from '@/lib/chart-appearance'

// ACHTUNG: 'use server' erlaubt ausschließlich async Funktionen als Export.
// Typ und Standardwerte stehen deshalb in `lib/chart-appearance.ts`.

async function userIdOrNull(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user?.id ?? null
}

/**
 * Das gespeicherte Chart-Aussehen laden.
 *
 * Wirft bewusst NIE: Ohne Anmeldung, ohne Zeile oder bei kaputtem Eintrag
 * kommt der Auslieferungszustand zurück. Ein Chart darf an einer
 * Einstellungsfrage nicht scheitern — er ist das Werkzeug, nicht die
 * Einstellung.
 */
export async function loadChartAppearance(): Promise<ChartAppearance> {
  try {
    const userId = await userIdOrNull()
    if (!userId) return normalizeAppearance(null)
    const [row] = await db
      .select({ v: userSettings.chartAppearance })
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
    return normalizeAppearance(row?.v ?? null)
  } catch {
    return normalizeAppearance(null)
  }
}

/**
 * Das Chart-Aussehen speichern (Upsert).
 *
 * Geprüft wird auf dem Server erneut über dieselbe Funktion wie im Formular
 * (`normalizeAppearance`) — der Client ist keine Prüfstelle, und gespeichert
 * werden soll nur, was der Chart auch zeichnen kann.
 */
export async function saveChartAppearance(input: unknown): Promise<void> {
  const userId = await userIdOrNull()
  if (!userId) throw new Error('Unauthorized')

  const sauber = normalizeAppearance(input)
  const values = { chartAppearance: JSON.stringify(sauber) }

  await db
    .insert(userSettings)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: userSettings.userId, set: values })
}

/** Zurück auf den Auslieferungszustand — NULL statt geschriebener Standard. */
export async function resetChartAppearance(): Promise<void> {
  const userId = await userIdOrNull()
  if (!userId) throw new Error('Unauthorized')
  await db
    .update(userSettings)
    .set({ chartAppearance: null })
    .where(eq(userSettings.userId, userId))
}
