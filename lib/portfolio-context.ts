// Der Zugriffsweg zu den Depots (Etappe 12) — das Gegenstück zur reinen Logik in
// `lib/portfolio-scope.ts`.
//
// Hier steht die EINE Antwort auf „welche Trades sieht die Auswertung jetzt".
// Vorher entschieden das sechzehn Abfragen in `app/actions/trades.ts` je für sich
// — und fünfzehn davon entschieden es falsch, weil sie den Papierhandel
// mitzählten. Wer künftig irgendwo Trades für eine Kennzahl lädt, holt die
// Bedingung hier und baut sie nicht daneben nach.
//
// Bewusst OHNE 'use server': Eine solche Datei darf ausschließlich async
// Funktionen exportieren (Turbopack behandelt jeden Export als Server Action),
// und diese hier exportiert auch Typen. Die anrufbaren Aktionen für die
// Oberfläche stehen in `app/actions/portfolios.ts`; `userId` kommt immer von
// dort, damit die Authentifizierung an einer Stelle bleibt.

import { db } from '@/lib/db'
import { cashflow, portfolio, trade, userSettings } from '@/lib/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  DEFAULT_SCOPE,
  formatScope,
  isPaperScope,
  normalizePortfolioKind,
  resolveScope,
  scopePortfolioIds,
  type PortfolioKind,
  type PortfolioRow,
  type Scope,
} from '@/lib/portfolio-scope'
import type { CashflowRow } from '@/lib/trade-stats'

/** Vorgabewerte eines neu angelegten Kontos — dieselben wie in Migration 0022. */
const NEUES_KONTO = {
  startCapital: 10000,
  defaultFeeEntry: 9,
  defaultFeeExit: 9,
}

/**
 * Alles, was eine Seite über die aktive Auswahl wissen muss — in EINEM Objekt und
 * aus EINER Abfragefolge.
 *
 * Vier eigene Ladewege wären vier Gelegenheiten, dieselbe Kennzahl verschieden zu
 * rechnen (dieselbe Begründung wie bei `getInstrumentCards`, Etappe 10).
 */
export type ScopeContext = {
  scope: Scope
  /** Alle Depots des Nutzers, auch archivierte — sortiert wie im Umschalter. */
  portfolios: PortfolioRow[]
  /** Die Depots, deren Trades in dieser Auswahl gelten. Kann leer sein. */
  portfolioIds: number[]
  /** Genau ein Depot gewählt? Dann steht es hier; beim Aggregat `null`. */
  active: PortfolioRow | null
  /**
   * Rechnet diese Auswahl mit Papiergeld? Steuert die PAPIERGELD-Kennzeichnung —
   * die einzige Stelle, die darüber entscheidet.
   */
  isPaper: boolean
  /** Startkapital der Auswahl; beim Aggregat die Summe über die Depots. */
  startCapital: number
  /** Gebühren-Vorbelegung für neue Trades in dieser Auswahl. */
  defaultFeeEntry: number
  defaultFeeExit: number
}

function sortiert(rows: PortfolioRow[]): PortfolioRow[] {
  return [...rows].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id - b.id,
  )
}

/**
 * Die Depots eines Nutzers laden — und beim ersten Zugriff anlegen, falls es noch
 * keine gibt.
 *
 * Nötig für jedes Konto, das NACH Migration 0022 entsteht: Der Backfill dort
 * erreichte nur die damals vorhandenen Nutzer. Ohne diese Selbstheilung stünde
 * ein neu registriertes Konto ohne Depot da und könnte keinen Trade anlegen.
 *
 * Das Demo-Depot entsteht sofort mit, auch ungefragt: Der Übungsweg soll
 * bereitstehen, BEVOR man ihn braucht — sonst übt man wieder im Echtgeld-Depot,
 * und genau das war der Fehler, der zu dieser Etappe geführt hat.
 */
