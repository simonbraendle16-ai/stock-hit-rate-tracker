// Teil 2 des Demo-Handels: der Lauf, der die Entscheidung aus `demo-fill.ts`
// TATSÄCHLICH bucht — sitzungsfrei, damit der Takt ihn für alle Nutzer
// anstoßen kann. Gebaut wie `lib/alert-run.ts`: Diese Datei lädt Zeilen, holt
// Kerzen und schreibt Ergebnisse; das Urteil selbst steht rein und getestet
// nebenan.
//
// NUR DEMO. Ein Echtgeld-Trade wird hier nie angefasst — eine automatisch
// gebuchte Echtgeld-Zahl hätte keine Deckung bei der Bank und wäre damit genau
// der stille Falschwert, den dieses Projekt nicht duldet. Die Auswahl läuft
// über `portfolio.kind`, die einzige Quelle der Handelsart.
//
// GEPRÜFT WIRD AUF `5min`. Je feiner die Kerze, desto seltener der mehrdeutige
// Fall „Stop und Ziel in derselben Kerze", in dem konservativ der Stop gilt.
// Yahoo gibt Fünf-Minuten-Kerzen 60 Tage weit heraus, und ein Demo-Trade mit
// offenem oder geplantem Status ist Sammelstufe A — die Ebene ist also da.
// Reicht die Abdeckung ausnahmsweise nicht bis zum Prüfbeginn zurück, wird das
// GEMELDET (`unvollstaendig`) statt stillschweigend übersprungen: Ein Trade,
// der nicht geprüft werden konnte, darf nicht wie einer aussehen, bei dem
// nichts passiert ist.
//
// DER TAKT HÄNGT AM SAMMELLAUF, NICHT AN DEN ALARMEN. Der Lauf sitzt in
// `/api/cron/collect-candles`, die ihre Fälligkeit selbst prüft (stündlich) und
// unmittelbar davor die Kerzen geholt hat. Das spart einen eigenen Merker —
// und vor allem Egress:
//
// Ein Lauf alle fünf Minuten, der je Trade bis zum letzten Ereignis
// zurückschaut, liest bei 13 Trades bis zu 2.000 Kerzen je Trade — 2,1 MB pro
// Lauf, 599 MB am Tag, 17,5 GB im Monat. Das ist derselbe Fehler, der schon
// einmal 5 GB verbraucht und die Datenbank abgeschaltet hat.
//
// Zwei Grenzen halten das klein:
//   1. `PRUEF_FENSTER_MS` — es wird nie weiter zurückgeschaut als zwei Stunden.
//      Bei stündlichem Takt ist das ein voller Lauf Puffer; was darüber hinaus
//      liegt, wird als `unvollstaendig` GEMELDET statt still übergangen.
//   2. Stündlich statt alle fünf Minuten.
// Zusammen: rund 600 KB am Tag, etwa 18 MB im Monat.
//
// Das kostet keine Genauigkeit. Die Ausführungszeit ist die KERZENZEIT: Ein
// Stop, der um 13:05 auslöste, wird mit 13:05 gebucht — ob der Lauf ihn um
// 13:10 findet oder um 14:00, ändert an der Zahl nichts. Die sofortige Meldung
// macht ohnehin der Alarm-Lauf, der weiter alle fünf Minuten prüft.
//
// TROCKENLAUF. `runDemoFills({ trocken: true })` schreibt NICHTS und meldet in
// `zeilen`, was gebucht würde — derselbe Schutz, den `scripts/apply-retention.mjs`
// mit `--dry` bietet. Der Zustand wird dabei im Speicher fortgeschrieben, damit
// auch Folgeereignisse sichtbar sind (Einstieg, dann Teilziel).
//
// CHECK-IN WIRD NACHGEFORDERT, NICHT ÜBERSPRUNGEN. Ein automatischer Abschluss
// setzt `moodExit` und `lossAccepted` NICHT — er bucht die Zahlen und lässt die
// Douglas-Fragen offen. Der Mensch nimmt den Verlust weiterhin bewusst an, nur
// eben nach der mechanischen Ausführung. Woran man diese Trades erkennt: Jedes
// hier geschriebene Ereignis trägt `payload.auto = true`.

