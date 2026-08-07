/**
 * Aussehen einer einzelnen Zeichnung — Farbe, Stärke, Strichart.
 *
 * Bis hierher konnte man eine gezogene Linie nicht mehr anfassen: keine Farbe,
 * keine Stärke, kein gestrichelt. Damit war jede Zeichnung gleich wichtig, und
 * ein Chart mit mehr als drei Linien nicht mehr lesbar — der Grund, warum die
 * Werkzeuge sich „nach nichts" anfühlten.
 *
 * Wie überall in dieser App: Der gespeicherte Wert ist JSON aus der Datenbank,
 * also fremde Daten. Gelesen wird ausschließlich über `normalizeDrawingStyle`
 * — Farben werden gegen ein Muster geprüft, **bevor** sie in ein SVG-Attribut
 * gehen. Ein ungültiger Wert würde die Linie sonst still ungefärbt lassen und
 * der Fehler dann im Chart gesucht statt in der Einstellung.
 */

import type { DrawingStyle } from '@/app/actions/drawings'
import { CHART_COLORS } from '@/components/chart/colors'

const FARB_MUSTER = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|transparent)$/

/**
 * Die Strichart einer Zeichnung.
 *
 * TradingView führt sie im Knopf „Style" der schwebenden Leiste als drei Bilder
 * (durchgezogen · gestrichelt · gepunktet) — bei uns war es bis hierher ein
 * Schalter „gestrichelt ja/nein". Der Unterschied ist im Chart nicht kosmetisch:
 * Eine gepunktete Linie liest sich als Vermutung, eine durchgezogene als
 * gesetzte Marke. Wer beides nur gestrichelt zeichnen kann, verliert genau
 * diese Abstufung.
 */
export type Strichart = 'solid' | 'dashed' | 'dotted'

export const STRICHARTEN: Strichart[] = ['solid', 'dashed', 'dotted']

export interface AufgeloesterStil {
  color: string
  width: number
  /**
   * Führender Wert für die Strichart. `dashed` bleibt daneben stehen, weil es
   * die ältere gespeicherte Schreibweise ist — geschrieben werden beide (siehe
   * `strichSetzen`), gelesen wird `strich`.
   */
  strich: Strichart
  dashed: boolean
  label: string | null
}

/** Die Palette der Zeichenfarben — bewusst knapp und aus den Chart-Tokens. */
export const ZEICHEN_FARBEN: { id: string; label: string; wert: string }[] = [
  { id: 'akzent', label: 'Akzent', wert: CHART_COLORS.accent },
  { id: 'hell', label: 'Hell', wert: CHART_COLORS.foreground },
  { id: 'gold', label: 'Gold', wert: CHART_COLORS.warning },
  { id: 'gruen', label: 'Grün', wert: CHART_COLORS.up },
  { id: 'rot', label: 'Rot', wert: CHART_COLORS.down },
  { id: 'grau', label: 'Grau', wert: CHART_COLORS.muted },
]

export const ZEICHEN_STAERKEN = [1, 1.5, 2, 3] as const

export function farbeGueltig(v: unknown): v is string {
  return typeof v === 'string' && FARB_MUSTER.test(v.trim())
}

/**
 * Fremde Daten -> gültiges Aussehen. Fällt für jedes Feld einzeln zurück,
 * wirft nie. `standardFarbe` erlaubt es dem Aufrufer, den Typ-Standard zu
 * setzen (eine Position ist grün/rot, eine Trendlinie akzentfarben).
 */
export function normalizeDrawingStyle(
  raw: DrawingStyle | null | undefined,
  standardFarbe: string = CHART_COLORS.accent,
): AufgeloesterStil {
  const d: AufgeloesterStil = {
    color: standardFarbe,
    width: 1.5,
    strich: 'solid',
    dashed: false,
    label: null,
  }
  if (!raw || typeof raw !== 'object') return d

  if (farbeGueltig(raw.color)) d.color = raw.color.trim()
  if (typeof raw.width === 'number' && Number.isFinite(raw.width)) {
    d.width = Math.min(6, Math.max(0.5, raw.width))
  }
  // Reihenfolge mit Absicht: erst die alte Schreibweise, dann die neue. So
  // behält eine vor der Umstellung gespeicherte Zeichnung ihr Aussehen, und
  // eine danach gespeicherte gewinnt gegen ihren eigenen Kompatibilitätswert.
  if (typeof raw.dashed === 'boolean') d.strich = raw.dashed ? 'dashed' : 'solid'
  if (typeof raw.strich === 'string' && (STRICHARTEN as string[]).includes(raw.strich)) {
    d.strich = raw.strich as Strichart
  }
  d.dashed = d.strich !== 'solid'
  if (typeof raw.label === 'string' && raw.label.trim().length > 0) {
    d.label = raw.label.trim().slice(0, 80)
  }
  return d
}

/** SVG-`stroke-dasharray` zur Strichart — eine Stelle, damit es überall gleich aussieht. */
export function strichArray(dashed: boolean): string | undefined {
  return dashed ? '5 4' : undefined
}

/**
 * SVG-`stroke-dasharray` zur dreiwertigen Strichart.
 *
 * Der Punkt skaliert mit der Strichstärke: Ein festes `1 3` verschwindet bei
 * 3 px Stärke zu einer fast durchgezogenen Linie — man stellt „gepunktet" ein
 * und sieht keinen Unterschied. `strokeLinecap="round"` macht daraus im Chart
 * echte Punkte statt kurzer Striche.
 */
export function strichMuster(strich: Strichart, width = 1.5): string | undefined {
  if (strich === 'dashed') return '5 4'
  if (strich === 'dotted') {
    const w = Math.max(0.5, width)
    return `${w.toFixed(1)} ${(w * 2.4).toFixed(1)}`
  }
  return undefined
}

/**
 * Die Strichart in einen speicherbaren Stil schreiben.
 *
 * Schreibt BEIDE Felder: `strich` als führenden Wert und `dashed` als das, was
 * ältere Leser (und der Chart-Code, der noch auf `style.dashed` schaut) davon
 * verstehen. Eine Stelle dafür, damit die zwei nie auseinanderlaufen.
 */
export function strichSetzen(strich: Strichart): { strich: Strichart; dashed: boolean } {
  return { strich, dashed: strich !== 'solid' }
}