export async function ensurePortfolios(userId: string): Promise<PortfolioRow[]> {
  const vorhanden = await db.select().from(portfolio).where(eq(portfolio.userId, userId))
  if (vorhanden.length > 0) return sortiert(vorhanden)

  await db
    .insert(portfolio)
    .values([
      {
        userId,
        name: 'Hauptdepot',
        kind: 'echtgeld',
        startCapital: NEUES_KONTO.startCapital,
        defaultFeeEntry: NEUES_KONTO.defaultFeeEntry,
        defaultFeeExit: NEUES_KONTO.defaultFeeExit,
        sortOrder: 0,
      },
      {
        userId,
        name: 'Demo',
        kind: 'demo',
        // Dasselbe Startkapital wie im Echtgeld-Depot: nur dann sind
        // Prozentzahlen zwischen Übung und Ernst vergleichbar. Gebühren 0 —
        // Papier kostet nichts.
        startCapital: NEUES_KONTO.startCapital,
        defaultFeeEntry: 0,
        defaultFeeExit: 0,
        sortOrder: 1,
      },
    ])
    // Zwei Aufrufe gleichzeitig (paralleles Rendern zweier Server-Komponenten)
    // dürfen nicht zu vier Depots führen; der eindeutige Namensindex aus
    // Migration 0022 fängt das ab, und wir schlucken den Konflikt.
    .onConflictDoNothing()

  return sortiert(await db.select().from(portfolio).where(eq(portfolio.userId, userId)))
}

/** Der gespeicherte Auswahl-Text; fehlt die Einstellungszeile, gilt das Aggregat. */
async function ladeGespeichertenScope(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ activeScope: userSettings.activeScope })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
  return row?.activeScope ?? null
}

/**
 * Die aktive Auswahl samt allem, was daran hängt.
 *
 * Heilt einen Verweis auf ein Depot, das es nicht mehr gibt, und schreibt die
 * Korrektur zurück — sonst sähe der Nutzer bei jedem Aufruf eine leere Seite,
 * ohne zu erfahren, warum.
 */
export async function loadScopeContext(userId: string): Promise<ScopeContext> {
  const portfolios = await ensurePortfolios(userId)
  const gespeichert = await ladeGespeichertenScope(userId)
  const { scope, changed } = resolveScope(gespeichert, portfolios)

  if (changed) {
    await schreibeScope(userId, scope)
  }

  const portfolioIds = scopePortfolioIds(scope, portfolios)
  const active =
    scope.type === 'depot'
      ? (portfolios.find((p) => p.id === scope.portfolioId) ?? null)
      : null

  // Startkapital der Auswahl. Beim Aggregat die Summe der beteiligten Depots —
  // die Rendite muss gegen das Geld messen, das tatsächlich in DIESER Auswahl
  // steckt, nicht gegen einen kontoweiten Wert.
  const beteiligt = portfolios.filter((p) => portfolioIds.includes(p.id))
  const startCapital = beteiligt.reduce((acc, p) => acc + p.startCapital, 0)

  // Gebühren: bei einem einzelnen Depot dessen Vorbelegung, beim Aggregat die des
  // ersten beteiligten Depots (nur eine Formular-Vorbelegung, keine Kennzahl).
  const gebuehrenQuelle = active ?? beteiligt[0] ?? null

  return {
    scope,
    portfolios,
    portfolioIds,
    active,
    isPaper: isPaperScope(scope, portfolios),
    startCapital,
    defaultFeeEntry: gebuehrenQuelle?.defaultFeeEntry ?? NEUES_KONTO.defaultFeeEntry,
    defaultFeeExit: gebuehrenQuelle?.defaultFeeExit ?? NEUES_KONTO.defaultFeeExit,
  }
}

export async function schreibeScope(userId: string, scope: Scope): Promise<void> {
  const activeScope = formatScope(scope)
  await db
    .insert(userSettings)
    .values({ userId, activeScope })
    .onConflictDoUpdate({ target: userSettings.userId, set: { activeScope } })
}

/**
 * Die Bedingung, mit der JEDE Auswertung ihre Trades lädt.
 *
 * Ist die Auswahl leer (etwa ein Konto, dessen einziges Echtgeld-Depot archiviert
 * wurde), liefert dies bewusst eine Bedingung, die NICHTS trifft — nicht
 * „alles". Ein leerer Filter, der stillschweigend zu „alle Trades" wird, wäre
 * genau der Fehler, gegen den diese Etappe gebaut ist.
 */
