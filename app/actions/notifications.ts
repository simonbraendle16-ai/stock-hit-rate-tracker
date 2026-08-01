'use server'

// Etappe 14: Einstellungen und Zustand der Alarm-Zustellung.
//
// Eigene Ebene neben `settings.ts`, weil hier etwas anderes zur Debatte steht:
// nicht wie gerechnet wird, sondern ob und wohin sich die App meldet. Typen und
// Schwellen liegen in `lib/notify/status.ts` — eine 'use server'-Datei darf keine
// Nicht-Funktionen exportieren.

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { user, userSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { lastAlertCheck } from '@/lib/alert-run'
import { readMailConfig } from '@/lib/notify/agentmail'
import { resolveRecipient } from '@/lib/notify/alert-mail'
import { healthFrom, type NotifyStatus } from '@/lib/notify/status'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

/** Sehr einfache Prüfung — sie soll Tippfehler abfangen, keine Adresse validieren. */
function cleanEmail(raw: string | null | undefined): string | null {
  const v = raw?.trim()
  if (!v) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error('Das sieht nicht nach einer E-Mail-Adresse aus.')
  return v
}

export async function getNotifyStatus(): Promise<NotifyStatus> {
  const userId = await getUserId()

  const [row] = await db
    .select({
      notifyEmail: userSettings.notifyEmail,
      notifyByEmail: userSettings.notifyByEmail,
      accountEmail: user.email,
    })
    .from(user)
    .leftJoin(userSettings, eq(userSettings.userId, user.id))
    .where(eq(user.id, userId))

  const last = await lastAlertCheck()
  const hasMailConfig = readMailConfig() !== null

  // Ohne Einstellungszeile gilt der Vorgabewert (an) — sonst stünde bei einem
  // Nutzer, der die Einstellungen nie geöffnet hat, „abgeschaltet".
  const notifyByEmail = row?.notifyByEmail ?? true

  return {
    health: healthFrom({ hasMailConfig, lastCheckAt: last?.startedAt ?? null }),
    lastCheckAt: last ? new Date(last.startedAt).toISOString() : null,
    lastTrigger: last?.trigger ?? null,
    lastError: last?.error ?? null,
    recipient: notifyByEmail ? resolveRecipient(row?.notifyEmail, row?.accountEmail) : null,
    notifyEmail: row?.notifyEmail ?? null,
    notifyByEmail,
  }
}

export async function updateNotifySettings(input: {
  notifyEmail: string | null
  notifyByEmail: boolean
}): Promise<NotifyStatus> {
  const userId = await getUserId()
  const email = cleanEmail(input.notifyEmail)

  await db
    .insert(userSettings)
    .values({ userId, notifyEmail: email, notifyByEmail: input.notifyByEmail })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { notifyEmail: email, notifyByEmail: input.notifyByEmail },
    })

  revalidatePath('/settings')
  return getNotifyStatus()
}
