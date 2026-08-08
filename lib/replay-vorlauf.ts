/**
 * Nachladen nach links — und warum der Replay-Stand davon nichts merken darf.
 *
 * DER FALLSTRICK, UM DEN SICH DIESE DATEI DREHT
 * Der Replay zählt **Kerzen ab Index 0** (`replayStand`, `replayEnde`). Kommen
 * links Kerzen dazu, verschiebt sich damit der erreichte Moment — mitten in
 * einer laufenden Übung und unbemerkt. Aus „Kerze 250" würde nach dem Nachladen
 * einer Stelle 250 Kerzen weiter vorn eine ganz andere Stelle im Chart, und die
 * Übung spränge, ohne dass irgendetwas danach aussähe. Das ist dieselbe Klasse
 * Fehler wie `startIndex` gegen `startCandleTime` beim Kerzenspeicher — dort
 * wurde sie schon einmal gemacht.
 *
 * DIE LÖSUNG HIER: DIE ZÄHLENDE REIHE WIRD NICHT ANGEFASST
 * Der Plan bot zwei Wege an — den Stand um die Zahl neuer Kerzen erhöhen, oder
 * ihn auf Zeit umstellen. Umgesetzt ist ein dritter, der beide Risiken
 * vermeidet: Der Vorlauf ist eine **Anzeigeschicht**. Er wird der ANGESEHENEN
 * Reihe vorangestellt; die Reihe, in der der Replay zählt (die Basis-Ebene),
 * bleibt Byte für Byte dieselbe.
 *
 * Damit kann der Stand gar nicht verrutschen — es gibt keine Korrektur, die man
 * vergessen könnte, und keinen zweiten Zustand, der auseinanderlaufen könnte.
 * Ein Nachziehen wäre nur so lange richtig, wie jede einzelne Stelle es
 * mitmacht; ein unveränderter Bezugspunkt ist immer richtig. `vorlaufIstFolgenlos`
 * hält diese Zusage als Test fest.
 *
 * Rein und getestet — die Chart-Komponente entscheidet hier nichts.
 */

import type { Candle } from './market-data/types'

/**
 * So nah darf der linke Bildrand an die erste geladene Kerze kommen, bevor
 * nachgeladen wird.
 *
 * Nicht 0: Wer erst beim Anschlag nachlädt, sieht die Lücke immer zuerst. Nicht
 * viel mehr: Sonst lädt schon ein beiläufiges Rauszoomen nach, obwohl der Rand
 * gar nicht gesucht wurde.
 */
export const VORLAUF_SCHWELLE = 15

/** So viele Kerzen holt ein Nachladeschritt höchstens. */
export const VORLAUF_SCHRITT = 500

/**
 * Soll nach links nachgeladen werden?
 *
 * `vonLogisch` ist der linke Rand des sichtbaren Bereichs als logischer Index
 * (er kann negativ sein — links der ersten Kerze ist gültiges Gebiet, siehe
 * `lib/chart-coords.ts`). Gefragt wird nur, ob der Rand nah genug ist; ob es
 * überhaupt noch etwas zu holen gibt, weiß erst die Antwort.
 */
export function brauchtVorlauf(
  vonLogisch: number | null | undefined,
  laeuftSchon: boolean,
  amAnfang: boolean,
): boolean {
  if (laeuftSchon || amAnfang) return false
  if (vonLogisch == null || !Number.isFinite(vonLogisch)) return false
  return vonLogisch <= VORLAUF_SCHWELLE
}

/**
 * Ab welcher Zeit nach hinten gefragt wird — exklusiv, damit die Grenzkerze
 * nicht doppelt kommt.
 */
export function vorlaufGrenze(reihe: Candle[]): number | null {
  return reihe.length > 0 ? reihe[0].time : null
}

/**
 * Ältere Kerzen vor eine Reihe setzen.
 *
 * Doppelte Zeitstempel fallen weg — der Bestand gewinnt, weil er der jüngere
 * Stand ist. Sortiert wird immer: Eine Kerzenreihe, die nicht aufsteigend
 * liegt, bringt die Chart-Bibliothek zum Werfen, und zwar erst beim Zeichnen.
 */
export function vorlaufVoranstellen(bestand: Candle[], aeltere: Candle[]): Candle[] {
  if (aeltere.length === 0) return bestand
  const bekannt = new Set(bestand.map((c) => c.time))
  const neu = aeltere.filter((c) => !bekannt.has(c.time))
  if (neu.length === 0) return bestand
  return [...neu, ...bestand].sort((a, b) => a.time - b.time)
}

/**
 * Wie viele Kerzen ein Nachladeschritt WIRKLICH gebracht hat.
 *
 * Gebraucht, um zu erkennen, dass der Anfang erreicht ist: Kommt nichts Neues
 * mehr, wird nicht weiter gefragt. Ohne das fragt ein Chart am linken Anschlag
 * bei jeder Mausbewegung erneut.
 */
export function vorlaufGewachsen(vorher: Candle[], nachher: Candle[]): number {
  return Math.max(0, nachher.length - vorher.length)
}
