'use server'

// Freunde (Etappe 2): gegenseitige Accountability per Einladungscode.
//
// Sicherheit — der kritische Teil: KEINE bestehende Server Action wird
// aufgebohrt. Jede von ihnen filtert weiter hart auf den eigenen `getUserId()`.
// Fremddaten werden ausschließlich hier gelesen, und jeder Lesezugriff auf ein
// fremdes Journal läuft durch die eine Prüffunktion `assertCanView`. Sichtbar
// wird nur, was `lib/friends.ts` durchlässt (Disziplin-Kennzahlen ohne Beträge
// + Trades in R / geplantes CRV) — die Rechenlogik ist nicht dupliziert:
// `computeDisciplineStats` ist bereits rein und gilt für fremde Zeilen
// unverändert.

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { trade, friendship, inviteCode, user } from '@/lib/db/schema'
import { and, asc, desc, eq, isNull, or } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { computeDisciplineStats, type TradeRow } from '@/lib/trade-stats'
import {
  generateInviteCode,
  normalizeInviteCode,
  inviteExpiry,
  isInviteExpired,
  projectFriendTrades,
  toFriendSummary,
  type FriendJournal,
  type FriendListEntry,
  type FriendSummary,
} from '@/lib/friends'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

/** Postgres „undefined table" (42P01) — Migration 0013 noch nicht angewendet. */
function isMissingTable(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { code?: string; cause?: { code?: string } }
  return e.code === '42P01' || e.cause?.code === '42P01'
}

// ---------------------------------------------------------------------------
// Interne Helfer (nicht exportiert — 'use server' erlaubt nur async Exports,
// und diese sollen ohnehin nicht als Action von außen aufrufbar sein)
// ---------------------------------------------------------------------------

/** Die angenommene Freundschaft zwischen zwei Nutzern (beide Richtungen), oder null. */
async function friendshipBetween(a: string, b: string) {
  const [row] = await db
    .select()
    .from(friendship)
    .where(
      and(
        eq(friendship.status, 'angenommen'),
        or(
          and(eq(friendship.requesterId, a), eq(friendship.addresseeId, b)),
          and(eq(friendship.requesterId, b), eq(friendship.addresseeId, a)),
        ),
      ),
    )
  return row ?? null
}

/**
 * Die eine Zugriffsprüfung für fremde Daten. Wirft, wenn `viewerId` das Journal
 * von `ownerId` nicht sehen darf. Beim Entfernen einer Freundschaft (Zeile
 * gelöscht) wirft sie ab sofort — „sofort blind", kein weiterer Zugriff.
 */
async function assertCanView(viewerId: string, ownerId: string): Promise<void> {
  if (viewerId === ownerId) return // das eigene Journal darf man immer sehen
  const fr = await friendshipBetween(viewerId, ownerId)
  if (!fr) throw new Error('Kein Zugriff auf dieses Journal.')
}

/** Betragsfreie Disziplin-Zusammenfassung über die abgeschlossenen Trades eines Nutzers. */
async function summaryFor(ownerId: string): Promise<FriendSummary> {
  const rows: TradeRow[] = await db
    .select()
    .from(trade)
    .where(and(eq(trade.userId, ownerId), eq(trade.status, 'abgeschlossen')))
    .orderBy(asc(trade.closedAt), asc(trade.id))
  // startCapital/cashflows sind für die geteilten Felder (Disziplin, Quote,
  // Erwartungswert, Streak, Regelbrüche) irrelevant — sie hängen nicht am Geld.
  // Die Geldfelder rechnet computeDisciplineStats zwar, toFriendSummary wirft
  // sie aber weg, damit keine Kontogröße nach außen gelangt.
  return toFriendSummary(computeDisciplineStats(rows, 0, []))
}

// ---------------------------------------------------------------------------
// Einladen & Einlösen
// ---------------------------------------------------------------------------

/**
 * Einen Einladungscode erzeugen (oder den noch gültigen, nicht eingelösten
 * wiederverwenden, damit wiederholtes Klicken nicht Dutzende Codes anlegt).
 */
export async function createInvite(): Promise<{ code: string; expiresAt: string }> {
  const userId = await getUserId()
  const now = new Date()

  const existing = await db
    .select()
    .from(inviteCode)
    .where(and(eq(inviteCode.userId, userId), isNull(inviteCode.usedByUserId)))
    .orderBy(desc(inviteCode.createdAt))
  const valid = existing.find((c) => !isInviteExpired(c.expiresAt, now))
  if (valid) return { code: valid.code, expiresAt: new Date(valid.expiresAt).toISOString() }

  // Kollisionsfrei anlegen — der Code ist Primärschlüssel.
  let code = generateInviteCode()
  for (let i = 0; i < 5; i++) {
    const [hit] = await db.select().from(inviteCode).where(eq(inviteCode.code, code))
    if (!hit) break
    code = generateInviteCode()
  }

  const expiresAt = inviteExpiry(now)
  await db.insert(inviteCode).values({ code, userId, expiresAt })
  return { code, expiresAt: expiresAt.toISOString() }
}

