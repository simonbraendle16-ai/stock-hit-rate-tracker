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

export interface DrawingDefaults {
  /** Standard-Levels für das Fib-Retracement. */
  fib: FibStil
  /** Standard-Levels für die trendbasierte Fib-Extension. */
  fibext: FibStil
  /** Farbe neuer Zeichnungen (außer Fib — die tragen ihre eigene). */
  farbe: string
  /** Strichstärke neuer Zeichnungen. */
  staerke: number
}

export const DEFAULT_DRAWING_DEFAULTS: DrawingDefaults = {
  fib: DEFAULT_FIB,
  fibext: DEFAULT_FIBEXT,
  farbe: CHART_COLORS.accent,
  staerke: 1.5,
}

export function normalizeDrawingDefaults(raw: unknown): DrawingDefaults {
  const out: DrawingDefaults = {
    fib: normalizeFibStil(null, DEFAULT_FIB),
    fibext: normalizeFibStil(null, DEFAULT_FIBEXT),
    farbe: DEFAULT_DRAWING_DEFAULTS.farbe,
    staerke: DEFAULT_DRAWING_DEFAULTS.staerke,
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
