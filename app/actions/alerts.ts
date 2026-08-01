'use server'

// Kurs-Alerts (Etappe 3). Eigene Ebene neben den Trade-Actions: alle Zugriffe
// filtern hart auf `getUserId()` — kein bestehender Datenpfad wird aufgebohrt.
//
// Rechenlogik (Auslösen, Richtungswahl) liegt in `lib/alerts.ts` (rein, getestet);
// hier werden nur Zeilen geladen, geschrieben und der Kurs abgerufen. Typen und
// Konstanten kommen ebenfalls von dort — eine 'use server'-Datei darf keine
// exportieren.

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { priceAlert, trade, tradeTarget } from '@/lib/db/schema'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { getCachedQuote } from '@/lib/market-data/quote'
import { MarketDataError, type Market } from '@/lib/market-data'
import { createSymbolResolver } from '@/lib/market-data/lookup'
import { runAlertCheck } from '@/lib/alert-run'
import {
  directionForLevel,
  isAlertDirection,
  isAlertKind,
  isLevelReached,
  type AlertDirection,
  type AlertKind,
  type AlertView,
  type CreateAlertInput,
} from '@/lib/alerts'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

const VALID_MARKETS: readonly Market[] = [
  'aktien',
  'krypto',
  'forex',
  'rohstoffe',
  'etf',
  'optionen',
  'sonstiges',
]

type AlertRow = typeof priceAlert.$inferSelect

/** Datenbankzeile → serialisierbare Sicht für den Client. */
function toView(a: AlertRow): AlertView {
  return {
    id: a.id,
    ticker: a.ticker,
    market: a.market,
    price: a.price,
    direction: (isAlertDirection(a.direction) ? a.direction : 'above'),
    kind: (isAlertKind(a.kind) ? a.kind : 'manuell'),
    note: a.note,
    active: a.active,
    triggeredAt: a.triggeredAt ? new Date(a.triggeredAt).toISOString() : null,
    createdAt: new Date(a.createdAt).toISOString(),
    tradeId: a.tradeId,
    stockId: a.stockId,
  }
}

function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase()
}

function normalizeMarket(raw: string | null | undefined): Market {
  const m = (raw ?? 'aktien') as Market
  return VALID_MARKETS.includes(m) ? m : 'aktien'
}

/** Kurs holen, aber niemals daran scheitern — `null`, wenn er gerade nicht abrufbar ist. */
async function tryQuote(symbol: string, market: Market) {
  try {
    return await getCachedQuote(symbol, market)
  } catch (err) {
    // rate_limit / unsupported / unknown_symbol / Netz — der Aufrufer entscheidet,
    // ob das ein harter Fehler ist (Anlegen) oder still übersprungen wird (Check).
    if (err instanceof MarketDataError) return null
    return null
  }
}

// ---------------------------------------------------------------------------
// Anlegen
// ---------------------------------------------------------------------------

/**
 * Einen Alert setzen. Die Richtung wird — wenn nicht angegeben — aus dem
 * aktuellen Kurs bestimmt: ein Level über dem Kurs ist ein 'above'-Alert, eines
 * darunter 'below'. Ein Level, das der Kurs bereits erreicht hat, wird abgelehnt
 * (statt sofort auszulösen — das wäre kein „setzen und weggehen").
 */
export async function createAlert(input: CreateAlertInput): Promise<AlertView> {
  const userId = await getUserId()
  const ticker = normalizeSymbol(input.ticker)
  const market = normalizeMarket(input.market)

  if (!ticker) throw new Error('Ticker ist erforderlich.')
  if (!Number.isFinite(input.price) || input.price <= 0) {
    throw new Error('Bitte ein gültiges Kurslevel größer als 0 angeben.')
  }

  // Ueber das verknuepfte Instrument aufloesen, nicht ueber den Ticker: Ein
  // Alert auf `BTC` wuerde sonst gegen ein fremdes Papier geprueft.
  const resolveSymbol = await createSymbolResolver(userId)
  const quote = await tryQuote(resolveSymbol(ticker, input.stockId ?? null), market)

  let direction: AlertDirection
  if (isAlertDirection(input.direction)) {
    direction = input.direction
  } else {
    if (!quote) {
      throw new Error(
        'Kurs gerade nicht abrufbar — bitte die Richtung (über/unter) selbst angeben oder später erneut versuchen.',
      )
    }
    const derived = directionForLevel(input.price, quote.price)
    if (!derived) {
      throw new Error('Das Level entspricht dem aktuellen Kurs — bitte etwas darüber oder darunter wählen.')
    }
    direction = derived
  }

  // Bereits erfüllt? Nur ablehnen, wenn wir den Kurs tatsächlich kennen.
  if (quote && isLevelReached(direction, input.price, quote.price)) {
    throw new Error(
      `Der Kurs (${quote.price}) hat dieses Level bereits erreicht — bitte ein Level auf der noch offenen Seite wählen.`,
    )
  }

  const kind: AlertKind = isAlertKind(input.kind) ? input.kind : 'manuell'

  const [row] = await db
    .insert(priceAlert)
    .values({
      userId,
      stockId: input.stockId ?? null,
      tradeId: input.tradeId ?? null,
      ticker,
      market,
      price: input.price,
      direction,
      kind,
      note: input.note?.trim() || null,
    })
    .returning()

  revalidatePath('/')
  return toView(row)
}

