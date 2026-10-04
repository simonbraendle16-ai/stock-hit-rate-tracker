import { currencyCode } from './money-currency'

/** Broker amounts, never a conversion of the planning snapshot. */
export type SettlementReceipt = {
  currency: string
  netAmount: number
  grossAmount: number | null
  entryFeesTreatment: 'included' | 'excluded'
  commission: number | null
  financing: number | null
  quoteToAccountRate: number | null
  fxRateAt: string | null
  evidence: string
  capturedAt: string
  source: 'manual_broker_receipt' | 'avatrade_history'
}

export function normalizeSettlementReceipt(raw: unknown): SettlementReceipt {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Abrechnungsbeleg fehlt.')
  const r = raw as Record<string, unknown>
  const keys = ['currency', 'netAmount', 'grossAmount', 'entryFeesTreatment', 'commission',
    'financing', 'quoteToAccountRate', 'fxRateAt', 'evidence', 'capturedAt', 'source']
  if (Object.keys(r).some(k => !keys.includes(k))) throw new Error('Unbekanntes Abrechnungsfeld.')
  const currency = currencyCode(typeof r.currency === 'string' ? r.currency : null)
  if (!currency) throw new Error('Abrechnungswährung fehlt.')
  const amount = (key: string, required = false) => {
    if (r[key] == null && !required) return null
    if (typeof r[key] !== 'number' || !Number.isFinite(r[key])) throw new Error(`${key} muss ein endlicher Betrag sein.`)
    return r[key] as number
  }
  const netAmount = amount('netAmount', true)!
  const grossAmount = amount('grossAmount')
  const commission = amount('commission')
  const financing = amount('financing') // Negative financing denotes a broker credit.
  if (commission !== null && commission < 0) throw new Error('Provision darf nicht negativ sein.')
  if (r.entryFeesTreatment !== 'included' && r.entryFeesTreatment !== 'excluded') {
    throw new Error('Es muss belegt sein, ob Einstiegsgebühren im Nettobetrag enthalten sind.')
  }
  if (r.source !== 'manual_broker_receipt' && r.source !== 'avatrade_history') throw new Error('Belegquelle ist ungültig.')
  if (typeof r.evidence !== 'string' || !r.evidence.trim() || r.evidence.length > 4000) throw new Error('Belegreferenz fehlt oder ist zu lang.')
  if (typeof r.capturedAt !== 'string' || !Number.isFinite(Date.parse(r.capturedAt))) throw new Error('Belegzeitpunkt fehlt.')
  const quoteToAccountRate = amount('quoteToAccountRate')
  const fxRateAt = r.fxRateAt == null ? null : r.fxRateAt
  if ((quoteToAccountRate === null) !== (fxRateAt === null) ||
      (quoteToAccountRate !== null && (quoteToAccountRate <= 0 || typeof fxRateAt !== 'string' || !Number.isFinite(Date.parse(fxRateAt))))) {
    throw new Error('Tatsächlicher FX benötigt einen positiven Kurs und Belegzeitpunkt.')
  }
  return { currency, netAmount, grossAmount, entryFeesTreatment: r.entryFeesTreatment,
    commission, financing, quoteToAccountRate, fxRateAt: fxRateAt as string | null,
    evidence: r.evidence.trim(), capturedAt: new Date(r.capturedAt).toISOString(), source: r.source }
}

export function receiptFromPayload(payload: string | null): SettlementReceipt | null {
  try { return normalizeSettlementReceipt(JSON.parse(payload ?? '{}').settlement) } catch { return null }
}

export function receiptSignature(receipt: SettlementReceipt) {
  // Observation time does not make a repeated broker statement a correction.
  return JSON.stringify({ ...receipt, capturedAt: undefined })
}
