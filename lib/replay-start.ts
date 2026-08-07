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

/**
 * Der kleinste Stand, den die Bedienleiste anbietet.
 *
 * Unter dreißig Kerzen ist ein Chart kein Chart mehr. Der Wert stand bisher als
 * nackte 30 in der Leiste; er gehört hierher, weil die Skala aus derselben
 * Quelle kommen muss wie die Klemmung — sonst zeigt der Regler einen Bereich
 * an, den `replayStand` gar nicht annimmt.
 */
export const REGLER_MIN = 30

/**
 * Die Skala der Replay-Leiste: worüber der Regler spannt und was davon gesperrt
 * ist.
 *
 * Bis hierher war der Maximalwert des Reglers die **Obergrenze** der Übung,
 * nicht die Reihe. Vor dem Loslassen ist diese Obergrenze exakt der Startpunkt
 * — der Griff stand damit beim Öffnen am rechten Anschlag und Play war
 * abgeschaltet. Es sah aus wie „die Übung beginnt am Ende", war aber die
 * Sperre, die sich die Skala mit dem Fortschritt teilte.
 *
 * Sperre und Skala sind deshalb ab hier zwei Dinge: Der Regler spannt immer
 * über die **ganze** Reihe, und der gesperrte Teil wird als solcher gezeigt,
 * statt die Achse zu verkürzen. Verborgen bleibt die Zukunft trotzdem — sie
 * wird nur nicht mehr weggelogen.
 */
export interface ReplaySkala {
  /** Kleinster anwählbarer Stand. */
  min: number
  /** Größter Wert der Achse — immer die volle Reihe. */
  max: number
  /** Der geltende Stand, geklemmt an die Freigabe. */
  wert: number
  /** Bis hierher ist freigegeben; darüber liegt die Sperre. */
  grenze: number
  /** Steht überhaupt eine Sperre? */
  gesperrt: boolean
  /** Anteil der Leiste (0–1), der gesperrt ist — für die Schraffur. */
  sperrAnteil: number
}

export function replaySkala(
  total: number,
  visible: number,
  cap: number | null | undefined,
): ReplaySkala {
  const reihe = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0
  const min = Math.min(reihe, REGLER_MIN)
  const grenze = replayStand(reihe, cap ?? reihe, cap)
  const wert = Math.min(Math.max(replayStand(reihe, visible, cap), min), Math.max(grenze, min))
  const spanne = reihe - min

  return {
    min,
    max: Math.max(reihe, min),
    wert,
    grenze: Math.max(grenze, min),
    gesperrt: grenze < reihe,
    sperrAnteil: spanne > 0 ? Math.min(1, Math.max(0, (reihe - grenze) / spanne)) : 0,
  }
}

/**
 * Was ein Druck auf Play bewirken soll.
 *
 * Play war bisher abgeschaltet, sobald der Stand die Freigabe erreicht hatte —
 * und beim Öffnen einer Übung ist das der Normalfall. Ein toter Knopf erklärt
 * aber nichts; er sieht aus wie ein Fehler. Also bekommt Play drei Bedeutungen,
 * und zwar genau eine je Lage:
 *
 * - `spielen` — es ist Luft bis zur Freigabe, die Kerzen laufen.
 * - `loslassen` — der Durchlauf wurde noch nie losgelassen. Der Druck lässt ihn
 *   los; das ist dieselbe Aussage wie „Nein — weiterlaufen" und wird auch so
 *   festgehalten (siehe `training-workspace.tsx`). Ohne diese Buchung wäre die
 *   Enthaltung verschwunden, und Enthaltungen sind die einzige Zahl gegen
 *   Überhandeln.
 * - `blockiert` — der Durchlauf läuft, steht aber an einem Haltepunkt. Hier
 *   darf Play nichts tun: Die Frage daneben ist der Sinn des Haltepunkts.
 */
export type PlayAktion = 'spielen' | 'loslassen' | 'blockiert'

export function playAktion(
  stand: number,
  grenze: number,
  losgelassen: boolean,
): PlayAktion {
  if (Number.isFinite(stand) && Number.isFinite(grenze) && stand < grenze) return 'spielen'
  return losgelassen ? 'blockiert' : 'loslassen'
}

/** Wofür der sichtbare Ausschnitt zuletzt gesetzt wurde. */
export interface AnsichtStand {
  /** Instrument + Markt + Zeitebene. */
  key: string
  /** Stand der Replay-Startpunkt schon fest, als gesetzt wurde? */
  hatteReplay: boolean
  /** Zeitstempel der ERSTEN Kerze — die Kennung der Reihe. */
  ersteZeit: number
}

/**
 * Muss der sichtbare Ausschnitt neu gesetzt werden?
 *
 * Die dritte Entscheidung, die im `useEffect` nicht nachprüfbar war — und wie
 * die beiden davor war sie falsch. Sie trennt zwei Vorgänge, die im Chart
 * gleich aussehen und gegensätzlich behandelt werden müssen:
 *
 *  - **Der Replay läuft.** Dieselbe Reihe wächst hinten. Der Ausschnitt wird
 *    mitgezogen, der Zoom des Nutzers überlebt. Ein Chart, der einen dabei
 *    wegreißt, ist im Replay unbrauchbar.
 *  - **Die Zeitebene wechselt.** Die Reihe wird ausgetauscht. Der Ausschnitt
 *    der alten Reihe passt nicht mehr und muss neu gesetzt werden.
 *
 * Bis hierher kannte der Code nur den Schlüssel (`key`) — und der steht beim
 * Wechsel sofort auf der neuen Ebene, während die Kerzen erst danach eintreffen.
 * Gemessen: Der Ausschnitt wurde für die 120 zugeschnittenen Kerzen der alten
 * Ebene gesetzt und beim Eintreffen der 2290 neuen um 2170 Stellen verschoben,
 * also hinter die Daten. Die höhere Zeitebene lag zusammengedrängt am Rand.
 * Das ist nicht kosmetisch: „Gehandelt wird von oben nach unten" steht in
 * `lib/replay-timeframes.ts` als Begründung des ganzen Trainers.
 *
 * Die Reihe wird deshalb an ihrer ERSTEN Kerze erkannt, nicht an ihrer Länge:
 * Beim Abspielen bleibt die erste Kerze stehen, beim Austausch ändert sie sich.
 * Die Länge taugt nicht — sie ändert sich in beiden Fällen.
 */
export function ansichtNeuSetzen(
  vorher: AnsichtStand | null,
  jetzt: { key: string; ersteZeit: number; replayFenster: boolean; len: number },
): boolean {
  // Ohne Kerzen ist jeder Ausschnitt geraten. Vor allem darf nichts gemerkt
  // werden: Das verbrauchte die eine Gelegenheit, ihn richtig zu setzen.
  if (jetzt.len <= 1) return false
  if (vorher == null) return true
  if (vorher.key !== jetzt.key) return true
  // Andere Reihe unter demselben Schlüssel — der Ebenenwechsel.
  if (vorher.ersteZeit !== jetzt.ersteZeit) return true
  // Der Startpunkt der Übung entsteht erst aus den Kerzen und trifft daher
  // nach dem ersten Setzen ein. Dann einmal nachziehen.
  return !vorher.hatteReplay && jetzt.replayFenster
}