import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { portfolio, trade, tradeEvent, tradeTarget } from '@/lib/db/schema'
import { getCachedCandles } from '@/lib/market-data/cached'
import { createSymbolResolver } from '@/lib/market-data/lookup'
import type { Candle, Interval, Market } from '@/lib/market-data/types'
import { demoFills, type DemoFill } from '@/lib/demo-fill'
import { effectiveTargets, type TradeTargetRow } from '@/lib/trade-targets'
import { settlePosition, type TradeEventRow } from '@/lib/trade-events'
import { normalizePortfolioKind } from '@/lib/portfolio-scope'

/** Die Zeitebene, auf der ausgeführt wird. Begründung im Kopfkommentar. */
export const FILL_INTERVAL: Interval = '5min'

/** Sekunden je Kerze dieser Ebene — für die Mengenabschätzung. */
const FILL_SEKUNDEN = 5 * 60

/**
 * Obergrenze der gelesenen Kerzen je Trade.
 *
 * Sie steht hier und wandert als `limit` ins SQL — **nie** wird eine Reihe ganz
 * gelesen und danach zurechtgeschnitten. Genau dieser Fehler hat 5 GB Transfer
 * verbraucht und die Datenbank abgeschaltet. 2.000 entspricht der
 * Aufbewahrungsgrenze der Ebene: mehr existiert ohnehin nicht.
 */
const MAX_KERZEN = 2000

/**
 * Wie weit ein Lauf höchstens zurückschaut.
 *
 * Ohne diese Grenze bleibt der Prüfbeginn eines ruhigen Trades für immer beim
 * letzten Ereignis stehen — und jeder Lauf liest dieselbe, stetig wachsende
 * Menge erneut. Zwei Stunden geben dem stündlichen Takt einen vollen Lauf
 * Puffer; fällt mehr aus, sagt der Bericht es (`unvollstaendig`).
 */
export const PRUEF_FENSTER_MS = 2 * 60 * 60 * 1000

/** Was ein Lauf gebucht hätte oder gebucht hat — je Trade eine Zeile. */
export type DemoFillZeile = {
  tradeId: number
  ticker: string
  art: string
  preis: number
  menge: number
  zeit: string
  grund: string
}

export type DemoRunReport = {
  ran: boolean
  /** War es ein Trockenlauf? Dann wurde NICHTS geschrieben. */
  trocken: boolean
  /** Wie viele Demo-Trades überhaupt in Frage kamen. */
  tradesGeprueft: number
  einstiege: number
  teilziele: number
  abschluesse: number
  /**
   * Trades, deren Kerzen nicht bis zum Prüfbeginn zurückreichen — hier KANN
   * eine Ausführung übersehen worden sein. Sichtbar statt still.
   */
  unvollstaendig: number[]
  /** Trades ohne verwertbare Kerzen (unbekanntes Symbol, leere Reihe). */
  ohneKerzen: number[]
  /**
   * Trades, deren Level schon VOR dem Prüffenster erreicht war. Sie werden
   * gemeldet und NICHT gebucht — zu welchem Kurs sie real ausgeführt worden
   * wären, weiss niemand mehr. Das entscheidet der Mensch von Hand.
   */
  vorFenster: number[]
  /** Die einzelnen Ausführungen — im Trockenlauf die einzige Ausgabe. */
  zeilen: DemoFillZeile[]
  error: string | null
}

/** Ein Bericht ohne Lauf — auch der Fangzweig des Aufrufers meldet damit sauber. */
export function leererDemoBericht(): DemoRunReport {
  return {
    ran: false,
    trocken: false,
    tradesGeprueft: 0,
    einstiege: 0,
    teilziele: 0,
    abschluesse: 0,
    unvollstaendig: [],
    ohneKerzen: [],
    vorFenster: [],
    zeilen: [],
    error: null,
  }
}

