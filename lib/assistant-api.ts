import { createHash, randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { assistantApiToken } from '@/lib/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

export const API_SCOPES = ['trades:read', 'trades:write', 'journal:read', 'journal:write'] as const
export type ApiScope = typeof API_SCOPES[number]

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function newApiToken() {
  return `sat_${randomBytes(32).toString('base64url')}`
}

export async function requireApiScope(req: NextRequest, scope: ApiScope) {
  const header = req.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) throw new ApiError(401, 'API-Token fehlt.')
  const token = header.slice(7)
  if (!/^sat_[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError(401, 'Ungültiges API-Token.')
  const [row] = await db.select().from(assistantApiToken)
    .where(and(eq(assistantApiToken.tokenHash, hashToken(token)), isNull(assistantApiToken.revokedAt)))
    .limit(1)
  if (!row) throw new ApiError(401, 'Ungültiges API-Token.')
  if (!row.scopes.includes(scope)) throw new ApiError(403, 'Dieses Token hat das erforderliche Recht nicht.')
  await db.update(assistantApiToken).set({ lastUsedAt: new Date() }).where(eq(assistantApiToken.id, row.id))
  return row.userId
}

export function apiResponseError(cause: unknown) {
  if (cause instanceof ApiError) return NextResponse.json({ error: cause.message }, { status: cause.status })
  console.error('Assistant API request failed:', cause instanceof Error ? cause.name : 'unknown error')
  return NextResponse.json({ error: 'Dienst vorübergehend nicht verfügbar.' }, { status: 503 })
}

export async function readJsonObject(req: NextRequest) {
  if (!req.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new ApiError(400, 'Content-Type application/json erforderlich.')
  }
  const raw = await req.text()
  if (raw.length > 65536) throw new ApiError(400, 'Anfrage zu groß.')
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new ApiError(400, 'Ungültiges JSON.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'JSON-Objekt erwartet.')
  return value as Record<string, unknown>
}

export function onlyKeys(input: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(input).some((key) => !keys.includes(key))) throw new ApiError(400, 'Unbekanntes Eingabefeld.')
}

export function versionFromHeader(req: NextRequest) {
  const raw = req.headers.get('x-expected-version')
  if (!raw || !/^[1-9]\d*$/.test(raw)) throw new ApiError(400, 'X-Expected-Version mit aktueller Versionsnummer erforderlich.')
  const version = Number(raw)
  if (!Number.isSafeInteger(version)) throw new ApiError(400, 'Ungültige Version.')
  return version
}

export function positiveId(raw: string) {
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new ApiError(400, 'Ungültige ID.')
  return Number(raw)
}

export function uuidId(raw: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) throw new ApiError(400, 'Ungültige ID.')
  return raw
}
