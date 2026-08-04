/**
 * Das Aussehen der Charts — eine Einstellung, app-weit.
 *
 * Warum überhaupt einstellbar: Ein Chart, den man nicht lesen kann, ist keine
 * Grundlage für eine Entscheidung. Welche Farben lesbar sind, hängt am Auge
 * und am Bildschirm, nicht am Geschmack der App — deshalb gehört das dem
 * Nutzer und nicht dem Design.
 *
 * Warum als eigene Datei mit reiner Logik: Gespeichert wird JSON aus der
 * Datenbank, also **fremde Daten**. Sie werden nie direkt an
 * `lightweight-charts` gereicht, sondern immer durch `normalizeAppearance`
 * — dort wird jedes Feld geprüft und Fehlendes mit dem Standard aufgefüllt.
 * So bleibt eine ältere gespeicherte Einstellung nach einer Erweiterung
 * gültig, statt den Chart schwarz zu lassen.
 *
 * Die Werte sind bewusst Hex-/rgba-Zeichenketten und keine CSS-Variablen:
 * Canvas kennt `var(--positive)` nicht (siehe `components/chart/colors.ts`).
 */

import { CHART_COLORS } from '@/components/chart/colors'

export interface ChartAppearance {
  /** Chart-Hintergrund. `transparent` = die Karte scheint durch. */
  bg: string
  /** Gitterlinien. */
  grid: string
  gridVisible: boolean
  /** Achsenbeschriftung. */
  text: string
  /** Achsenlinien. */
  border: string
  /** Kerzenkörper steigend / fallend. */
  up: string
  down: string
  /** Dochte. */
  wickUp: string
  wickDown: string
  /** Kerzenumrandung. */
  borderUp: string
  borderDown: string
  /** Linien-/Flächenserie und Crosshair-Marke. */
  accent: string
  /**
   * Hohlkerzen: steigende Kerzen nur als Umriss, wie in TradingViews
   * „Hollow Candles". Betrifft nur den Kerzenstil, nicht die Farben.
   */
  hollow: boolean
}

/** Der Auslieferungszustand — „Indigo-Nacht", wie die App aussieht. */
export const DEFAULT_APPEARANCE: ChartAppearance = {
  bg: 'transparent',
  grid: 'rgba(163, 166, 205, 0.08)',
  gridVisible: true,
  text: CHART_COLORS.muted,
  border: 'rgba(163, 166, 205, 0.15)',
  up: CHART_COLORS.up,
  down: CHART_COLORS.down,
  wickUp: CHART_COLORS.up,
  wickDown: CHART_COLORS.down,
  borderUp: CHART_COLORS.up,
  borderDown: CHART_COLORS.down,
  accent: CHART_COLORS.accent,
  hollow: false,
}

/**
 * Fertige Vorlagen als Startpunkt. Sie sind **kein** eigener Zustand — wer
 * eine anwendet, bekommt ihre Werte in die eigene Einstellung geschrieben und
 * kann jedes Feld danach einzeln ändern. Ein Preset, das man nicht anfassen
 * darf, wäre genau die Bevormundung, die hier weg soll.
 */
export const APPEARANCE_PRESETS: {
  id: string
  label: string
  hint: string
  values: ChartAppearance
}[] = [
  {
    id: 'indigo',
    label: 'Indigo-Nacht',
    hint: 'Die Farben der App.',
    values: DEFAULT_APPEARANCE,
  },
  {
    id: 'tradingview',
    label: 'TradingView',
    hint: 'Die Originalfarben von TradingView.',
    values: {
      bg: '#131722',
      grid: 'rgba(42, 46, 57, 0.6)',
      gridVisible: true,
      text: '#B2B5BE',
      border: 'rgba(178, 181, 190, 0.2)',
      up: '#089981',
      down: '#F23645',
      wickUp: '#089981',
      wickDown: '#F23645',
      borderUp: '#089981',
      borderDown: '#F23645',
      accent: '#2962FF',
      hollow: false,
    },
  },
  {
    id: 'schwarzweiss',
    label: 'Schwarz / Weiß',
    hint: 'Schwarzer Hintergrund, weiße Kerzen — nur Struktur, keine Farbe.',
    values: {
      bg: '#000000',
      grid: 'rgba(255, 255, 255, 0.06)',
      gridVisible: true,
      text: '#c8c8c8',
      border: 'rgba(255, 255, 255, 0.22)',
      up: '#000000',
      down: '#ffffff',
      wickUp: '#ffffff',
      wickDown: '#ffffff',
      borderUp: '#ffffff',
      borderDown: '#ffffff',
      accent: '#ffffff',
      hollow: false,
    },
  },
  {
    id: 'hell',
    label: 'Hell',
    hint: 'Weißer Hintergrund für helle Räume und zum Ausdrucken.',
    values: {
      bg: '#ffffff',
      grid: 'rgba(42, 46, 57, 0.08)',
      gridVisible: true,
      text: '#131722',
      border: 'rgba(19, 23, 34, 0.2)',
      up: '#1f9e6d',
      down: '#c93a4a',
      wickUp: '#1f9e6d',
      wickDown: '#c93a4a',
      borderUp: '#1f9e6d',
      borderDown: '#c93a4a',
      accent: '#2962FF',
      hollow: false,
    },
  },
]

/**
 * Erlaubte Farbschreibweisen: `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()`
 * und das Schlüsselwort `transparent`.
 *
 * Der Wert geht als Zeichenkette in Canvas-Eigenschaften. Ungeprüfte Fremdtexte
 * gehören dort nicht hinein — nicht weil Canvas ausführbar wäre, sondern weil
 * ein ungültiger Wert die Serie still ungefärbt lässt und der Fehler dann im
 * Chart gesucht wird statt in den Einstellungen.
 */
const COLOR_PATTERN =
  /^(transparent|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/

export function isValidColor(v: unknown): v is string {
  return typeof v === 'string' && COLOR_PATTERN.test(v.trim())
}

/**
 * Aus beliebigem Gespeichertem eine gültige Einstellung machen: Jedes Feld
 * wird einzeln geprüft, Ungültiges und Fehlendes fällt auf den Standard
 * zurück. Nie werfen — ein kaputter Eintrag darf den Chart nicht kosten.
 */
export function normalizeAppearance(raw: unknown): ChartAppearance {
  const out = { ...DEFAULT_APPEARANCE }
  if (raw == null) return out

  let obj: unknown = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch {
      return out
    }
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return out
  const src = obj as Record<string, unknown>

  for (const key of Object.keys(DEFAULT_APPEARANCE) as (keyof ChartAppearance)[]) {
    const v = src[key]
    if (key === 'gridVisible' || key === 'hollow') {
      if (typeof v === 'boolean') out[key] = v
    } else if (isValidColor(v)) {
      out[key] = v.trim()
    }
  }
  return out
}

/** Entspricht die Einstellung noch dem Auslieferungszustand? */
export function isDefaultAppearance(a: ChartAppearance): boolean {
  return (Object.keys(DEFAULT_APPEARANCE) as (keyof ChartAppearance)[]).every(
    (k) => a[k] === DEFAULT_APPEARANCE[k],
  )
}

/** Welche Vorlage passt genau auf diese Einstellung? (Sonst „eigene".) */
export function matchingPreset(a: ChartAppearance): string | null {
  const treffer = APPEARANCE_PRESETS.find((p) =>
    (Object.keys(DEFAULT_APPEARANCE) as (keyof ChartAppearance)[]).every(
      (k) => p.values[k] === a[k],
    ),
  )
  return treffer?.id ?? null
}