/**
 * Ab wann geprüft wird.
 *
 * Der jüngste FACHLICHE Zeitpunkt, den der Trade kennt: das letzte Ereignis,
 * sonst die Eröffnung, sonst die Anlage. Alles davor ist bereits abgerechnet —
 * eine ältere Kerze erneut auszuführen hiesse, denselben Einstieg zweimal zu
 * buchen.
 *
 * `at` (fachlich), nicht `createdAt` (technisch): Ein von Hand nachgetragenes
 * Ereignis liegt in der Vergangenheit, wurde aber eben erst geschrieben.
 */
export function pruefBeginn(
  t: typeof trade.$inferSelect,
  events: TradeEventRow[],
  jetzt: number,
): { beginn: Date; gekappt: boolean } {
  const letztes = events.length > 0 ? new Date(events[events.length - 1].at) : null
  const fachlich = letztes ?? t.openedAt ?? t.createdAt
  const grenze = new Date(jetzt - PRUEF_FENSTER_MS)
  // Die spätere der beiden Zeiten gewinnt: nie weiter zurück als das Fenster.
  if (fachlich.getTime() >= grenze.getTime()) return { beginn: fachlich, gekappt: false }
  return { beginn: grenze, gekappt: true }
}

/**
 * Ein Lauf über alle Demo-Trades.
 *
 * `userId` grenzt auf einen Nutzer ein (Server Action); ohne ihn läuft es über
 * alle (Cron). Der Aufbau folgt `runAlertCheck`: erst laden, dann rechnen, dann
 * je Trade in EINER Transaktion schreiben. Ein Trade, der scheitert, beendet
 * den Lauf nicht — sein Fehler steht im Bericht.
 */
export async function runDemoFills(
  opts: { userId?: string; trocken?: boolean } = {},
): Promise<DemoRunReport> {
  const report = leererDemoBericht()
  report.trocken = opts.trocken === true

  try {
    // --- Nur Depots der Art 'demo' -----------------------------------------
    const depots = await db
      .select({ id: portfolio.id, kind: portfolio.kind, userId: portfolio.userId })
      .from(portfolio)
      .where(opts.userId ? eq(portfolio.userId, opts.userId) : undefined)

    const demoIds = depots
      .filter((p) => normalizePortfolioKind(p.kind) === 'demo')
      .map((p) => p.id)
    if (demoIds.length === 0) return { ...report, ran: true }

    // --- Offene Trades in diesen Depots ------------------------------------
    const trades = await db
      .select()
      .from(trade)
      .where(
        and(
          inArray(trade.portfolioId, demoIds),
          inArray(trade.status, ['geplant', 'aktiv']),
        ),
      )
    report.tradesGeprueft = trades.length
    if (trades.length === 0) return { ...report, ran: true }

    // Die Symbolauflösung hängt am Nutzer (dessen Instrumente) — ein Resolver
    // je Nutzer, nie der Rohticker an den Anbieter.
    const resolver = new Map<string, Awaited<ReturnType<typeof createSymbolResolver>>>()

    for (const t of trades) {
      try {
        if (!resolver.has(t.userId)) resolver.set(t.userId, await createSymbolResolver(t.userId))
        const resolve = resolver.get(t.userId)!
        const symbol = resolve(t.ticker, t.stockId)

        const events = await ladeEreignisse(t.userId, t.id)
        const targetRows = await ladeStufen(t.userId, t.id)
        const { beginn, gekappt } = pruefBeginn(t, events, Date.now())
        const beginnSek = Math.floor(beginn.getTime() / 1000)

        const kerzen = await ladeKerzen(symbol, t.market as Market, beginnSek)
        if (kerzen.length === 0) {
          report.ohneKerzen.push(t.id)
          continue
        }
        // Zwei Wege in dieselbe Meldung: Entweder wurde das Fenster gekappt
        // (der letzte Lauf ist zu lange her), oder die Kerzenreihe reicht nicht
        // so weit zurück. In beiden Fällen KANN eine Ausführung dazwischen
        // liegen, die niemand mehr sieht — das gehört gesagt, nicht verschwiegen.
        if (gekappt || kerzen[0].time > beginnSek) report.unvollstaendig.push(t.id)

        const neue = kerzen.filter((c) => c.time >= beginnSek)
        if (neue.length === 0) continue

        const gebucht = await verarbeiteTrade({
          t,
          events,
          targetRows,
          kerzen: neue,
          vorherKurs: vorkurs(kerzen, beginnSek),
          trocken: report.trocken,
        })
        report.einstiege += gebucht.einstiege
        report.teilziele += gebucht.teilziele
        report.abschluesse += gebucht.abschluesse
        report.zeilen.push(...gebucht.zeilen)
        if (gebucht.vorFenster) report.vorFenster.push(t.id)
      } catch (err) {
        // Ein einzelnes unbekanntes Symbol darf den Lauf nicht beenden — der
        // Trade taucht als „ohne Kerzen" auf und wird beim nächsten Mal erneut
        // versucht.
        report.ohneKerzen.push(t.id)
        if (report.error == null) {
          report.error = err instanceof Error ? err.message : String(err)
        }
      }
    }

    report.ran = true
    return report
  } catch (err) {
    report.error = err instanceof Error ? err.message : String(err)
    return report
  }
}

