import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { quoteSnapshot, stock } from '@/lib/db/schema'
import { Market, MarketDataError } from '@/lib/market-data'
import { getCachedCandles } from '@/lib/market-data/cached'
import { refreshQuotesIfStale } from '@/lib/market-data/sync'
import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

/**
 * Ein Eintrag je Instrument:
 * - ok:         Kurs + Tagesänderung (immer aus dem Kursspeicher) und, sofern
 *               vorhanden, der Verlauf für die Sparkline
 * - unresolved: Dem Instrument ist noch kein Anbieter-Symbol zugeordnet oder die
 *               Zuordnung ist unklar — die Watchlist zeigt dafür einen
 *               Reparaturhinweis statt eines wortlos leeren Feldes
 * - pending:    Zugeordnet, aber der Kursspeicher ist für dieses Symbol noch
 *               nicht gefüllt (Hintergrundlauf läuft gleich)
 */
export type SparkEntry =
  | {
      status: 'ok'
      closes: number[]
      last: number
      changePct: number
      currency: string | null
      /** Unix-Sekunden des Kursstands beim Anbieter — für „Stand von 14:32". */
      quotedAt: number
      /** Wann wir ihn geholt haben (ISO). */
      fetchedAt: string
      symbol: string
      /** Näherung statt Entsprechung (z. B. Gold-Future statt Spot). */
      approximate: boolean
    }
  | { status: 'unresolved'; note: string | null }
  | { status: 'pending' | 'nodata' | 'error' }

export type SparklinesResponse = { sparks: Record<number, SparkEntry> }

/**
 * Verlauf für die Sparkline. Bewusst getrennt vom Kurs: Der Kurs kommt IMMER aus
 * dem Speicher, der Verlauf ist Beiwerk und darf fehlen, ohne dass die Zeile
 * leer aussieht.
 */
async function fetchCloses(symbol: string, market: Market): Promise<number[] | null> {
  try {
    const candles = await getCachedCandles(symbol, market, '1day')
    const closes = candles.slice(-90).map((c) => c.close)
    return closes.length >= 2 ? closes : null
  } catch (err) {
    // Ein fehlender Verlauf ist kein Fehler, der den Kurs verdecken darf.
    if (err instanceof MarketDataError) return null
    return null
  }
}

/**
 * Kurse für ALLE Instrumente des Nutzers.
 *
 * Der entscheidende Unterschied zu vorher: Die Kurse werden hier NICHT mehr beim
 * Anbieter geholt, sondern aus `quote_snapshot` gelesen — ein Datenbankzugriff
 * statt rund neunzig Netzabfragen gegen ein Limit von acht pro Minute. Genau
 * diese Fan-out-Abfrage war der Grund, warum in der Watchlist regelmäßig die
 * Hälfte der Kurse fehlte. Gefüllt wird der Speicher vom Hintergrundlauf
 * (`/api/cron/sync-symbols`).
 */
export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })
  }

  // Etappe 14: Zwei Betriebsarten, und der Unterschied ist der Grund, warum die
  // Watchlist bis hier fünf bis zehn Sekunden auf ihre Kurse wartete.
  //
  //   ohne `closes` (der ERSTE Abruf): nur der Kursspeicher, ein einziger
  //     Datenbankzugriff. Antwortet in Millisekunden.
  //   mit `closes=1` (der zweite, im Hintergrund): zusätzlich die Verläufe für
  //     die Sparklines — und die kosten bis zu neunzig Kerzen-Abrufe.
  //
  // Der Verlauf ist Beiwerk; der Kurs ist die Information. Beide im selben
  // Zug zu liefern hieß: Der Kurs wartet auf das Beiwerk.
  const wantCloses = new URL(req.url).searchParams.get('closes') === '1'

  // Auffrischen nur im zweiten, ohnehin langsamen Durchgang. Der erste soll den
  // gespeicherten Stand SOFORT zeigen — mit Zeitstempel, also ehrlich als das,
  // was er ist. Ein Kurs von vor zwei Minuten, sichtbar beschriftet, ist besser
  // als ein leeres Feld, das auf den perfekten Kurs wartet.
  if (wantCloses) await refreshQuotesIfStale()

  const rows = await db
    .select({
      id: stock.id,
      market: stock.market,
      providerSymbol: stock.providerSymbol,
      status: stock.resolutionStatus,
      note: stock.resolutionNote,
      approximate: stock.resolutionApproximate,
      price: quoteSnapshot.price,
      changePct: quoteSnapshot.changePct,
      currency: quoteSnapshot.currency,
      quotedAt: quoteSnapshot.quotedAt,
      fetchedAt: quoteSnapshot.fetchedAt,
    })
    .from(stock)
    .leftJoin(quoteSnapshot, eq(quoteSnapshot.symbol, stock.providerSymbol))
    .where(eq(stock.userId, session.user.id))

  const sparks: Record<number, SparkEntry> = {}

  await Promise.all(
    rows.map(async (r) => {
      if (r.status !== 'ok' || !r.providerSymbol) {
        sparks[r.id] = { status: 'unresolved', note: r.note }
        return
      }
      if (r.price == null) {
        sparks[r.id] = { status: 'pending' }
        return
      }

      const closes = wantCloses ? await fetchCloses(r.providerSymbol, r.market as Market) : null
      sparks[r.id] = {
        status: 'ok',
        // Ohne Verlauf bleibt die Sparkline leer — der Kurs steht trotzdem.
        closes: closes ?? [],
        last: r.price,
        changePct: r.changePct ?? 0,
        currency: r.currency,
        quotedAt: r.quotedAt ?? 0,
        fetchedAt: r.fetchedAt ? new Date(r.fetchedAt).toISOString() : '',
        symbol: r.providerSymbol,
        approximate: !!r.approximate,
      }
    }),
  )

  return NextResponse.json({ sparks } satisfies SparklinesResponse)
}