/**
 * Aus einem Trade-Plan die Alerts ableiten: Stop erreicht, jedes Ziel erreicht
 * und — sofern ein aktueller Kurs vorliegt — Einstieg erreicht. Genau die Punkte,
 * an denen ein disziplinierter Trader etwas tun muss.
 *
 * Hat der Trade Teilziele (Etappe 13), bekommt JEDE Stufe ihren eigenen Alert.
 * Genau dafür sind sie da: Die Stufe steht fest, also soll man sie nicht
 * bewachen müssen — „setzen und weggehen". Doppelte werden dabei über das
 * Preis-Level erkannt, nicht mehr allein über die Art; sonst hätte ein Trade
 * weiterhin nur einen einzigen Ziel-Alert.
 *
 * Richtung je Level aus der Geometrie: Bezug ist der aktuelle Kurs, ersatzweise
 * der Einstieg. Ohne Kurs ist die Einstiegs-Richtung nicht bestimmbar (Level ==
 * Bezug) und wird ausgelassen — Stop und Ziel liegen dagegen immer eindeutig auf
 * je einer Seite des Einstiegs. Bereits erfüllte Level (Kurs schon jenseits) und
 * bereits vorhandene Alerts derselben Art werden übersprungen, damit ein
 * erneuter Aufruf nichts doppelt.
 */
export async function createPlanAlerts(
  tradeId: number,
  // Etappe 14: Welche Arten gesetzt werden sollen. Ohne Angabe alle — so
  // verhalten sich alle bisherigen Aufrufer unverändert.
  //
  // Der Ablauf ist bewusst zweistufig: Beim ANLEGEN wird nur der Einstieg
  // geweckt, denn Stop und Ziel gehören zu einer Position, die es noch nicht
  // gibt. Ein „Stop erreicht" ohne Position wäre eine Meldung über nichts — und
  // ein Warnsystem verliert seine Wirkung in dem Moment, in dem es anfängt,
  // Belangloses zu melden. Beim AKTIVIEREN kommen Stop und Ziele dazu.
  opts?: { kinds?: AlertKind[] },
): Promise<{ created: number }> {
  const userId = await getUserId()
  const [t] = await db
    .select()
    .from(trade)
    .where(and(eq(trade.id, tradeId), eq(trade.userId, userId)))
  if (!t) throw new Error('Trade nicht gefunden.')

  // Wer die Wecker für diesen Trade abgeschaltet hat, bekommt auch dann keine,
  // wenn ein automatischer Weg sie anlegen würde.
  if (!t.alertsEnabled) return { created: 0 }

  const resolvePlanSymbol = await createSymbolResolver(userId)
  const quote = await tryQuote(
    resolvePlanSymbol(t.ticker, t.stockId),
    t.market as Market,
  )
  const reference = quote?.price ?? t.entryPrice

  // Bereits gesetzte, noch aktive Plan-Alerts dieses Trades — nicht doppeln.
  const existing = await db
    .select({ kind: priceAlert.kind, price: priceAlert.price })
    .from(priceAlert)
    .where(
      and(
        eq(priceAlert.userId, userId),
        eq(priceAlert.tradeId, tradeId),
        eq(priceAlert.active, true),
      ),
    )
  // Schlüssel ist Art UND Level: Ein Trade mit drei Zielstufen hat drei
  // Ziel-Alerts, und keiner davon darf den anderen als „schon da" verdrängen.
  const already = new Set(existing.map((e) => `${e.kind}@${e.price}`))

  // Teilziele lösen den einen Ziel-Alert ab; ohne sie bleibt es beim Feld.
  const stufen = await db
    .select({ price: tradeTarget.price, executedAt: tradeTarget.executedAt })
    .from(tradeTarget)
    .where(and(eq(tradeTarget.tradeId, tradeId), eq(tradeTarget.userId, userId)))
    .orderBy(asc(tradeTarget.sortOrder))

  const ziele =
    stufen.length > 0
      ? // Erreichte Stufen brauchen keinen Wecker mehr.
        stufen.filter((s) => s.executedAt == null).map((s) => s.price)
      : t.takeProfit != null
        ? [t.takeProfit]
        : []

  const alleLevels: { kind: AlertKind; level: number | null }[] = [
    { kind: 'einstieg', level: t.entryPrice },
    { kind: 'stop', level: t.stopLoss },
    ...ziele.map((p) => ({ kind: 'ziel' as AlertKind, level: p })),
  ]
  const gewuenscht = opts?.kinds
  const levels = gewuenscht ? alleLevels.filter((l) => gewuenscht.includes(l.kind)) : alleLevels

  const rows: (typeof priceAlert.$inferInsert)[] = []
  for (const { kind, level } of levels) {
    if (level == null || already.has(`${kind}@${level}`)) continue
    const direction = directionForLevel(level, reference)
    if (!direction) continue // Level == Bezug (z. B. Einstieg ohne Kurs) → auslassen
    // Schon erfüllt? Dann wäre der Alert sofort ausgelöst — überspringen.
    if (quote && isLevelReached(direction, level, quote.price)) continue
    rows.push({
      userId,
      stockId: t.stockId ?? null,
      tradeId: t.id,
      ticker: t.ticker,
      market: t.market,
      price: level,
      direction,
      kind,
      note: null,
    })
  }

  if (rows.length) {
    await db.insert(priceAlert).values(rows)
    revalidatePath('/')
  }
  return { created: rows.length }
}