/**
 * Der Schlusskurs unmittelbar VOR dem Prüfbeginn — die Anlaufseite des
 * Einstiegs (siehe `demoFills`). Gibt es keine ältere Kerze, bleibt es `null`,
 * und `demoFills` verlangt dann die echte Berührung statt zu raten.
 */
function vorkurs(kerzen: Candle[], beginnSek: number): number | null {
  let letzte: Candle | null = null
  for (const c of kerzen) {
    if (c.time >= beginnSek) break
    letzte = c
  }
  return letzte ? letzte.close : null
}

/** Kerzen der Ausführungsebene — die Menge steht als `limit` im SQL. */
async function ladeKerzen(symbol: string, market: Market, beginnSek: number): Promise<Candle[]> {
  const spanne = Math.max(0, Math.floor(Date.now() / 1000) - beginnSek)
  // Ein Puffer von 2 Kerzen, damit der Vorkurs mitkommt.
  const noetig = Math.ceil(spanne / FILL_SEKUNDEN) + 2
  const limit = Math.min(MAX_KERZEN, Math.max(3, noetig))
  return getCachedCandles(symbol, market, FILL_INTERVAL, { limit, storedOnly: true })
}

async function ladeEreignisse(userId: string, tradeId: number): Promise<TradeEventRow[]> {
  return db
    .select()
    .from(tradeEvent)
    .where(and(eq(tradeEvent.tradeId, tradeId), eq(tradeEvent.userId, userId)))
    .orderBy(asc(tradeEvent.at), asc(tradeEvent.id))
}

async function ladeStufen(userId: string, tradeId: number): Promise<TradeTargetRow[]> {
  return db
    .select()
    .from(tradeTarget)
    .where(and(eq(tradeTarget.tradeId, tradeId), eq(tradeTarget.userId, userId)))
    .orderBy(asc(tradeTarget.sortOrder), asc(tradeTarget.id))
}

/**
 * Alle Kerzen eines Trades der Reihe nach durchgehen und buchen.
 *
 * Der Zustand wird MITGEFÜHRT: Ein Einstieg in Kerze 5 macht den Trade für
 * Kerze 6 aktiv, ein Abschluss beendet die Schleife. Sonst würde jede Kerze
 * gegen denselben Anfangszustand geprüft und derselbe Einstieg dutzendfach
 * gebucht.
 */
