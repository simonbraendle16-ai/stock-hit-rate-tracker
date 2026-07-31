'use server'

// Depot-Aktionen (Etappe 12) — die anrufbare Oberfläche zu `lib/portfolio-*.ts`.
//
// Diese Datei hält bewusst KEINE Logik: Die Regeln stehen rein und getestet in
// `lib/portfolio-scope.ts`, der Zugriffsweg in `lib/portfolio-context.ts`. Hier
// wird nur authentifiziert, geprüft, geschrieben und neu gerendert.
//
// 'use server' verlangt: ausschließlich async Exporte. Typen und Konstanten
// gehören deshalb nach lib/ — sonst bricht der Build mit „A 'use server' file can
// only export async functions".

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { portfolio, trade } from '@/lib/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import {
  checkArchivable,
  checkDeletable,
  checkKindChange,
  checkMove,
  checkPortfolioName,
  moveEffect,
  normalizePortfolioKind,
  parseScope,
  type PortfolioRow,
} from '@/lib/portfolio-scope'
import {
  countPortfolioContents,
  ensurePortfolios,
  kindOf,
  loadOwnedPortfolio,
  loadScopeContext,
  schreibeScope,
  type ScopeContext,
} from '@/lib/portfolio-context'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

/**
 * Jede Seite, die Zahlen zeigt, ruft das hier auf — und filtert danach über
 * `portfolioIds`. Wer stattdessen selbst eine Trade-Abfrage ohne diesen Kontext
 * baut, mischt wieder Echtgeld und Übung.
 */
export async function getScopeContext(): Promise<ScopeContext> {
  return loadScopeContext(await getUserId())
}

export async function listPortfolios(): Promise<PortfolioRow[]> {
  return ensurePortfolios(await getUserId())
}

/** Die aktive Auswahl umstellen. `raw` ist 'echtgeld' oder 'depot:<id>'. */
export async function setActiveScope(raw: string): Promise<void> {
  const userId = await getUserId()
  const scope = parseScope(raw)

  // Ein Verweis auf ein fremdes Depot wird nicht gespeichert. `parseScope` prüft
  // nur die Form, nicht die Eigentümerschaft — das muss hier passieren.
  if (scope.type === 'depot') {
    await loadOwnedPortfolio(userId, scope.portfolioId)
  }

  await schreibeScope(userId, scope)
  revalidateAll()
}

function clampPositive(v: number, fallback: number): number {
  return Number.isFinite(v) && v > 0 ? v : fallback
}

/** Gebühr darf 0 sein (gebührenfreier Broker), aber nie negativ. */
function clampFee(v: number | undefined, fallback: number): number {
  return v != null && Number.isFinite(v) && v >= 0 ? v : fallback
}

export async function createPortfolio(input: {
  name: string
  kind: string
  startCapital: number
  defaultFeeEntry?: number
  defaultFeeExit?: number
}): Promise<{ id: number }> {
  const userId = await getUserId()
  const bestand = await ensurePortfolios(userId)

  const pruefung = checkPortfolioName(input.name, bestand)
  if (!pruefung.ok) throw new Error(pruefung.reason)

  const kind = normalizePortfolioKind(input.kind)
  // Im Demo-Depot sind Gebühren immer 0 — Papier kostet nichts (`tradeFees`).
  // Das ist keine Vorbelegung, die man überschreiben kann, sondern die Regel.
  const istDemo = kind === 'demo'

  const [row] = await db
    .insert(portfolio)
    .values({
      userId,
      name: input.name.trim(),
      kind,
      startCapital: clampPositive(input.startCapital, 10000),
      defaultFeeEntry: istDemo ? 0 : clampFee(input.defaultFeeEntry, 9),
      defaultFeeExit: istDemo ? 0 : clampFee(input.defaultFeeExit, 9),
      sortOrder: bestand.length,
    })
    .returning({ id: portfolio.id })

  revalidateAll()
  return { id: row.id }
}

export async function renamePortfolio(id: number, name: string): Promise<void> {
  const userId = await getUserId()
  const bestand = await ensurePortfolios(userId)
  await loadOwnedPortfolio(userId, id)

  const pruefung = checkPortfolioName(name, bestand, id)
  if (!pruefung.ok) throw new Error(pruefung.reason)

  await db
    .update(portfolio)
    .set({ name: name.trim() })
    .where(and(eq(portfolio.id, id), eq(portfolio.userId, userId)))
  revalidateAll()
}

