/**
 * Die gemeinsame Chartsprache der App.
 *
 * Vorher folgte jedes Diagramm eigenen Regeln für Gitter, Achsen, Flächen und
 * Referenzlinien — deshalb wirkten die Charts uneinheitlich, obwohl sie
 * dieselben Daten zeigen. Diese Datei ist die eine Quelle dafür; sie enthält
 * bewusst nur Konstanten (kein JSX, keine Komponenten), damit sie überall
 * importierbar bleibt.
 *
 * Farben kommen ausschließlich aus den Tokens in `app/globals.css`.
 * `--positive`/`--negative` sind für Ergebnisdaten reserviert, `--chart-*`
 * für alles andere.
 */

/** Waagerechtes Gitter, durchgezogene Haarlinie — institutioneller als Punkte. */
export const CHART_GRID = {
  vertical: false,
  stroke: 'var(--border)',
  strokeOpacity: 0.5,
  strokeDasharray: '0',
} as const

/** Achsenbeschriftung: Mono mit Tabellenziffern, keine Achsenlinien. */
export const CHART_TICK = {
  fontSize: 11,
  fill: 'var(--muted-foreground)',
  fontFamily: 'var(--font-mono)',
} as const

export const CHART_AXIS = {
  tickLine: false,
  axisLine: false,
  tickMargin: 8,
  tick: CHART_TICK,
} as const

/** Hilfslinien (Nulllinie, 50-%-Marke). */
export const CHART_REFERENCE = {
  stroke: 'var(--muted-foreground)',
  strokeDasharray: '4 4',
  strokeOpacity: 0.45,
} as const

/**
 * Aufbau-Bewegung. Gleiche Dauer wie `--motion-slow` in `app/globals.css`,
 * damit sich Kurven und Balken im selben Takt wie die Panels aufbauen.
 */
export const CHART_MOTION = {
  isAnimationActive: true,
  animationDuration: 700,
  animationEasing: 'ease-out',
} as const

/** Deckkraft der Flächenverläufe unter Linien — oben satt, unten aus. */
export const AREA_FILL = { top: 0.22, bottom: 0 } as const

/** Zielzone — dieselbe Optik wie im Chart-Cockpit (`components/chart/drawing-layer.tsx`). */
export const CHART_ZONE = {
  fill: 'var(--positive)',
  fillOpacity: 0.08,
  stroke: 'var(--positive)',
  strokeOpacity: 0.5,
} as const
