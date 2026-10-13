import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from './db'
import { fxReferenceCache, planFxSnapshot } from './db/schema'
import { loadOwnedPortfolio } from './portfolio-context'
import { parseFxRates } from './margin'
import { currencyCode, resolveMoneyCurrency, type MoneyCurrency } from './money-currency'
import { crossFx, ECB_FX_URL, parseEcbFx, requireFxDate, type FxReference, type PlanFxSnapshot } from './fx-reference'
import { TradeInputError } from './trade-input-error'

let pending: Promise<FxReference> | null = null
async function reference(): Promise<{ value: FxReference; warning: string | null }> {
  const [stored] = await db.select().from(fxReferenceCache).where(eq(fxReferenceCache.id, 'ecb')).limit(1)
  const now = new Date()
  const fallback = stored ? { rates: stored.rates, referenceAt: stored.referenceAt, fetchedAt: stored.fetchedAt } : null
  if (fallback && now.getTime() - fallback.fetchedAt.getTime() >= 0 && now.getTime() - fallback.fetchedAt.getTime() < 3_600_000) {
    requireFxDate(fallback.referenceAt, now)
    return { value: fallback, warning: null }
  }
  try {
    if (!pending) pending = (async () => {
      const response = await fetch(ECB_FX_URL, { cache: 'no-store', signal: AbortSignal.timeout(8_000) })
      if (!response.ok) throw new Error('ECB unavailable')
      const value = parseEcbFx(await response.text(), new Date())
      await db.insert(fxReferenceCache).values({ id: 'ecb', ...value }).onConflictDoUpdate({ target: fxReferenceCache.id, set: value })
      return value
    })().finally(() => { pending = null })
    return { value: await pending, warning: null }
  } catch {
    if (fallback) {
      requireFxDate(fallback.referenceAt, now)
      return { value: fallback, warning: 'EZB-Abruf fehlgeschlagen. Der noch gültige gespeicherte Referenzstand wird verwendet.' }
    }
    throw new TradeInputError('Aktuelle EZB-Kurse konnten nicht geladen werden. Eingaben bleiben erhalten; erneut versuchen oder einen belegten manuellen Ersatz wählen.')
  }
}

export async function createPlanFxSnapshot(userId: string, portfolioId: number, rawQuote: string): Promise<PlanFxSnapshot> {
  const p = await loadOwnedPortfolio(userId, portfolioId)
  const accountCurrency = currencyCode(p.currency), quoteCurrency = currencyCode(rawQuote)
  if (!accountCurrency || !quoteCurrency) throw new TradeInputError('Depot- und Kurswährung müssen bekannt sein.')
  let rate = 1, referenceAt = new Date(), fetchedAt = referenceAt, source = 'same_currency', warning: string | null = null
  if (accountCurrency !== quoteCurrency) {
    if (p.fxMode === 'manual') {
      const currency = resolveMoneyCurrency({ accountCurrency, quoteCurrency, rates: parseFxRates(p.fxRates), ratesAt: p.fxRatesAt })
      rate = currency.quoteToAccountRate; referenceAt = currency.fxRateAt!; source = 'manual'
    } else {
      const result = await reference()
      rate = crossFx(result.value.rates, quoteCurrency, accountCurrency)
      referenceAt = result.value.referenceAt; fetchedAt = result.value.fetchedAt; source = 'ecb'; warning = result.warning
    }
  }
  const value = { id: randomUUID(), userId, portfolioId, quoteCurrency, accountCurrency, rate, referenceAt, fetchedAt, source }
  await db.insert(planFxSnapshot).values(value)
  const { userId: _owner, portfolioId: _portfolio, ...snapshot } = value
  return { ...snapshot, portfolioId, warning }
}

/** Use the exact server-issued preview snapshot, never a client-supplied rate. */
export async function readPlanFxSnapshot(userId: string, portfolioId: number, id: string, quote: string, account: string): Promise<MoneyCurrency> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new TradeInputError('FX-Vorschau erneut laden.')
  const [s] = await db.select().from(planFxSnapshot).where(and(eq(planFxSnapshot.id, id), eq(planFxSnapshot.userId, userId), eq(planFxSnapshot.portfolioId, portfolioId))).limit(1)
  if (!s || s.quoteCurrency !== quote || s.accountCurrency !== account) throw new TradeInputError('FX-Vorschau gehört nicht zu diesem Depot und Währungspaar. Erneut laden.')
  requireFxDate(s.referenceAt)
  // Also reject old snapshots for same-currency plans; no stale form confirmation.
  if (!Number.isFinite(s.rate) || s.rate <= 0 || (quote === account && s.rate !== 1)) throw new TradeInputError('Ungültiger FX-Snapshot.')
  return { quoteCurrency: quote, accountCurrency: account, quoteToAccountRate: s.rate, fxRateAt: quote === account ? null : s.referenceAt }
}