/**
 * Startkapital und Gebühren eines Depots.
 *
 * Beim Demo-Depot bleiben die Gebühren 0; das Startkapital ist dort das
 * Papier-Startkapital und ausdrücklich einstellbar — nur so lässt sich die Übung
 * auf dieselbe Kontogröße stellen wie der Ernst, und nur dann sind
 * Prozentzahlen vergleichbar.
 */
export async function updatePortfolioMoney(input: {
  id: number
  startCapital: number
  defaultFeeEntry?: number
  defaultFeeExit?: number
}): Promise<void> {
  const userId = await getUserId()
  const p = await loadOwnedPortfolio(userId, input.id)
  const istDemo = kindOf(p) === 'demo'

  await db
    .update(portfolio)
    .set({
      startCapital: clampPositive(input.startCapital, p.startCapital),
      defaultFeeEntry: istDemo ? 0 : clampFee(input.defaultFeeEntry, p.defaultFeeEntry),
      defaultFeeExit: istDemo ? 0 : clampFee(input.defaultFeeExit, p.defaultFeeExit),
    })
    .where(and(eq(portfolio.id, input.id), eq(portfolio.userId, userId)))
  revalidateAll()
}

/**
 * Die Art eines Depots ändern — nur solange kein Trade daranhängt.
 *
 * Bei einem befüllten Depot würde das die Bilanz rückwirkend umschreiben: Aus
 * bezahlten Gebühren würde Papiergeld, aus realem Verlust Übung. Die Regel steht
 * in `checkKindChange`, damit Serveraktion und Oberfläche denselben Satz sagen.
 */
export async function setPortfolioKind(id: number, kind: string): Promise<void> {
  const userId = await getUserId()
  // Wirft, wenn das Depot nicht dem Nutzer gehört — das ist hier die Prüfung.
  await loadOwnedPortfolio(userId, id)
  const { trades } = await countPortfolioContents(userId, id)

  const pruefung = checkKindChange(trades)
  if (!pruefung.ok) throw new Error(pruefung.reason)

  const neu = normalizePortfolioKind(kind)
  await db
    .update(portfolio)
    .set({
      kind: neu,
      // Wird ein leeres Depot zum Demo-Depot, fallen die Gebühren weg.
      ...(neu === 'demo' ? { defaultFeeEntry: 0, defaultFeeExit: 0 } : {}),
    })
    .where(and(eq(portfolio.id, id), eq(portfolio.userId, userId)))

  revalidateAll()
}

export async function archivePortfolio(id: number): Promise<void> {
  const userId = await getUserId()
  const bestand = await ensurePortfolios(userId)
  const p = await loadOwnedPortfolio(userId, id)

  const pruefung = checkArchivable(p, bestand)
  if (!pruefung.ok) throw new Error(pruefung.reason)

  await db
    .update(portfolio)
    .set({ archivedAt: new Date() })
    .where(and(eq(portfolio.id, id), eq(portfolio.userId, userId)))
  revalidateAll()
}

export async function unarchivePortfolio(id: number): Promise<void> {
  const userId = await getUserId()
  const bestand = await ensurePortfolios(userId)
  const p = await loadOwnedPortfolio(userId, id)

  // Beim Zurückholen greift die Namensprüfung erneut: In der Zwischenzeit kann
  // ein neues Depot denselben Namen bekommen haben (der eindeutige Index aus
  // Migration 0022 gilt nur für nicht archivierte).
  const pruefung = checkPortfolioName(p.name, bestand, id)
  if (!pruefung.ok) {
    throw new Error(
      `${pruefung.reason} Benenne das archivierte Depot um, bevor du es zurückholst.`,
    )
  }

  await db
    .update(portfolio)
    .set({ archivedAt: null })
    .where(and(eq(portfolio.id, id), eq(portfolio.userId, userId)))
  revalidateAll()
}

/**
 * Ein Depot löschen — nur wenn es leer ist.
 *
 * Ein befülltes Depot wird archiviert, nicht gelöscht: Der Trade verlöre sonst
 * seine Handelsart und damit jede gültige Bilanz. Die Datenbank setzt das
 * zusätzlich mit `ON DELETE RESTRICT` durch (Migration 0022) — diese Prüfung
 * liefert nur den verständlichen Satz davor.
 */
