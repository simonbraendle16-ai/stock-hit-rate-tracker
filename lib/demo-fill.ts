// Die Ausführungsentscheidung für Trades im DEMO-Depot: Was löst diese eine
// Kerze an diesem einen Trade aus?
//
// Rein, ohne Datenbank, ohne React — die Buchung selbst macht der Aufrufer
// (`app/actions/alerts.ts`). Hier steckt ausschließlich das Urteil, damit es
// prüfbar ist (`lib/demo-fill.test.ts`) und an genau einer Stelle steht.
//
// **Warum das Feature Douglas nicht widerspricht, sondern ihn bedient.** Der
// Plan steht vor dem Einstieg fest; die Ausführung ist mechanisch. Damit fällt
// der letzte Handgriff weg, mit dem sich ein Ergebnis nachträglich schönen
// liesse — kein „ich hätte den Stop ja gleich verschoben", kein stillschweigend
// besserer Ausstiegskurs beim Nachtragen. Echtgeld bleibt ausdrücklich von
// Hand: Ein automatisch gebuchter Echtgeld-Trade wäre eine Zahl ohne Deckung.
//
// **Die konservative Regel.** Berührt eine Kerze Stop UND Ziel, gilt der Stop.
// Ohne Tickdaten ist die echte Reihenfolge innerhalb der Kerze nicht
// feststellbar; die günstige Annahme wäre eine Lüge in der Trefferquote — genau
// die Sorte plausibler Falschwert, die dieses Projekt nicht duldet.

import type { Candle } from '@/lib/market-data/types'
import { candleReachesLevel } from '@/lib/alerts'
import { plannedQty, type EffectiveTarget } from '@/lib/trade-targets'

/** Was eine Kerze an einem Trade ausgelöst hat. */
export type DemoFillArt = 'einstieg' | 'teilziel' | 'ziel' | 'stop'

export type DemoFill = {
  art: DemoFillArt
  /** Der Kurs, zu dem tatsächlich ausgeführt wurde — bei einer Lücke der Eröffnungskurs. */
  preis: number
  /** Unix-Sekunden der KERZE, nicht die Uhrzeit des Sammellaufs. */
  zeit: number
  /** Menge in Stück; bei `einstieg` die Anfangsposition. */
  menge: number
  /** Die Zielstufe, sofern eine getroffen wurde (`null` bei Einstieg und Stop). */
  targetId: number | null
  /** Ist der Trade nach diesem Ereignis geschlossen? */
  schliesst: boolean
  /**
   * Das Level lag beim Prüfbeginn BEREITS auf der Auslöseseite — es wurde also
   * vor dem geprüften Fenster erreicht, zu einem Kurs, den niemand mehr kennt.
   *
   * Solche Ereignisse werden GEMELDET, nicht gebucht. Sie zum ersten Kurs des
   * Fensters abzurechnen wäre die Erfindung eines Ausgangs: Ein Ziel bei 100,
   * dessen Papier heute bei 307 steht, ergäbe einen Gewinn, den es nie gab.
   */
  vorFenster: boolean
  /** Lesbarer Grund für die Zeitleiste — nüchtern, ohne Bewertung. */
  grund: string
}

/**
 * Das Nötigste, was die Entscheidung vom Trade wissen muss.
 *
 * `positionSize` ist die Anfangsposition in Stück. Fehlt sie, werden Mengen als
 * 0 gemeldet — nie geschätzt: Eine erfundene Stückzahl liefe direkt in die
 * P&L-Rechnung.
 */
export type DemoFillTrade = {
  status: string
  direction: string
  entryPrice: number
  stopLoss: number
  /** Anfangsposition in Stück. Ohne sie werden Mengen zu 0 gemeldet, nie geraten. */
  positionSize: number | null
}

/** Ein Trade in diesem Zustand nimmt keine Ausführung mehr an. */
const ENDZUSTAENDE = new Set(['abgeschlossen', 'abgebrochen'])

/**
 * Berührt die Kerze dieses Level überhaupt?
 *
 * Richtungsneutral (`low <= level <= high`), weil ein Einstieg beides sein
 * kann: eine Limit-Order unter dem Kurs oder eine Stop-Order darüber. Für Stop
 * und Ziel steht die Richtung dagegen fest — dort fragt `candleReachesLevel`,
 * die schon für die Alarme gebaut wurde.
 */
function beruehrt(level: number, c: Candle): boolean {
  if (!Number.isFinite(level) || !Number.isFinite(c.high) || !Number.isFinite(c.low)) return false
  return c.low <= level && level <= c.high
}

/**
 * Der Preis, zu dem wirklich ausgeführt wird.
 *
 * Eröffnet die Kerze bereits JENSEITS des Levels — die Übernacht-Lücke, der
 * Nachrichtensprung —, dann gibt es das Level an diesem Tag nicht mehr: Der
 * erste handelbare Kurs ist die Eröffnung. Das trifft mal zugunsten, mal
 * zuungunsten des Trades, und genau deshalb ist es die ehrliche Annahme. Ein
 * Fill zum Wunschlevel wäre eine Trefferquote, die es so nie gab.
 */
