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

export interface AufgeloesterStil {
  color: string
  width: number
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
    dashed: false,
    label: null,
  }
  if (!raw || typeof raw !== 'object') return d

  if (farbeGueltig(raw.color)) d.color = raw.color.trim()
  if (typeof raw.width === 'number' && Number.isFinite(raw.width)) {
    d.width = Math.min(6, Math.max(0.5, raw.width))
  }
  if (typeof raw.dashed === 'boolean') d.dashed = raw.dashed
  if (typeof raw.label === 'string' && raw.label.trim().length > 0) {
    d.label = raw.label.trim().slice(0, 80)
  }
  return d
}

/** SVG-`stroke-dasharray` zur Strichart — eine Stelle, damit es überall gleich aussieht. */
export function strichArray(dashed: boolean): string | undefined {
  return dashed ? '5 4' : undefined
}
