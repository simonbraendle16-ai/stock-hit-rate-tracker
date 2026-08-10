/**
 * Womit eine NEUE Zeichnung beginnt — die eigenen Fibonacci-Levels, Farbe und
 * Strichstärke (Migration 0030, `user_settings.drawingDefaults`).
 *
 * Warum das überhaupt gespeichert wird: Levels je Zeichnung einstellen zu
 * können ist nur die halbe Miete. Wer mit 1,272 und 1,618 arbeitet, will sie
 * nicht bei jedem einzelnen Fib neu anhaken — diese Reibung ist genau das, was
 * ein Werkzeug im Alltag unbenutzbar macht.
 *
 * Wie überall bei gespeichertem JSON: gelesen ausschließlich über
 * `normalizeDrawingDefaults`, jedes Feld einzeln geprüft, Ungültiges fällt auf
 * den Auslieferungszustand. Wirft nie — an einer Einstellungsfrage darf das
 * Zeichnen nicht scheitern.
 */

import {
  DEFAULT_FIB,
  DEFAULT_FIBEXT,
  normalizeFibStil,
  type FibStil,
} from './fib-levels'
import { farbeGueltig } from './drawing-style'
import { CHART_COLORS } from '@/components/chart/colors'

/**
 * Eine benannte Fib-Zusammenstellung, wie TradingViews „Templates".
 *
 * Der Standard beantwortet nur „womit fange ich an" — eine Vorlage beantwortet
 * „womit arbeite ich in DIESER Lage". Wer für Retracements im Trend andere
 * Levels führt als für Korrekturen, braucht beides nebeneinander, nicht
 * nacheinander.
 */
export interface FibVorlage {
  name: string
  stil: FibStil
}

/** Mehr als das ist keine Auswahl mehr, sondern eine zweite Suchaufgabe. */
export const MAX_FIB_VORLAGEN = 12
/** Längere Namen sprengen die Liste im Panel. */
export const MAX_VORLAGEN_NAME = 32

export interface DrawingDefaults {
  /** Standard-Levels für das Fib-Retracement. */
  fib: FibStil
  /** Standard-Levels für die trendbasierte Fib-Extension. */
  fibext: FibStil
  /** Farbe neuer Zeichnungen (außer Fib — die tragen ihre eigene). */
  farbe: string
  /** Strichstärke neuer Zeichnungen. */
  staerke: number
  /** Benannte Fib-Zusammenstellungen, auf beide Fib-Werkzeuge anwendbar. */
  fibVorlagen: FibVorlage[]
}

export const DEFAULT_DRAWING_DEFAULTS: DrawingDefaults = {
  fib: DEFAULT_FIB,
  fibext: DEFAULT_FIBEXT,
  farbe: CHART_COLORS.accent,
  staerke: 1.5,
  fibVorlagen: [],
}

export function normalizeDrawingDefaults(raw: unknown): DrawingDefaults {
  const out: DrawingDefaults = {
    fib: normalizeFibStil(null, DEFAULT_FIB),
    fibext: normalizeFibStil(null, DEFAULT_FIBEXT),
    farbe: DEFAULT_DRAWING_DEFAULTS.farbe,
    staerke: DEFAULT_DRAWING_DEFAULTS.staerke,
    fibVorlagen: [],
  }
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

  out.fib = normalizeFibStil(src.fib, DEFAULT_FIB)
  out.fibext = normalizeFibStil(src.fibext, DEFAULT_FIBEXT)
  if (farbeGueltig(src.farbe)) out.farbe = src.farbe.trim()
  if (typeof src.staerke === 'number' && Number.isFinite(src.staerke)) {
    out.staerke = Math.min(6, Math.max(0.5, src.staerke))
  }

  if (Array.isArray(src.fibVorlagen)) {
    const namen = new Set<string>()
    for (const eintrag of src.fibVorlagen) {
      if (!eintrag || typeof eintrag !== 'object') continue
      const e = eintrag as Record<string, unknown>
      const name = typeof e.name === 'string' ? e.name.trim().slice(0, MAX_VORLAGEN_NAME) : ''
      // Namenlos wäre die Vorlage nicht wiederzufinden, doppelt nicht zu
      // unterscheiden — beides fällt weg, statt eine Zeile ohne Nutzen zu tragen.
      if (!name || namen.has(name.toLowerCase())) continue
      namen.add(name.toLowerCase())
      out.fibVorlagen.push({ name, stil: normalizeFibStil(e.stil, DEFAULT_FIB) })
      if (out.fibVorlagen.length >= MAX_FIB_VORLAGEN) break
    }
  }

  return out
}

/** Der Stil, mit dem eine neue Zeichnung des Typs angelegt wird. */
export function stilFuerNeueZeichnung(
  d: DrawingDefaults,
  type: string,
): { color?: string; width?: number; fib?: FibStil } {
  if (type === 'fib') return { fib: d.fib, color: d.fib.farbe, width: d.fib.staerke }
  if (type === 'fibext') return { fib: d.fibext, color: d.fibext.farbe, width: d.fibext.staerke }
  return { color: d.farbe, width: d.staerke }
}