function fillPreis(level: number, seite: 'above' | 'below', c: Candle): number {
  if (!Number.isFinite(c.open)) return level
  const uebersprungen = seite === 'above' ? c.open >= level : c.open <= level
  return uebersprungen ? c.open : level
}

/**
 * Von welcher Seite der Kurs ein Level anläuft — gemessen am letzten bekannten
 * Kurs, nicht an der Handelsrichtung.
 *
 * Ein Einstieg kann beides sein: eine Limit-Order UNTER dem Kurs (Rücksetzer
 * kaufen) oder eine Stop-Order DARÜBER (Ausbruch kaufen). Beide gehören zu
 * einem Long mit Stop darunter; die Richtung allein verrät also nichts. Liegt
 * das Level genau auf dem letzten Kurs oder fehlt der Kurs, ist die Seite
 * mehrdeutig → `null`, und der Aufrufer bleibt bei der echten Berührung.
 */
function anlaufSeite(level: number, vorherKurs: number | null | undefined): 'above' | 'below' | null {
  if (vorherKurs == null || !Number.isFinite(vorherKurs) || !Number.isFinite(level)) return null
  if (level < vorherKurs) return 'below'
  if (level > vorherKurs) return 'above'
  return null
}

/**
 * Lag der letzte bekannte Kurs schon auf der Auslöseseite des Levels?
 *
 * Dann ist das Level nicht in diesem Fenster erreicht worden, sondern irgendwann
 * davor — und der Kurs, zu dem es real ausgeführt worden wäre, ist unbekannt.
 * Ohne Vorkurs lässt sich das nicht unterscheiden; dann gilt `false`, und es
 * bleibt bei der gewöhnlichen Behandlung.
 */
function vorherJenseits(
  level: number,
  seite: 'above' | 'below',
  vorherKurs: number | null | undefined,
): boolean {
  if (vorherKurs == null || !Number.isFinite(vorherKurs) || !Number.isFinite(level)) return false
  return seite === 'above' ? vorherKurs >= level : vorherKurs <= level
}

/** Auf welcher Seite ein Stop liegt: bei long unter dem Einstieg, bei short darüber. */
function stopSeite(direction: string): 'above' | 'below' {
  return direction === 'short' ? 'above' : 'below'
}

/** Die Gewinnseite: bei long oberhalb, bei short unterhalb. */
function zielSeite(direction: string): 'above' | 'below' {
  return direction === 'short' ? 'below' : 'above'
}

/**
 * Was löst diese Kerze aus?
 *
 * Die Reihenfolge im Rückgabewert ist die Reihenfolge der Buchung. Mehr als ein
 * Ereignis je Kerze ist möglich und gewollt: Eine weite Kerze kann den Einstieg
 * füllen und denselben Trade sofort ausstoppen — wer das auf zwei Kerzen
 * verteilte, erfände einen Verlauf, den es nicht gab.
 *
 * `targets` kommt aus `effectiveTargets` und ist damit auch dann gefüllt, wenn
 * ein Trade gar keine Stufen in `trade_target` hat (dann trägt `takeProfit` die
 * einzige Stufe). Bereits ausgeführte Stufen (`executedAt`) werden übersprungen.
 */