async function verarbeiteTrade(args: {
  t: typeof trade.$inferSelect
  events: TradeEventRow[]
  targetRows: TradeTargetRow[]
  kerzen: Candle[]
  vorherKurs: number | null
  trocken: boolean
}): Promise<{
  einstiege: number
  teilziele: number
  abschluesse: number
  zeilen: DemoFillZeile[]
  vorFenster: boolean
}> {
  const { t } = args
  let status = t.status
  let stufen = args.targetRows
  let vorher = args.vorherKurs
  const zaehler = {
    einstiege: 0,
    teilziele: 0,
    abschluesse: 0,
    zeilen: [] as DemoFillZeile[],
    vorFenster: false,
  }

  for (const kerze of args.kerzen) {
    if (status === 'abgeschlossen') break

    const fills = demoFills({
      trade: {
        status,
        direction: t.direction,
        entryPrice: t.entryPrice,
        stopLoss: t.stopLoss,
        positionSize: t.positionSize,
      },
      targets: effectiveTargets(t, stufen),
      candle: kerze,
      vorherKurs: vorher,
    })
    vorher = kerze.close

    for (const fill of fills) {
      // Vor dem Fenster erreicht: melden, nicht buchen. Und die Schleife endet
      // hier — was danach käme, baute auf einem Zustand auf, den es nie gab.
      if (fill.vorFenster) {
        zaehler.vorFenster = true
        zaehler.zeilen.push({
          tradeId: t.id,
          ticker: t.ticker,
          art: `${fill.art} (vor dem Fenster)`,
          preis: fill.preis,
          menge: fill.menge,
          zeit: new Date(fill.zeit * 1000).toISOString(),
          grund:
            'Level lag beim Prüfbeginn bereits jenseits — nicht gebucht, bitte von Hand abrechnen.',
        })
        return zaehler
      }
      zaehler.zeilen.push({
        tradeId: t.id,
        ticker: t.ticker,
        art: fill.art,
        preis: fill.preis,
        menge: fill.menge,
        zeit: new Date(fill.zeit * 1000).toISOString(),
        grund: fill.grund,
      })
      // Im Trockenlauf wird der Zustand nur IM SPEICHER fortgeschrieben — so
      // sieht man auch die Folgeereignisse (Einstieg, dann Teilziel), ohne dass
      // eine Zeile in die Datenbank geht.
      const neu = args.trocken
        ? trockenFolge({ fill, stufen, status })
        : await bucheFill({ t, fill, stufen })
      stufen = neu.stufen
      status = neu.status
      if (fill.art === 'einstieg') zaehler.einstiege++
      else if (fill.art === 'teilziel') zaehler.teilziele++
      else zaehler.abschluesse++
    }
  }

  return zaehler
}

/**
 * Ein einzelnes Ereignis buchen — in EINER Transaktion, damit Ereignis,
 * Zielstufe und Trade-Zustand nie auseinanderfallen.
 *
 * Die Ausführungszeit ist die KERZENZEIT, nicht die Uhrzeit des Laufs. Sonst
 * trüge ein Stop, der um 09:35 auslöste und um 10:00 gefunden wird, die falsche
 * Zeit — und jede Auswertung über Tageszeiten wäre stillschweigend verschoben.
 */
