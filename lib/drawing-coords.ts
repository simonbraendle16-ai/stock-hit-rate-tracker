/**
 * Die Punkte einer Zeichnung als Zahlen — Kurs und Balken, eintippbar.
 *
 * Warum das gebraucht wird: Bis hierher war jede Zeichnung nur so genau, wie
 * die Hand am Zeiger. Für eine Struktur-Linie reicht das; für einen Stop nicht.
 * Wer weiß, dass die Marke bei 63.533,80 liegt, will sie hinschreiben und nicht
 * dreimal hineinzoomen, um sie zu treffen.
 *
 * **Wie TradingView es macht** (im Reiter „Coordinates" des Zeichnungs-Dialogs
 * nachgesehen, SBUX 4 h): je Punkt zwei Felder, `Price` und `Bar`. Der
 * Bar-Wert ist dabei **negativ und relativ zur letzten Kerze** (dort standen
 * −264 und −115), also kein absoluter Index in die Reihe und kein Zeitstempel.
 * Das ist die einzige Zählweise, die stehen bleibt, wenn Historie nachwächst:
 * Ein absoluter Index verschöbe sich mit jedem Sammellauf des Kerzenspeichers,
 * und ein Zeitstempel wäre für Punkte in der Zukunft eine erfundene Zeit, die
 * niemand ablesen kann. 0 ist die letzte Kerze, positive Werte liegen davor in
 * der Zukunft — genau dorthin projiziert man im Replay.
 *
 * Rein und getestet; Chart-Objekte kommen hier bewusst nicht vor. Umgerechnet
 * wird über `lib/chart-coords.ts`, damit es nicht zwei Meinungen darüber gibt,
 * wo ein Balken liegt.
 */

import { logicalToTime, timeToLogical } from './chart-coords'

/**
 * Zeit -> Balkenzahl relativ zur letzten Kerze (0 = letzte Kerze, negativ =
 * davor, positiv = Projektion in die Zukunft).
 */
export function balkenIndex(times: number[], step: number, time: number): number {
  if (times.length === 0) return 0
  return Math.round(timeToLogical(times, step, time)) - (times.length - 1)
}

/** Balkenzahl relativ zur letzten Kerze -> Zeit. Umkehrung von `balkenIndex`. */
export function zeitAusBalken(times: number[], step: number, balken: number): number {
  if (times.length === 0) return 0
  return logicalToTime(times, step, Math.round(balken) + (times.length - 1))
}

/**
 * Eingetippter Kurs -> Zahl.
 *
 * Deutsche Schreibweise ist hier die normale: `63.533,80`. Ein Punkt kann also
 * Tausender-Trenner ODER Dezimalzeichen sein — entschieden wird am Komma: Gibt
 * es eines, sind alle Punkte Trenner. Ohne Komma bleibt der Punkt das
 * Dezimalzeichen (`0.618` tippt sich so von der Zahlenreihe).
 *
 * Gibt `null` statt einer Notlösung zurück: Ein halb erkannter Kurs, der still
 * eine Zeichnung verschiebt, ist schlimmer als ein Feld, das nichts tut.
 */
export function parseKurs(text: string): number | null {
  const t = text.replace(/\s|'|’/g, '').trim()
  if (t.length === 0) return null
  const bereinigt = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  if (!/^[+-]?\d*\.?\d+$/.test(bereinigt)) return null
  const v = Number(bereinigt)
  return Number.isFinite(v) ? v : null
}

/** Eingetippte Balkenzahl -> ganze Zahl (Vorzeichen erlaubt), sonst `null`. */
export function parseBalken(text: string): number | null {
  const t = text.replace(/\s/g, '').trim()
  if (!/^[+-]?\d+$/.test(t)) return null
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}

/**
 * Kurs für ein Eingabefeld.
 *
 * Die Nachkommastellen richten sich nach der Größenordnung — dieselbe Staffel
 * wie beim Aufnehmen eines Kurses aus dem Chart (`alsKurs` im Trainer): Ein
 * Index braucht zwei Stellen, ein Kryptopaar sechs. Feste vier Stellen wären
 * bei 63.533,8000 Ballast und bei 0,000021 eine Null.
 */
export function formatKurs(v: number): string {
  if (!Number.isFinite(v)) return ''
  const abs = Math.abs(v)
  const stellen = abs >= 100 ? 2 : abs >= 1 ? 4 : 6
  return v.toLocaleString('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: stellen,
  })
}