/**
 * Wecker für diesen Trade an- oder abschalten (Etappe 14).
 *
 * Abschalten räumt die noch offenen Plan-Alerts gleich mit weg — ein Schalter,
 * der auf „aus" steht, während weiter Meldungen kommen, wäre schlimmer als kein
 * Schalter. Bereits ausgelöste bleiben stehen: Sie sind Geschichte, keine
 * Wartende.
 *
 * Anschalten setzt die Wecker passend zum Stand des Trades: bei einem geplanten
 * nur den Einstieg, bei einem laufenden Stop und Ziele.
 */
export async function setTradeAlertsEnabled(
  tradeId: number,
  enabled: boolean,
): Promise<{ created: number; removed: number }> {
  const userId = await getUserId()
  const [t] = await db
    .select()
    .from(trade)
    .where(and(eq(trade.id, tradeId), eq(trade.userId, userId)))
  if (!t) throw new Error('Trade nicht gefunden.')

  await db
    .update(trade)
    .set({ alertsEnabled: enabled })
    .where(and(eq(trade.id, tradeId), eq(trade.userId, userId)))

  if (!enabled) {
    const removed = await db
      .delete(priceAlert)
      .where(
        and(
          eq(priceAlert.userId, userId),
          eq(priceAlert.tradeId, tradeId),
          isNull(priceAlert.triggeredAt),
        ),
      )
      .returning({ id: priceAlert.id })
    revalidatePath('/')
    revalidatePath(`/trades/${tradeId}`)
    return { created: 0, removed: removed.length }
  }

  const { created } = await createPlanAlerts(tradeId, { kinds: kindsForStatus(t.status) })
  revalidatePath(`/trades/${tradeId}`)
  return { created, removed: 0 }
}

/**
 * Welche Wecker zum Stand eines Trades passen.
 *
 * Geplant: nur der Einstieg — Stop und Ziel gehören zu einer Position, die es
 * noch nicht gibt. Aktiv: Stop und Ziele; der Einstieg ist Geschichte.
 * Abgeschlossen oder abgebrochen: keine.
 */
function kindsForStatus(status: string): AlertKind[] {
  if (status === 'geplant') return ['einstieg']
  if (status === 'aktiv') return ['stop', 'ziel']
  return []
}

