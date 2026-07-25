/**
 * Farbwerte und Geometrie der Motion-Graphik.
 *
 * Die Farben sind eine bewusste Kopie aus `app/globals.css` (.dark —
 * „Indigo-Nacht"). Quelle der Wahrheit bleibt dort; hier stehen sie
 * doppelt, weil die Farben ins gerenderte Video eingebrannt werden und
 * Remotion die CSS-Variablen der App nicht kennt. Wer die Tokens in
 * globals.css ändert, muss das Video neu rendern:
 * `pnpm video:mp4 && pnpm video:poster`.
 *
 * Leitplanke aus CLAUDE.md: kein Neon, kein Sci-Fi. Tiefe entsteht über
 * Deckkraft und Haarlinien, nicht über Leuchten.
 */
export const COLORS = {
  navy: '#0f1124',
  panel: '#191c3a',
  hairline: '#2e3369',
  cream: '#ecebfa',
  muted: '#a3a6cd',
  steel: '#7b6bf6',
  green: '#4fd6a0',
  red: '#f2607a',
  gold: '#e0b455',
} as const

export const LAYOUT = {
  width: 1920,
  height: 1080,
  /** Rand oberhalb/unterhalb der Preisfläche. */
  padTop: 130,
  padBottom: 150,
  /** Abstand der Kerzen-Mittelpunkte. */
  step: 30,
  /** Breite eines Kerzenkörpers — kräftig genug, um den Scrim der Anmeldeseite zu überstehen. */
  candleWidth: 14,
  /** x der ersten Kerze im Chart-Koordinatensystem. */
  originX: 140,
  /** Fester Preisbereich — verhindert vertikales Zappeln beim Scrollen. */
  priceMin: 93,
  priceMax: 123,
  /** Bei welchem Anteil der Bildbreite die neueste Kerze steht. */
  anchor: 0.68,
} as const

/** Preis → y-Koordinate. Fester Maßstab über das gesamte Video. */
export function priceToY(price: number): number {
  const plot = LAYOUT.height - LAYOUT.padTop - LAYOUT.padBottom
  const t = (LAYOUT.priceMax - price) / (LAYOUT.priceMax - LAYOUT.priceMin)
  return LAYOUT.padTop + t * plot
}

/** Kerzen-Index → x-Koordinate im Chart-Koordinatensystem (vor der Kamera). */
export function indexToX(index: number): number {
  return LAYOUT.originX + index * LAYOUT.step
}

/** Deutsche Zahlformatierung für die Kurslabels im Video. */
export function formatPrice(value: number): string {
  return value.toFixed(2).replace('.', ',')
}