export function tradeScopeWhere(userId: string, portfolioIds: number[]) {
  if (portfolioIds.length === 0) {
    return and(eq(trade.userId, userId), sql`false`)
  }
  return and(eq(trade.userId, userId), inArray(trade.portfolioId, portfolioIds))
}

/** Dasselbe für die Ein- und Auszahlungen. */
export function cashflowScopeWhere(userId: string, portfolioIds: number[]) {
  if (portfolioIds.length === 0) {
    return and(eq(cashflow.userId, userId), sql`false`)
  }
  return and(eq(cashflow.userId, userId), inArray(cashflow.portfolioId, portfolioIds))
}

/**
 * Die Ein- und Auszahlungen der Auswahl — in der Form, die `lib/trade-stats.ts`
 * erwartet. Liegt bewusst hier und nicht in `app/actions/cashflows.ts`, damit
 * jede Kennzahl Kapital und Zahlungen aus derselben Auswahl bezieht.
 */
export async function loadScopedCashflows(
  userId: string,
  portfolioIds: number[],
): Promise<CashflowRow[]> {
  if (portfolioIds.length === 0) return []
  const rows = await db
    .select({
      amount: cashflow.amount,
      kind: cashflow.kind,
      occurredAt: cashflow.occurredAt,
      note: cashflow.note,
    })
    .from(cashflow)
    .where(cashflowScopeWhere(userId, portfolioIds))
  return rows.map((r) => ({
    amount: r.amount,
    kind: r.kind === 'auszahlung' ? 'auszahlung' : 'einzahlung',
    occurredAt: r.occurredAt,
    note: r.note,
  }))
}

/**
 * Das Depot eines Nutzers laden und dabei die Eigentümerschaft prüfen.
 *
 * Jede schreibende Aktion geht hier durch: Eine `portfolioId` aus dem Browser ist
 * eine Behauptung, keine Tatsache.
 */
export async function loadOwnedPortfolio(
  userId: string,
  portfolioId: number,
): Promise<PortfolioRow> {
  const [row] = await db
    .select()
    .from(portfolio)
    .where(and(eq(portfolio.id, portfolioId), eq(portfolio.userId, userId)))
  if (!row) throw new Error('Dieses Depot gibt es nicht.')
  return row
}

/** Die Art eines Depots — die Quelle für `trade.tradedWithMoney`. */
export function kindOf(p: PortfolioRow): PortfolioKind {
  return normalizePortfolioKind(p.kind)
}

/** Zählt, was an einem Depot hängt — Grundlage für Löschen und Art-Änderung. */
export async function countPortfolioContents(
  userId: string,
  portfolioId: number,
): Promise<{ trades: number; cashflows: number }> {
  const [t] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(trade)
    .where(and(eq(trade.userId, userId), eq(trade.portfolioId, portfolioId)))
  const [c] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cashflow)
    .where(and(eq(cashflow.userId, userId), eq(cashflow.portfolioId, portfolioId)))
  return { trades: t?.n ?? 0, cashflows: c?.n ?? 0 }
}

/**
 * Der Scope, über den mit Freunden geteilt wird: immer das Echtgeld-Aggregat.
 *
 * Ausdrücklich NICHT die aktive Auswahl des Betrachters — sonst hinge die
 * Disziplinquote, die ein Freund sieht, davon ab, welches Depot man selbst
 * gerade offen hat. Und niemals ein Demo-Depot: Eine geteilte Quote, die
 * Übungstrades enthält, ist gegenüber anderen keine ehrliche Zahl.
 */
export async function loadRealMoneyScope(
  userId: string,
): Promise<{ portfolioIds: number[]; startCapital: number }> {
  const portfolios = await ensurePortfolios(userId)
  const ids = scopePortfolioIds(DEFAULT_SCOPE, portfolios)
  const startCapital = portfolios
    .filter((p) => ids.includes(p.id))
    .reduce((acc, p) => acc + p.startCapital, 0)
  return { portfolioIds: ids, startCapital }
}
