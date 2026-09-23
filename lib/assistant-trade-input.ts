import { ApiError, onlyKeys, positiveId } from '@/lib/assistant-api'
import type { TradeInput } from '@/app/actions/trades'

const markets = ['aktien', 'krypto', 'forex', 'rohstoffe', 'etf', 'optionen', 'sonstiges']
const fields = ['portfolioId', 'ticker', 'market', 'tradeKind', 'direction', 'entryPrice',
  'stopLoss', 'takeProfit', 'strategy', 'setupTags', 'investedAmount', 'leverage',
  'contracts', 'feeEntry', 'feeExit', 'broker', 'notes', 'source']

function textValue(value: unknown, label: string, max: number, required = false) {
  if (value == null && !required) return undefined
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
    throw new ApiError(422, `${label} ist ungültig.`)
  }
  return value.trim()
}

function numberValue(value: unknown, label: string, required = false, zeroAllowed = false) {
  if (value == null && !required) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || (zeroAllowed ? value < 0 : value <= 0)) {
    throw new ApiError(422, `${label} muss eine gültige Zahl sein.`)
  }
  return value
}

export function normalizeAssistantTradeInput(raw: Record<string, unknown>) {
  onlyKeys(raw, fields)
  const portfolioId = positiveId(String(raw.portfolioId ?? ''))
  const ticker = textValue(raw.ticker, 'Ticker', 40, true)!.toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9.\-!/^=:_]{0,39}$/.test(ticker)) throw new ApiError(422, 'Ticker ist ungültig.')
  if (!markets.includes(String(raw.market))) throw new ApiError(422, 'Markt ist ungültig.')
  if (raw.tradeKind !== 'schnell' && raw.tradeKind !== 'langfristig') throw new ApiError(422, 'Erfassungsweg ist ungültig.')
  if (raw.direction !== 'long' && raw.direction !== 'short') throw new ApiError(422, 'Richtung ist ungültig.')
  const source = raw.source
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new ApiError(422, 'Quelle und Nutzerbestätigung fehlen.')
  const details = source as Record<string, unknown>
  onlyKeys(details, ['kind', 'capturedAt', 'confirmedByUser'])
  if (details.kind !== 'user_statement' || details.confirmedByUser !== true ||
      typeof details.capturedAt !== 'string' || !Number.isFinite(new Date(details.capturedAt).getTime())) {
    throw new ApiError(422, 'Eine bestätigte Nutzeraussage mit Zeitpunkt ist erforderlich.')
  }
  const tags = raw.setupTags
  if (tags != null && (!Array.isArray(tags) || tags.length > 3 || tags.some((tag) => typeof tag !== 'string' || tag.length > 80))) {
    throw new ApiError(422, 'Setup-Tags sind ungültig.')
  }
  const input: TradeInput = {
    portfolioId,
    ticker,
    market: String(raw.market),
    tradeKind: raw.tradeKind,
    direction: raw.direction,
    entryPrice: numberValue(raw.entryPrice, 'Einstieg', true)!,
    stopLoss: numberValue(raw.stopLoss, 'Stop-Loss', true)!,
    takeProfit: numberValue(raw.takeProfit, 'Kursziel', true)!,
    strategy: textValue(raw.strategy, 'Strategie', 4000),
    setupTags: tags as string[] | undefined,
    investedAmount: numberValue(raw.investedAmount, 'Kapitaleinsatz'),
    leverage: numberValue(raw.leverage, 'Hebel'),
    contracts: numberValue(raw.contracts, 'Kontrakte'),
    feeEntry: numberValue(raw.feeEntry, 'Einstiegsgebühr', false, true),
    feeExit: numberValue(raw.feeExit, 'Ausstiegsgebühr', false, true),
    broker: textValue(raw.broker, 'Broker', 200),
    notes: textValue(raw.notes, 'Notizen', 8000),
  }
  return { input, source: { kind: 'user_statement', capturedAt: new Date(details.capturedAt).toISOString() } }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stable(item)]))
  }
  return value
}

export function canonicalBody(value: Record<string, unknown>) {
  return JSON.stringify(stable(value))
}
