/**
 * Wo der Replay steht und was davon im Bild ist.
 *
 * Beides lag bis hierher in `useEffect`-Rümpfen im Chart und war damit weder
 * nachlesbar noch prüfbar — und beides war falsch:
 *
 * 1. Der Startpunkt einer Übung entsteht erst, wenn die Kerzen da sind. Er
 *    trifft also NACH dem ersten Rendern des Charts ein. Der Chart hatte sich
 *    bis dahin längst einen eigenen Stand gesetzt und lehnte den echten ab.
 * 2. Die Obergrenze (`replayMaxVisible`) begrenzte nur den Regler, nicht die
 *    ausgelieferten Kerzen. Eine Sperre, die man umgeht, indem man nicht am
 *    Regler zieht, ist keine Sperre — und der Trainer steht auf genau dieser
 *    Sperre.
 *
 * Deshalb stehen die beiden Entscheidungen hier als reine Funktionen.
 */

import { DEFAULT_START_FRACTION, MIN_VISIBLE_CANDLES } from './training'

/**
 * So viele Kerzen zeigt das Startbild höchstens.
 *
 * Der gewählte Vorlauf kann 800 Kerzen umfassen. Die alle gleichzeitig ins Bild
 * zu zwingen, klingt nach „maximalem Kontext", ist aber das Gegenteil: Auf
 * 1200 px wäre jede Kerze anderthalb Pixel breit, und an Strichen liest niemand
 * eine Struktur. Das Startbild zeigt darum einen lesbaren Ausschnitt am rechten
 * Rand; der Rest des Vorlaufs ist einen Rauszoom entfernt.
 */
export const MAX_START_FENSTER = 200

/**
 * Der geltende Replay-Stand: der Wunsch, geklemmt an Reihe und Obergrenze.
 *
 * `wunsch` ist der Startpunkt der Übung (`replayStart`). Fehlt er — jeder Chart
 * außerhalb des Trainers, etwa in der Watchlist oder unter `/trainer/frei` —,
 * gilt der bisherige Rückfall auf knapp zwei Drittel der Reihe. Der ist dort
 * weiterhin richtig und verschwindet deshalb nicht.
 *
 * `cap` ist die Obergrenze der Übung: vor dem Festschreiben der Startpunkt
 * selbst, danach der nächste Haltepunkt. `null` heißt „keine Grenze", nicht
 * „Grenze null" — eine beendete Sitzung ist frei.
 */
export function replayStand(
  total: number,
  wunsch: number | null | undefined,
  cap: number | null | undefined,
): number {
  if (!Number.isFinite(total) || total <= 0) return 0

  const reihe = Math.floor(total)
  const obergrenze =
    cap != null && Number.isFinite(cap)
      ? Math.min(reihe, Math.max(1, Math.round(cap)))
      : reihe

  const basis =
    wunsch != null && Number.isFinite(wunsch)
      ? Math.round(wunsch)
      : Math.max(MIN_VISIBLE_CANDLES, Math.round(reihe * DEFAULT_START_FRACTION))

  return Math.min(obergrenze, Math.max(1, basis))
}

/**
 * Wie viele Kerzen das Startbild zeigt.
 *
 * `freigegeben` ist der Replay-Stand, also die Zahl der Kerzen, die überhaupt
 * gezeigt werden dürfen. Mehr als das darf nie ins Bild — dahinter liegt die
 * Zukunft, und die zu sehen ist genau der Fehler, den diese Übung ausschließt.
 */
export function startFenster(freigegeben: number): number {
  if (!Number.isFinite(freigegeben) || freigegeben <= 0) return 0
  return Math.max(1, Math.min(Math.floor(freigegeben), MAX_START_FENSTER))
}