export function demoFills(args: {
  trade: DemoFillTrade
  targets: readonly EffectiveTarget[]
  candle: Candle
  /**
   * Schlusskurs der Kerze VOR dem geprüften Fenster. Er beantwortet zwei
   * Fragen, die aus einer einzelnen Kerze nicht zu beantworten sind:
   *
   * 1. **Von welcher Seite wird der Einstieg angelaufen?** Ein Long-Limit bei
   *    100 sieht bei einer Eröffnung zu 96 genauso aus wie ein Ausbruchskauf,
   *    der nie auslöste. Ohne Vorkurs gilt deshalb nur die echte Berührung
   *    (`low <= level <= high`) — lieber ein Einstieg zu wenig als ein erfundener.
   * 2. **Lag das Level schon vorher jenseits?** Dann wurde es vor dem Fenster
   *    erreicht, und der Fill trägt `vorFenster: true`.
   */
  vorherKurs?: number | null
}): DemoFill[] {
  const { trade: t, candle: c } = args
  if (ENDZUSTAENDE.has(t.status)) return []
  if (!Number.isFinite(c.high) || !Number.isFinite(c.low)) return []

  const fills: DemoFill[] = []
  const basis = Number.isFinite(t.positionSize ?? NaN) ? (t.positionSize as number) : 0
  let aktiv = t.status === 'aktiv'

  // --- Einstieg -----------------------------------------------------------
  if (t.status === 'geplant') {
    // Mit bekanntem Vorkurs zählt die ANLAUFSEITE: Lag der Einstieg unter dem
    // letzten Kurs, wird er von oben erreicht ('below') — dann füllt auch eine
    // Kerze, die komplett darunter eröffnet. Ohne Vorkurs bleibt es bei der
    // echten Berührung.
    const seite = anlaufSeite(t.entryPrice, args.vorherKurs)
    const erreicht = seite
      ? candleReachesLevel(seite, t.entryPrice, c)
      : beruehrt(t.entryPrice, c)
    if (!erreicht) return []
    const preis = seite ? fillPreis(t.entryPrice, seite, c) : t.entryPrice
    fills.push({
      art: 'einstieg',
      preis,
      zeit: c.time,
      menge: basis,
      targetId: null,
      schliesst: false,
      vorFenster: seite ? vorherJenseits(t.entryPrice, seite, args.vorherKurs) : false,
      grund:
        preis === t.entryPrice
          ? 'Kurs hat den Einstieg berührt.'
          : `Kurs eröffnete jenseits des Einstiegs — ausgeführt zur Eröffnung (${preis}).`,
    })
    aktiv = true
  }

  if (!aktiv) return fills

  // --- Stop schlägt Ziel --------------------------------------------------
  //
  // Bewusst VOR den Zielen geprüft und mit `return`: Trifft eine Kerze beides,
  // zählt der Stop. Siehe Kopfkommentar — ohne Tickdaten ist die Reihenfolge
  // nicht feststellbar, und die günstige Annahme wäre eine Lüge.
  if (candleReachesLevel(stopSeite(t.direction), t.stopLoss, c)) {
    const preis = fillPreis(t.stopLoss, stopSeite(t.direction), c)
    fills.push({
      art: 'stop',
      preis,
      zeit: c.time,
      menge: offeneMenge(basis, args.targets),
      targetId: null,
      schliesst: true,
      vorFenster: vorherJenseits(t.stopLoss, stopSeite(t.direction), args.vorherKurs),
      grund:
        preis === t.stopLoss
          ? 'Kurs hat den Stop berührt.'
          : `Kurs eröffnete jenseits des Stops — ausgeführt zur Eröffnung (${preis}).`,
    })
    return fills
  }

  // --- Zielstufen ---------------------------------------------------------
  const offen = args.targets.filter((z) => z.executedAt == null)
  // Über die Objektidentität, nicht über `id`: Hat ein Trade keine Stufen in
  // `trade_target`, liefert `effectiveTargets` eine einzelne Stufe mit
  // `id: null` — ein Vergleich über die Kennung träfe dann jede Stufe.
  const letzte = args.targets.length > 0 ? args.targets[args.targets.length - 1] : null
  let verkauft = 0

  for (const stufe of offen) {
    if (!candleReachesLevel(zielSeite(t.direction), stufe.price, c)) continue
    const istLetzte = stufe === letzte
    const preis = fillPreis(stufe.price, zielSeite(t.direction), c)
    // Die äußerste Stufe nimmt den REST der Position, nicht ihren Anteil:
    // Bleibt die Summe der Anteile unter 100, läuft der Rest bis hierher mit
    // (`remainderPct` in `lib/trade-targets.ts`). Sonst bliebe eine
    // Geisterposition offen, die niemand mehr schliesst.
    const menge = istLetzte
      ? Math.max(0, offeneMenge(basis, args.targets) - verkauft)
      : plannedQty(basis, stufe.sharePct)
    verkauft += menge
    fills.push({
      art: istLetzte ? 'ziel' : 'teilziel',
      preis,
      zeit: c.time,
      menge,
      targetId: stufe.id,
      schliesst: istLetzte,
      vorFenster: vorherJenseits(stufe.price, zielSeite(t.direction), args.vorherKurs),
      grund: istLetzte
        ? 'Kurs hat das Kursziel erreicht — Restposition geschlossen.'
        : `Kurs hat Zielstufe ${stufe.sortOrder + 1} erreicht (${stufe.sharePct} % der Anfangsposition).`,
    })
    if (istLetzte) break
  }

  return fills
}

/**
 * Die Menge, die noch am Markt liegt: Anfangsposition minus alles, was
 * bereits über eine Zielstufe abgerechnet wurde.
 *
 * Gezählt wird `executedQty`, nicht der geplante Anteil — was tatsächlich
 * ausgeführt wurde, kann davon abweichen (Hand-Buchung, Lücken-Fill). Eine
 * geplante Zahl an dieser Stelle hiesse, den Rest zu erfinden.
 */
export function offeneMenge(basis: number, targets: readonly EffectiveTarget[]): number {
  if (!Number.isFinite(basis) || basis <= 0) return 0
  let weg = 0
  for (const z of targets) {
    if (z.executedAt == null) continue
    weg += Number.isFinite(z.executedQty ?? NaN) ? (z.executedQty as number) : 0
  }
  return Math.max(0, basis - weg)
}
