'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { userSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { normalizeToolPrefs, type ChartToolPrefs } from '@/lib/chart-tools'

// ACHTUNG: 'use server' erlaubt ausschließlich async Funktionen als Export.
// Typ, Standardwerte und die reinen Funktionen stehen deshalb in
// `lib/chart-tools.ts`.

async function userIdOrNull(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user?.id ?? null
}

/**
 * Die gespeicherten Werkzeug-Einstellungen laden.
 *
 * Wirft bewusst NIE: Ohne Anmeldung, ohne Zeile oder bei kaputtem Eintrag
 * kommt der Auslieferungszustand zurück. An einer Einstellungsfrage darf die
 * Werkzeugleiste nicht scheitern — sie ist das Werkzeug, nicht die Einstellung.
 */
export async function loadChartTools(): Promise<ChartToolPrefs> {
  try {
    const userId = await userIdOrNull()
    if (!userId) return normalizeToolPrefs(null)
    const [row] = await db
      .select({ v: userSettings.chartTools })
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
    return normalizeToolPrefs(row?.v ?? null)
  } catch {
    // Auch ein fehlender Spalten-Eintrag (Migration 0031 noch nicht angewendet)
    // darf das Zeichnen nicht kosten.
    return normalizeToolPrefs(null)
  }
}

/**
 * Die Werkzeug-Einstellungen speichern (Upsert).
 *
 * Geprüft wird auf dem Server erneut über dieselbe Funktion wie im Browser
 * (`normalizeToolPrefs`) — der Client ist keine Prüfstelle.
 */
export async function saveChartTools(input: unknown): Promise<void> {
  const userId = await userIdOrNull()
  if (!userId) throw new Error('Unauthorized')

  const sauber = normalizeToolPrefs(input)
  const values = { chartTools: JSON.stringify(sauber) }

  await db
    .insert(userSettings)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: userSettings.userId, set: values })
}
