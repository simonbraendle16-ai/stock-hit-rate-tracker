/** Prices are in quote currency; capital and fees are in portfolio currency. */
export type MoneyCurrency = {
  quoteCurrency: string
  accountCurrency: string
  quoteToAccountRate: number
  fxRateAt: Date | null
}
export type MoneyMetadata = { [K in keyof MoneyCurrency]?: MoneyCurrency[K] | null }

export function currencyCode(raw: string | null | undefined): string | null {
  const code = raw?.trim().toUpperCase()
  return code && /^[A-Z]{3}$/.test(code) ? code : null
}

export function portfolioCurrency(p: { currency?: string | null }, fallback = 'EUR'): string {
  return currencyCode(p.currency) ?? currencyCode(fallback) ?? 'EUR'
}

export function resolveMoneyCurrency(args: {
  accountCurrency: string
  quoteCurrency?: string | null
  resolvedCurrency?: string | null
  rates: Record<string, number>
  ratesAt?: Date | null
  now?: Date
}): MoneyCurrency {
  const accountCurrency = currencyCode(args.accountCurrency)
  const declared = currencyCode(args.quoteCurrency)
  const resolved = currencyCode(args.resolvedCurrency)
  if (args.quoteCurrency && !declared) throw new Error('Ungültige Kurswährung.')
  if (declared && resolved && declared !== resolved) {
    throw new Error(`Kurswährung ${declared} widerspricht dem aufgelösten Instrument (${resolved}).`)
  }
  const quoteCurrency = resolved ?? declared
  if (!accountCurrency || !quoteCurrency) throw new Error('Depot- und Kurswährung müssen bekannt sein.')
  if (quoteCurrency === accountCurrency) {
    return { quoteCurrency, accountCurrency, quoteToAccountRate: 1, fxRateAt: null }
  }
  const rate = args.rates[quoteCurrency]
  if (!Number.isFinite(rate) || rate <= 0 || !args.ratesAt || !Number.isFinite(args.ratesAt.getTime())) {
    throw new Error(`Für ${quoteCurrency} → ${accountCurrency} fehlt ein gültiger Depotkurs mit Zeitpunkt. Keine 1:1-Umrechnung.`)
  }
  const age = (args.now ?? new Date()).getTime() - args.ratesAt.getTime()
  if (age < 0 || age > 7 * 24 * 60 * 60 * 1000) {
    throw new Error('Der FX-Plankurs muss aus den letzten sieben Tagen stammen und darf nicht in der Zukunft liegen.')
  }
  return { quoteCurrency, accountCurrency, quoteToAccountRate: rate, fxRateAt: args.ratesAt }
}

/** A plan snapshot is not a broker settlement FX rate. */
export function settledFxRate(t: MoneyMetadata): number | null {
  const rate = frozenFxRate(t)
  return rate !== null && t.quoteCurrency === t.accountCurrency ? rate : null
}

export function requireFrozenFxRate(t: MoneyMetadata): number {
  const rate = frozenFxRate(t)
  if (rate === null) throw new Error('Währungsangaben und gültiger FX-Snapshot fehlen. Keine automatische Neuberechnung des Altbestands.')
  return rate
}

export function currencyAssignment(current: string | null | undefined, raw: string) {
  const currency = currencyCode(raw)
  if (!currency) throw new Error('Gültige Depotwährung erforderlich.')
  if (current && currencyCode(current) !== currency) throw new Error('Eine bestätigte Depotwährung wird nicht durch einen Labelwechsel geändert. Umrechnung erforderlich.')
  return current ? null : { currency, fxRates: null, fxRatesAt: null }
}

/** Never use a newly edited portfolio FX rate to revalue an old trade. */
export function frozenFxRate(t: MoneyMetadata): number | null {
  const quote = currencyCode(t.quoteCurrency)
  const account = currencyCode(t.accountCurrency)
  if (!quote || !account) return null
  const rate = t.quoteToAccountRate
  if (!Number.isFinite(rate) || (rate as number) <= 0) return null
  if (quote === account && rate !== 1) return null
  if (quote !== account && (!t.fxRateAt || !Number.isFinite(new Date(t.fxRateAt).getTime()))) return null
  return rate as number
}

export function scopeCurrency(portfolios: { currency?: string | null }[], fallback: string): string {
  const currencies = new Set(portfolios.map(p => portfolioCurrency(p, fallback)))
  if (currencies.size > 1) throw new Error('Diese Auswahl enthält verschiedene Depotwährungen. Bitte ein einzelnes Depot wählen; Beträge werden nicht ungeprüft addiert.')
  return currencies.values().next().value ?? fallback
}