export async function deletePortfolio(id: number): Promise<void> {
  const userId = await getUserId()
  const bestand = await ensurePortfolios(userId)
  await loadOwnedPortfolio(userId, id)

  const { trades, cashflows } = await countPortfolioContents(userId, id)
  const loeschbar = checkDeletable(trades, cashflows)
  if (!loeschbar.ok) throw new Error(loeschbar.reason)

  // Auch ein LEERES Depot darf nicht das letzte Echtgeld-Depot sein — sonst
  // gäbe es keinen Ort mehr für einen echten Trade.
  const p = bestand.find((x) => x.id === id)
  if (p) {
    const uebrig = bestand.filter(
      (x) => x.id !== id && kindOf(x) === 'echtgeld' && x.archivedAt == null,
    )
    if (kindOf(p) === 'echtgeld' && p.archivedAt == null && uebrig.length === 0) {
      throw new Error(
        'Das ist dein letztes aktives Echtgeld-Depot — ohne es hättest du keinen Ort für echte Trades.',
      )
    }
  }

  await db.delete(portfolio).where(and(eq(portfolio.id, id), eq(portfolio.userId, userId)))
  revalidateAll()
}

/**
 * Einen Trade in ein anderes Depot buchen.
 *
 * Kreuzt der Wechsel die Grenze Echtgeld ↔ Demo, wandert `tradedWithMoney` mit —
 * das ist der einzige Ort außer `createTrade`, an dem diese Spalte geschrieben
 * wird. Die Gebühren bleiben ausdrücklich gespeichert: `tradeFees` und
 * `settlePosition` ignorieren sie bei Demo ohnehin, und ein Nullsetzen würde das
 * Umbuchen unumkehrbar machen (siehe `moveEffect`).
 *
 * Zurückgegeben wird, was sich geändert hat — die Oberfläche zeigt es an, statt
 * die Folgen stillschweigend hinzunehmen.
 */
export async function moveTrade(
  tradeId: number,
  portfolioId: number,
): Promise<{ crossesKind: boolean; tradedWithMoney: boolean }> {
  const userId = await getUserId()

  const [t] = await db
    .select({ id: trade.id, portfolioId: trade.portfolioId })
    .from(trade)
    .where(and(eq(trade.id, tradeId), eq(trade.userId, userId)))
  if (!t) throw new Error('Diesen Trade gibt es nicht.')

  const ziel = await loadOwnedPortfolio(userId, portfolioId)
  const pruefung = checkMove(ziel, t.portfolioId)
  if (!pruefung.ok) throw new Error(pruefung.reason)

  const quelle = await loadOwnedPortfolio(userId, t.portfolioId)
  const effekt = moveEffect(kindOf(quelle), kindOf(ziel))

  await db
    .update(trade)
    .set({ portfolioId, tradedWithMoney: effekt.tradedWithMoney })
    .where(and(eq(trade.id, tradeId), eq(trade.userId, userId)))

  revalidateAll()
  revalidatePath(`/trades/${tradeId}`)
  return { crossesKind: effekt.crossesKind, tradedWithMoney: effekt.tradedWithMoney }
}

/**
 * Wie viele Trades liegen in welchem Depot — für die Verwaltung in den
 * Einstellungen (dort entscheidet die Zahl, ob gelöscht oder archiviert wird).
 */
export async function getPortfolioUsage(): Promise<
  { portfolioId: number; trades: number; open: number }[]
> {
  const userId = await getUserId()
  const rows = await db
    .select({
      portfolioId: trade.portfolioId,
      trades: sql<number>`count(*)::int`,
      open: sql<number>`count(*) FILTER (WHERE ${trade.status} IN ('geplant', 'aktiv'))::int`,
    })
    .from(trade)
    .where(eq(trade.userId, userId))
    .groupBy(trade.portfolioId)
  return rows
}

function revalidateAll(): void {
  revalidatePath('/')
  revalidatePath('/tracking')
  revalidatePath('/settings')
  revalidatePath('/trades')
  revalidatePath('/trades/new')
  revalidatePath('/analysis')
}
