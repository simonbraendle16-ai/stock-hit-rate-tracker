/**
 * Zeit <-> logischer Index für die Zeichenebene.
 *
 * Warum das überhaupt nötig ist: `timeScale().timeToCoordinate()` kennt nur
 * Zeiten, die als Datenpunkt in der Serie liegen. Für alles andere gibt es
 * `null` — und `null` hieß in der Zeichenebene bisher "diese Zeichnung wird
 * übersprungen". Daraus folgten die beiden Fehler, die das Zeichnen praktisch
 * unbrauchbar gemacht haben:
 *
 *  1. **Nichts ließ sich in die Zukunft zeichnen.** Jeder Klick rechts vom
 *     letzten Balken wurde auf die letzte Kerze geklemmt. Eine Trendlinie nach
 *     vorn zu verlängern oder ein Ziel vor den Kurs zu legen war unmöglich —
 *     also genau das, wofür man im Replay zeichnet.
 *  2. **Beim Zurückspulen verschwanden Zeichnungen ganz.** Der Replay schneidet
 *     die Serie ab; alles, was hinter dem aktuellen Stand lag, war keine
 *     gültige Zeit mehr und damit weg statt nur außerhalb des Bildes.
 *
 * `logicalToCoordinate()` hat diese Grenze nicht: Es rechnet linear über den
 * sichtbaren Bereich hinaus. Deshalb läuft hier alles über den **logischen
 * Index** statt über die Zeit, und diese Datei ist die Übersetzung dazwischen.
 *
 * Rein und getestet — Chart-Objekte kommen hier bewusst nicht vor.
 */

/** Kleinster erlaubter Rasterabstand; schützt vor Division durch 0. */
const MIN_STEP = 1

/**
 * Rasterabstand einer Kerzenreihe in Sekunden.
 *
 * Bewusst der **Median** und nicht der Mittelwert: Wochenenden, Feiertage und
 * Handelspausen reißen einzelne Lücken von vielen Stunden. Der Mittelwert
 * würde dadurch nach oben verzerrt und die Fortschreibung in die Zukunft liefe
 * viel zu grob — der Median trifft den normalen Abstand zweier Kerzen.
 */
export function barStep(times: number[]): number {
  if (times.length < 2) return 60
  const diffs: number[] = []
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1]
    if (d > 0) diffs.push(d)
  }
  if (diffs.length === 0) return 60
  diffs.sort((a, b) => a - b)
  const mid = Math.floor(diffs.length / 2)
  const median =
    diffs.length % 2 === 1 ? diffs[mid] : Math.round((diffs[mid - 1] + diffs[mid]) / 2)
  return Math.max(MIN_STEP, median)
}

/** Index der letzten Kerze mit `times[i] <= time` (binäre Suche), sonst -1. */
function floorIndex(times: number[], time: number): number {
  let lo = 0
  let hi = times.length - 1
  let res = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (times[mid] <= time) {
      res = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return res
}

/**
 * Zeit -> logischer Index.
 *
 * Innerhalb der Reihe wird zwischen den beiden Nachbarkerzen interpoliert,
 * außerhalb auf dem Raster fortgeschrieben (vor der ersten Kerze negativ,
 * hinter der letzten über `times.length - 1` hinaus). Das Ergebnis ist deshalb
 * **nie** `null` — eine Zeichnung verliert ihren Platz nicht mehr, nur weil der
 * Replay gerade weniger Kerzen zeigt.
 */
export function timeToLogical(times: number[], step: number, time: number): number {
  if (times.length === 0) return 0
  const s = Math.max(MIN_STEP, step)
  const last = times.length - 1
  if (time <= times[0]) return (time - times[0]) / s
  if (time >= times[last]) return last + (time - times[last]) / s

  const i = floorIndex(times, time)
  if (i < 0) return (time - times[0]) / s
  if (i >= last) return last
  const spanne = times[i + 1] - times[i]
  return spanne > 0 ? i + (time - times[i]) / spanne : i
}

/**
 * Logischer Index -> Zeit. Umkehrung von `timeToLogical`.
 *
 * Jenseits der Reihe entstehen dabei **künstliche** Zeiten auf dem Raster. Das
 * ist Absicht: Ein Punkt in der Zukunft braucht eine Zeit, die sich später
 * wieder an dieselbe Stelle zurückrechnen lässt. Kommen die echten Kerzen
 * nach, liegt der Punkt dort, wo er hingehört (siehe Test).
 */
export function logicalToTime(times: number[], step: number, logical: number): number {
  if (times.length === 0) return 0
  const s = Math.max(MIN_STEP, step)
  const last = times.length - 1
  if (logical <= 0) return Math.round(times[0] + logical * s)
  if (logical >= last) return Math.round(times[last] + (logical - last) * s)

  const i = Math.floor(logical)
  const rest = logical - i
  if (i >= last) return times[last]
  return Math.round(times[i] + rest * (times[i + 1] - times[i]))
}

/**
 * Zeit auf die nächstgelegene Kerze bzw. Rasterposition schnappen.
 *
 * Ein gezeichneter Punkt muss auf einem Balken sitzen — zwischen zwei Kerzen
 * gibt es auf der Achse keinen Platz für ihn. Innerhalb der Reihe ist das eine
 * echte Kerzenzeit, außerhalb die fortgeschriebene Rasterzeit.
 */
export function snapTime(times: number[], step: number, time: number): number {
  if (times.length === 0) return time
  return logicalToTime(times, step, Math.round(timeToLogical(times, step, time)))
}

/**
 * Liegt diese Zeit hinter der letzten echten Kerze?
 *
 * Die Oberfläche darf das zeigen (gestrichelt, blasser), damit erkennbar
 * bleibt, was Beobachtung ist und was Projektion.
 */
export function istProjektion(times: number[], time: number): boolean {
  return times.length > 0 && time > times[times.length - 1]
}

/** Schätzung, wenn sich die Achse nicht messen lässt (lange Kurse brauchen mehr). */
export const ACHSEN_BREITE_FALLBACK = 70

/**
 * Prüft eine gemessene Breite der Preisachse und gibt sie oder die Schätzung.
 *
 * Warum überhaupt geprüft wird: Die Chart-Bibliothek gibt die Breite nicht
 * verlässlich her. `priceScale().width()` liefert hier **0**, und
 * `timeScale().width()` schließt einen Teil der Achse mit ein — daraus
 * gerechnet blieben ein paar Pixel übrig. Beide Wege sahen nach einer Messung
 * aus und waren doch falsch; gemessen wird die Achse deshalb am DOM (sie ist
 * die letzte Zelle der Chart-Tabelle). Diese Funktion ist das Sieb davor.
 *
 * Eine Breite von 0 ist der gefährlichste Fall: Sie bedeutet „die Achse ist
 * keinen Pixel breit", und dann legt sich die Zeichenebene über die ganze
 * Achse und schluckt die Klicks, mit denen man sie zieht. Genau daran ist das
 * Ziehen an der Preisachse gescheitert. Mehr als die halbe Chartbreite ist
 * ebenso wenig eine Achse.
 */
export function pruefeAchsenBreite(containerBreite: number, gemessen: number): number {
  if (!Number.isFinite(containerBreite) || !Number.isFinite(gemessen)) {
    return ACHSEN_BREITE_FALLBACK
  }
  const b = Math.round(gemessen)
  if (b <= 0 || b > containerBreite / 2) return ACHSEN_BREITE_FALLBACK
  return b
}
