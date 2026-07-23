// Zentrale Geldformatierung. Vorher stand `currency: 'EUR'` an zwölf Stellen
// fest verdrahtet — eine einstellbare Kontowährung war damit unmöglich.
//
// Wichtig: Das ist eine reine ANZEIGE-Ebene. Kurse (Einstieg, Stop, Ziel)
// notieren in der Währung des Instruments und werden hier nie umgerechnet.

export const DEFAULT_CURRENCY = 'EUR'

/**
 * Währungen, die die App anbietet. Die Server Action validiert gegen dieselbe
 * Liste — sie kann sie nur nicht selbst exportieren, weil eine 'use server'-Datei
 * ausschließlich async Funktionen exportieren darf.
 */
export const SUPPORTED_CURRENCIES = [
  ['EUR', 'Euro (€)'],
  ['USD', 'US-Dollar ($)'],
  ['CHF', 'Schweizer Franken (CHF)'],
  ['GBP', 'Britisches Pfund (£)'],
] as const

export type MoneyOptions = {
  /** Nachkommastellen erzwingen (Standard: 2, bei großen Beträgen oft 0). */
  maximumFractionDigits?: number
  minimumFractionDigits?: number
  /** Vorzeichen auch bei positiven Beträgen zeigen (für P&L). */
  signed?: boolean
}

/**
 * Betrag in Kontowährung, deutsches Format.
 *
 * @example formatMoney(1234.5, 'EUR') → "1.234,50 €"
 * @example formatMoney(1234.5, 'USD', { signed: true }) → "+1.234,50 $"
 */
export function formatMoney(
  value: number | null | undefined,
  currency: string = DEFAULT_CURRENCY,
  opts: MoneyOptions = {},
): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const { signed = false, ...digits } = opts
  const formatted = value.toLocaleString('de-DE', {
    style: 'currency',
    currency: currency || DEFAULT_CURRENCY,
    maximumFractionDigits: digits.maximumFractionDigits ?? 2,
    minimumFractionDigits: digits.minimumFractionDigits ?? 0,
  })
  return signed && value > 0 ? `+${formatted}` : formatted
}

/** Nur das Währungssymbol — für Feldbeschriftungen wie „Kapitaleinsatz (€)". */
export function currencySymbol(currency: string = DEFAULT_CURRENCY): string {
  try {
    const parts = new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: currency || DEFAULT_CURRENCY,
    }).formatToParts(0)
    return parts.find((p) => p.type === 'currency')?.value ?? currency
  } catch {
    return currency
  }
}

/** Erzeugt einen gebundenen Formatierer — spart die Währung bei jedem Aufruf. */
export function moneyFormatter(currency: string = DEFAULT_CURRENCY) {
  return (value: number | null | undefined, opts?: MoneyOptions) =>
    formatMoney(value, currency, opts)
}
