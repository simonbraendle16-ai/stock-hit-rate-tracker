/**
 * Die Farben des Chart-Cockpits — eine Quelle für Kerzen, Plan-Linien und
 * Zeichnungen (Design-Etappe E).
 *
 * Warum überhaupt Hex-Werte und keine CSS-Variablen: `lightweight-charts` und
 * die Zeichenebene bekommen ihre Farben als Zeichenkette in die Canvas/SVG —
 * dort greift `var(--positive)` nicht. Deshalb stehen die Werte hier einmal
 * ausgeschrieben und werden **nirgends sonst** wiederholt.
 *
 * Sie sind die Hex-Entsprechung der Tokens aus `app/globals.css`
 * („Indigo-Nacht"). Ändert sich dort die Palette, ändert sie sich hier — und
 * nur hier.
 *
 * Ausgenommen ist bewusst das TradingView-Schema in `price-chart.tsx`: das
 * sind die Originalfarben von TradingView und dürfen sich *nicht* mitbewegen,
 * sonst ist es kein TradingView-Schema mehr.
 */

/** Instrumentenfarben — dieselben Werte wie `--positive` / `--destructive` … */
export const CHART_COLORS = {
  /** `--foreground` — Zeichnungen ohne eigene Farbe, Griffe, Text im Chart */
  foreground: '#ecebfa',
  /** `--background` — Füllung von Marken, die auf dem Chart liegen */
  background: '#0f1124',
  /** `--primary` — Standardfarbe einer Zeichnung, Linien-/Flächenserie */
  accent: '#7b6bf6',
  /** `--positive` — steigende Kerze, Ziel, Gewinnzone */
  up: '#4fd6a0',
  /** `--destructive` — fallende Kerze, Stop, Verlustzone */
  down: '#f2607a',
  /** `--warning` — Invalidation, Fibonacci, Marken „teilweise" */
  warning: '#e0b455',
  /** `--muted-foreground` — Achsen, Beschriftung, Chikou */
  muted: '#a3a6cd',
} as const

/**
 * Zwei zusätzliche Linienfarben. Sie stehen für nichts — sie sind nur da, damit
 * sich acht gleichzeitig eingeblendete Indikatoren noch unterscheiden lassen.
 * Deshalb tragen sie keine Bedeutung wie „Gewinn" oder „Stop".
 */
export const EXTRA_SERIES_COLORS = ['#5fb8b0', '#d88f50'] as const

/** Die vier Ebenen des Trading-Plans — im Chart und in der Plan-Leiste gleich. */
export const PLAN_COLORS = {
  entry: CHART_COLORS.accent,
  stop: CHART_COLORS.down,
  target: CHART_COLORS.up,
  invalidation: CHART_COLORS.warning,
} as const
