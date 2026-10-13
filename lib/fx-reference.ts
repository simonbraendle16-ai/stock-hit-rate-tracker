import { TradeInputError } from './trade-input-error'

export const FX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const ECB_FX_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'
export type FxReference = { rates: Record<string, number>; referenceAt: Date; fetchedAt: Date }
export type PlanFxSnapshot = {
  id: string
  portfolioId: number
  quoteCurrency: string
  accountCurrency: string
  rate: number
  referenceAt: Date
  fetchedAt: Date
  source: string
  warning: string | null
}

export function requireFxDate(date: Date, now = new Date()): void {
  const age = now.getTime() - date.getTime()
  if (!Number.isFinite(age) || age < 0 || age > FX_MAX_AGE_MS) {
    throw new TradeInputError('Der FX-Plankurs muss aus den letzten sieben Tagen stammen und darf nicht in der Zukunft liegen.')
  }
}

/** Parse only the ECB daily feed, without resolving XML entities or accepting HTML. */
export function parseEcbFx(xml: string, now = new Date()): FxReference {
  if (xml.length > 100_000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || !xml.includes('www.ecb.int/vocabulary/2002-08-01/eurofxref')) {
    throw new TradeInputError('Die EZB-Antwort enthält keine gültigen Referenzkurse.')
  }
  const date = xml.match(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>/)
  if (!date) throw new TradeInputError('Referenzdatum der EZB fehlt.')
  const referenceAt = new Date(`${date[1]}T00:00:00.000Z`)
  if (!Number.isFinite(referenceAt.getTime()) || referenceAt.toISOString().slice(0, 10) !== date[1]) throw new TradeInputError('Referenzdatum der EZB ist ungültig.')
  requireFxDate(referenceAt, now)
  const rates: Record<string, number> = { EUR: 1 }
  for (const match of xml.matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9]+(?:\.[0-9]+)?)['"]\s*\/>/g)) {
    const value = Number(match[2])
    if (!Number.isFinite(value) || value <= 0 || rates[match[1]] !== undefined) throw new TradeInputError('Ungültiger oder doppelter EZB-Kurs.')
    rates[match[1]] = value
  }
  if (!rates.USD || Object.keys(rates).length < 3) throw new TradeInputError('EZB-Kurstabelle ist unvollständig.')
  return { rates, referenceAt, fetchedAt: now }
}

/** ECB quotes foreign units per EUR; the application needs account units per quote unit. */
export function crossFx(rates: Record<string, number>, quote: string, account: string): number {
  if (!/^[A-Z]{3}$/.test(quote) || !/^[A-Z]{3}$/.test(account)) throw new TradeInputError('Depot- und Kurswährung müssen bekannt sein.')
  if (quote === account) return 1
  const rate = rates[account] / rates[quote]
  if (!Number.isFinite(rate) || rate <= 0) throw new TradeInputError(`Für ${quote} → ${account} liefert die EZB keinen Referenzkurs. Einen belegten manuellen Ersatz wählen.`)
  return rate
}
