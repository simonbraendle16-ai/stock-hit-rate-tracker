'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { assistantApiToken } from '@/lib/db/schema'
import { API_SCOPES, hashToken, newApiToken, type ApiScope } from '@/lib/assistant-api'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'

async function currentUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Nicht angemeldet.')
  return session.user.id
}

export async function listAssistantTokens() {
  const userId = await currentUserId()
  return db.select({ id: assistantApiToken.id, name: assistantApiToken.name,
    scopes: assistantApiToken.scopes, createdAt: assistantApiToken.createdAt,
    lastUsedAt: assistantApiToken.lastUsedAt })
    .from(assistantApiToken)
    .where(and(eq(assistantApiToken.userId, userId), isNull(assistantApiToken.revokedAt)))
    .orderBy(desc(assistantApiToken.createdAt)).limit(50)
}

export async function createAssistantToken(name: string, scopes: ApiScope[]) {
  const userId = await currentUserId()
  const cleanName = typeof name === 'string' ? name.trim() : ''
  if (!cleanName || cleanName.length > 80) throw new Error('Name muss 1 bis 80 Zeichen lang sein.')
  if (!Array.isArray(scopes) || !scopes.length || scopes.length > API_SCOPES.length ||
      scopes.some((scope) => !API_SCOPES.includes(scope)) || new Set(scopes).size !== scopes.length) {
    throw new Error('Ungültige Rechteauswahl.')
  }
  const token = newApiToken()
  await db.insert(assistantApiToken).values({ userId, name: cleanName, scopes, tokenHash: hashToken(token) })
  revalidatePath('/settings/assistant-api')
  return token
}

export async function revokeAssistantToken(id: string) {
  const userId = await currentUserId()
  await db.update(assistantApiToken).set({ revokedAt: new Date() })
    .where(and(eq(assistantApiToken.id, id), eq(assistantApiToken.userId, userId), isNull(assistantApiToken.revokedAt)))
  revalidatePath('/settings/assistant-api')
}
