// Zwei Erfassungswege für einen Trade — die gemeinsame Quelle für Client,
// Server-Gate und Auswertung.
//
// **Langfristig** ist der volle Weg: die neun Douglas-Fragen als Gate, Elliott,
// Setup, Begründung, Emotions-Check-in beim Ein- und Ausstieg. So war die App
// bis hierher gebaut.
//
// **Schnell** ist der kurze Weg für Trades, die keine halbe Stunde Vorbereitung
// vertragen (Scalp, Intraday-Reaktion). Er verlangt nur das Nötigste — Ticker,
// Richtung, Einstieg und **Stop** — und überspringt die neun Fragen bewusst.
//
// Der Stop bleibt auch hier Pflicht: „Risiko ist vor dem Einstieg definiert" ist
// nicht die Formalie, die einen schnellen Trade langsam macht, sondern der Kern
// der Sache. Weggelassen wird die Begründungs-Schicht, nicht die Risikogrenze.
//
// Damit die Abkürzung nicht unsichtbar bleibt, trägt jeder Trade seinen Weg als
// Feld mit sich (`tradeKind`, Migration 0018) und zeigt ihn in der Oberfläche.
// Ein schneller Trade ist dadurch weiterhin ein *ehrlicher* Trade: man sieht ihm
// an, dass kein Gate lief.

export const TRADE_KINDS = ['langfristig', 'schnell'] as const

export type TradeKind = (typeof TRADE_KINDS)[number]

/** Der Weg, den ein Trade ohne ausdrückliche Wahl nimmt. */
export const DEFAULT_TRADE_KIND: TradeKind = 'langfristig'

export const TRADE_KIND_LABEL: Record<TradeKind, string> = {
  langfristig: 'Geplanter Trade',
  schnell: 'Schneller Trade',
}

/** Kurzform für Abzeichen und enge Spalten. */
export const TRADE_KIND_BADGE: Record<TradeKind, string> = {
  langfristig: 'GEPLANT',
  schnell: 'SCHNELL',
}

export const TRADE_KIND_HINT: Record<TradeKind, string> = {
  langfristig:
    'Der volle Weg: neun Douglas-Fragen als Gate, Elliott-Zählung, Setup und Begründung.',
  schnell:
    'Nur das Nötigste: Ticker, Richtung, Einstieg und Stop. Die neun Fragen entfallen bewusst.',
}

/**
 * Fremde Eingabe auf einen gültigen Weg bringen. Unbekanntes fällt auf den
 * vollen Weg zurück — im Zweifel lieber ein Gate zu viel als eines zu wenig.
 */
export function normalizeTradeKind(v: string | null | undefined): TradeKind {
  return (TRADE_KINDS as readonly string[]).includes(v ?? '')
    ? (v as TradeKind)
    : DEFAULT_TRADE_KIND
}

/** Läuft dieser Trade den kurzen Weg? */
export function isQuickTrade(v: string | null | undefined): boolean {
  return normalizeTradeKind(v) === 'schnell'
}

/**
 * Verlangt dieser Weg das Fragen-Gate vor dem Aktivieren?
 *
 * Einzige Stelle, an der diese Frage beantwortet wird — `activateTrade` und das
 * Formular fragen beide hier, damit Server und Oberfläche nie auseinanderlaufen.
 */
export function requiresPreTradeGate(v: string | null | undefined): boolean {
  return !isQuickTrade(v)
}

/**
 * Verlangt dieser Weg den Emotions-Check-in?
 *
 * Beim schnellen Trade ist er **freiwillig**: Wer eine Bewegung mitnimmt, füllt
 * keine Skala aus — er würde sie sonst hastig wegklicken, und eine hastig
 * weggeklickte Skala ist schlechter als keine. Wird trotzdem einer erfasst,
 * zählt er ganz normal in die Auswertung.
 */
export function requiresMoodCheck(v: string | null | undefined): boolean {
  return !isQuickTrade(v)
}