async function bucheFill(args: {
  t: typeof trade.$inferSelect
  fill: DemoFill
  stufen: TradeTargetRow[]
}): Promise<{ stufen: TradeTargetRow[]; status: string }> {
  const { t, fill } = args
  const at = new Date(fill.zeit * 1000)
  // Die Herkunft steht im Ereignis, nicht in einer neuen Spalte: Daran erkennt
  // die Oberfläche, bei welchen Trades der Check-in noch nachzuholen ist.
  const payload = JSON.stringify({ auto: true, quelle: 'demo-fill', interval: FILL_INTERVAL })
  let status = t.status

  const eventTyp =
    fill.art === 'einstieg' ? 'eroeffnet' : fill.art === 'teilziel' ? 'teilverkauf' : 'geschlossen'

  await db.transaction(async (tx) => {
    const [ev] = await tx
      .insert(tradeEvent)
      .values({
        tradeId: t.id,
        userId: t.userId,
        type: eventTyp,
        at,
        quantity: fill.menge,
        price: fill.preis,
        payload,
        note: fill.grund,
      })
      .returning({ id: tradeEvent.id })

    if (fill.art === 'einstieg') {
      // Der PLAN bleibt unangetastet: `entryPrice` ist das vereinbarte Level,
      // der tatsächliche Fill steht im Ereignis. Ein Lücken-Fill darf den Plan
      // nicht rückwirkend auf den besseren Kurs umschreiben — sonst sähe jeder
      // Trade nachträglich so aus, als sei er genau nach Plan gelaufen.
      await tx
        .update(trade)
        .set({ status: 'aktiv', openedAt: at })
        .where(and(eq(trade.id, t.id), eq(trade.userId, t.userId)))
      status = 'aktiv'
    }

    if (fill.targetId != null) {
      await tx
        .update(tradeTarget)
        .set({
          executedAt: at,
          executedPrice: fill.preis,
          executedQty: fill.menge,
          eventId: ev.id,
        })
        .where(and(eq(tradeTarget.id, fill.targetId), eq(tradeTarget.userId, t.userId)))
    }

    if (fill.schliesst) {
      // Das Ergebnis wird nicht geschätzt, sondern aus den Ereignissen
      // gefaltet — dieselbe Quelle, die auch die Hand-Buchung nutzt
      // (`settlePosition`). Teilverkäufe zählen dadurch mit.
      const alle = await tx
        .select()
        .from(tradeEvent)
        .where(and(eq(tradeEvent.tradeId, t.id), eq(tradeEvent.userId, t.userId)))
        .orderBy(asc(tradeEvent.at), asc(tradeEvent.id))
      const settle = settlePosition(t, alle)

      await tx
        .update(trade)
        .set({
          status: 'abgeschlossen',
          result: ergebnisAus(settle.totalNet),
          actualExitPrice: fill.preis,
          // Die Ausführung IST der Plan — das ist der ganze Punkt der
          // Automatik. Anders als beim Abschluss von Hand gibt es hier keinen
          // Ermessensspielraum, der nachträglich beschönigt werden könnte.
          followedPlan: true,
          closedAt: at,
          // `moodExit` und `lossAccepted` bleiben BEWUSST leer — sie werden
          // nachgefordert. Eine Maschine kann keinen Verlust bewusst annehmen;
          // ein voreingetragener Haken wäre eine Lüge im Disziplin-Teil.
        })
        .where(and(eq(trade.id, t.id), eq(trade.userId, t.userId)))
      status = 'abgeschlossen'
    }
  })

  // Die Stufe ist jetzt ausgeführt — der nächste Durchlauf darf sie nicht
  // erneut treffen.
  const stufen =
    fill.targetId == null
      ? args.stufen
      : args.stufen.map((z) =>
          z.id === fill.targetId
            ? { ...z, executedAt: at, executedPrice: fill.preis, executedQty: fill.menge }
            : z,
        )

  return { stufen, status }
}

/**
 * Die Zustandsfortschreibung des Trockenlaufs — dieselbe Wirkung wie
 * `bucheFill`, nur ohne Schreibzugriff. Beide Wege müssen denselben Zustand
 * ergeben, sonst zeigte der Trockenlauf einen anderen Verlauf als der echte
 * Lauf und wäre wertlos.
 */
function trockenFolge(args: {
  fill: DemoFill
  stufen: TradeTargetRow[]
  status: string
}): { stufen: TradeTargetRow[]; status: string } {
  const { fill } = args
  const at = new Date(fill.zeit * 1000)
  const stufen =
    fill.targetId == null
      ? args.stufen
      : args.stufen.map((z) =>
          z.id === fill.targetId
            ? { ...z, executedAt: at, executedPrice: fill.preis, executedQty: fill.menge }
            : z,
        )
  const status = fill.schliesst ? 'abgeschlossen' : fill.art === 'einstieg' ? 'aktiv' : args.status
  return { stufen, status }
}

/** Gewinn, Verlust oder Nullrunde — die Schwelle liegt bei einem Cent. */
function ergebnisAus(netto: number): 'gewinn' | 'verlust' | 'breakeven' {
  if (!Number.isFinite(netto) || Math.abs(netto) < 0.01) return 'breakeven'
  return netto > 0 ? 'gewinn' : 'verlust'
}