/**
 * Wecker für ALLE offenen Pläne nachrüsten (Etappe 14).
 *
 * Für den Altbestand: Trades, die vor dieser Etappe geplant wurden, haben keinen
 * Einstiegs-Wecker. Nachgerüstet wird nur auf ausdrücklichen Knopfdruck — ein
 * Schwung Alerts, den niemand gesetzt hat, wäre dieselbe Überrumpelung wie eine
 * Mail-Lawine, nur eine Ebene früher.
 *
 * `createPlanAlerts` überspringt von sich aus, was schon existiert oder bereits
 * erfüllt ist; der Aufruf ist deshalb beliebig oft wiederholbar.
 */
export async function createMissingPlanAlerts(): Promise<{
  trades: number
  created: number
}> {
  const userId = await getUserId()
  const offen = await db
    .select({ id: trade.id, status: trade.status })
    .from(trade)
    .where(
      and(
        eq(trade.userId, userId),
        eq(trade.alertsEnabled, true),
        inArray(trade.status, ['geplant', 'aktiv']),
      ),
    )

  let created = 0
  let betroffen = 0
  for (const t of offen) {
    const kinds = kindsForStatus(t.status)
    if (kinds.length === 0) continue
    try {
      const r = await createPlanAlerts(t.id, { kinds })
      if (r.created > 0) {
        created += r.created
        betroffen += 1
      }
    } catch {
      // Ein Trade ohne abrufbaren Kurs bekommt keinen Einstiegs-Wecker — das
      // darf den Lauf über die übrigen nicht abbrechen.
    }
  }

  revalidatePath('/')
  return { trades: betroffen, created }
}

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

/**
 * Alle sichtbaren Alerts (aktiv & nicht verworfen) — sowohl offene als auch
 * ausgelöste, die noch nicht weggeräumt sind. Ausgelöste zuerst, dann nach
 * Anlage-Zeit. Verworfene (dismissed) tauchen nicht auf.
 */
export async function listAlerts(): Promise<AlertView[]> {
  const userId = await getUserId()
  const rows = await db
    .select()
    .from(priceAlert)
    .where(and(eq(priceAlert.userId, userId), eq(priceAlert.active, true)))
    .orderBy(desc(priceAlert.triggeredAt), desc(priceAlert.createdAt))
  return rows.map(toView)
}

// ---------------------------------------------------------------------------
// Abgleich (der Kern)
// ---------------------------------------------------------------------------

/**
 * Prüft die offenen Alerts des angemeldeten Nutzers und gibt die NEU
 * ausgelösten zurück, damit der Client eine Benachrichtigung zeigen kann.
 *
 * Der eigentliche Ablauf steht seit Etappe 14 in `lib/alert-run.ts` und wird von
 * der Cron-Route mit denselben Regeln für alle Nutzer angestoßen. Zwei
 * Auslöse-Implementierungen nebeneinander wären zwei Wahrheiten darüber, wann
 * ein Level erreicht ist — deshalb delegiert diese Action nur noch.
 *
 * `notify: false`: Im offenen Tab meldet sich der `AlertWatcher` bereits selbst;
 * eine zusätzliche Mail für denselben Alert wäre doppelt. Was der Browser
 * auslöst, aber nicht meldet, schickt der nächste Cron-Lauf hinterher — er sucht
 * alles mit `triggeredAt != null AND notifiedAt IS NULL`.
 */
export async function checkAlerts(): Promise<AlertView[]> {
  const userId = await getUserId()
  const report = await runAlertCheck({ userId, trigger: 'client', notify: false })
  if (report.triggeredIds.length === 0) return []

  const rows = await db
    .select()
    .from(priceAlert)
    .where(and(eq(priceAlert.userId, userId), inArray(priceAlert.id, report.triggeredIds)))
  return rows.map(toView)
}

// ---------------------------------------------------------------------------
// Verwalten
// ---------------------------------------------------------------------------

/** Alert wegräumen (aus der Übersicht entfernen) — Historie bleibt als Zeile erhalten. */
export async function dismissAlert(id: number): Promise<void> {
  const userId = await getUserId()
  await db
    .update(priceAlert)
    .set({ active: false })
    .where(and(eq(priceAlert.id, id), eq(priceAlert.userId, userId)))
  revalidatePath('/')
}

/** Alert endgültig löschen. */
export async function deleteAlert(id: number): Promise<void> {
  const userId = await getUserId()
  await db
    .delete(priceAlert)
    .where(and(eq(priceAlert.id, id), eq(priceAlert.userId, userId)))
  revalidatePath('/')
}