/**
 * Einen Code einlösen → daraus entsteht die gegenseitige Freundschaft. Prüft
 * Existenz, Ablauf, Einmaligkeit, dass es nicht der eigene Code ist und dass
 * noch keine Freundschaft besteht.
 */
export async function redeemInvite(rawCode: string): Promise<{ friendId: string; name: string }> {
  const userId = await getUserId()
  const code = normalizeInviteCode(rawCode)
  if (!code) throw new Error('Bitte einen Einladungscode eingeben.')

  const [inv] = await db.select().from(inviteCode).where(eq(inviteCode.code, code))
  if (!inv) throw new Error('Diesen Einladungscode gibt es nicht.')
  if (inv.usedByUserId) throw new Error('Dieser Code wurde bereits eingelöst.')
  if (isInviteExpired(inv.expiresAt)) throw new Error('Dieser Code ist abgelaufen.')
  if (inv.userId === userId) throw new Error('Du kannst deinen eigenen Code nicht einlösen.')

  if (await friendshipBetween(inv.userId, userId)) {
    throw new Error('Ihr seid bereits befreundet.')
  }

  const [owner] = await db.select().from(user).where(eq(user.id, inv.userId))
  if (!owner) throw new Error('Der Einladende existiert nicht mehr.')

  await db.insert(friendship).values({
    requesterId: inv.userId,
    addresseeId: userId,
    status: 'angenommen',
    respondedAt: new Date(),
  })
  await db.update(inviteCode).set({ usedByUserId: userId }).where(eq(inviteCode.code, code))

  revalidatePath('/friends')
  return { friendId: owner.id, name: owner.name }
}

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

/**
 * Die Freundesliste des Nutzers, jeder mit seiner betragsfreien Disziplin-
 * Zusammenfassung. Sortiert nach protokollierten Regelbrüchen absteigend — die
 * passive Accountability ist der Punkt der Etappe: Wer Regeln bricht, steht
 * oben, sichtbar beim Nachsehen (keine aktive Meldung). Tolerant gegenüber
 * fehlender Migration 0013 → leere Liste statt Absturz.
 */
export async function listFriends(): Promise<FriendListEntry[]> {
  const userId = await getUserId()

  let rows
  try {
    rows = await db
      .select()
      .from(friendship)
      .where(
        and(
          eq(friendship.status, 'angenommen'),
          or(eq(friendship.requesterId, userId), eq(friendship.addresseeId, userId)),
        ),
      )
  } catch (err) {
    if (isMissingTable(err)) return []
    throw err
  }

  const friendIds = rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId))

  const entries: FriendListEntry[] = []
  for (const fid of friendIds) {
    const [u] = await db.select().from(user).where(eq(user.id, fid))
    if (!u) continue
    entries.push({ friendId: fid, name: u.name, summary: await summaryFor(fid) })
  }

  entries.sort((a, b) => b.summary.ruleViolations - a.summary.ruleViolations)
  return entries
}

/**
 * Das teilbare Journal eines Freundes: betragsfreie Disziplin-Zusammenfassung
 * plus seine geplanten und abgeschlossenen Trades (in R / geplantem CRV). Führt
 * jeden Zugriff durch `assertCanView` — ohne angenommene Freundschaft wirft es.
 */
export async function getFriendJournal(friendId: string): Promise<FriendJournal> {
  const userId = await getUserId()
  await assertCanView(userId, friendId)

  const [u] = await db.select().from(user).where(eq(user.id, friendId))
  if (!u) throw new Error('Diesen Nutzer gibt es nicht mehr.')

  const all: TradeRow[] = await db
    .select()
    .from(trade)
    .where(eq(trade.userId, friendId))
    .orderBy(desc(trade.createdAt))

  // computeDisciplineStats erwartet die abgeschlossenen Trades chronologisch
  // (ältester zuerst) für den korrekten Streak.
  const completedAsc = all
    .filter((t) => t.status === 'abgeschlossen')
    .sort((a, b) => {
      const at = a.closedAt ? new Date(a.closedAt).getTime() : 0
      const bt = b.closedAt ? new Date(b.closedAt).getTime() : 0
      return at - bt || a.id - b.id
    })

  return {
    friendId,
    name: u.name,
    summary: toFriendSummary(computeDisciplineStats(completedAsc, 0, [])),
    // Die reine Projektion entscheidet, was sichtbar wird (geplant +
    // abgeschlossen, nie ein Betrag) — nicht diese Action.
    trades: projectFriendTrades(all),
  }
}

/**
 * Eine Freundschaft beidseitig entfernen → sofort blind: `assertCanView` wirft
 * ab dem nächsten Zugriff für beide Seiten, es bleibt nichts zwischengespeichert.
 */
export async function removeFriend(friendId: string): Promise<void> {
  const userId = await getUserId()
  await db
    .delete(friendship)
    .where(
      or(
        and(eq(friendship.requesterId, userId), eq(friendship.addresseeId, friendId)),
        and(eq(friendship.requesterId, friendId), eq(friendship.addresseeId, userId)),
      ),
    )
  revalidatePath('/friends')
}
