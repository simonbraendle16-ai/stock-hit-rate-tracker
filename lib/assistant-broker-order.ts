import { ApiError, onlyKeys, positiveId } from '@/lib/assistant-api'

const fields = ['portfolioId', 'brokerAccountId', 'brokerOrderId', 'brokerPositionId',
  'ticker', 'direction', 'orderType', 'state', 'limitPrice', 'executionPrice',
  'quantity', 'stopLoss', 'takeProfit', 'placedAt', 'filledAt', 'observedAt'] as const

function requiredText(value: unknown, label: string, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new ApiError(422, `${label} ist ungültig.`)
  }
  return value.trim()
}

function optionalText(value: unknown, label: string, max: number) {
  return value == null ? null : requiredText(value, label, max)
}

function optionalNumber(value: unknown, label: string) {
  if (value == null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ApiError(422, `${label} muss eine positive Zahl sein.`)
  }
  return value
}

function optionalDate(value: unknown, label: string) {
  if (value == null) return null
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new ApiError(422, `${label} ist ungültig.`)
  }
  return new Date(value)
}

export function normalizeBrokerOrder(raw: Record<string, unknown>) {
  onlyKeys(raw, fields)
  const portfolioId = positiveId(String(raw.portfolioId ?? ''))
  const brokerAccountId = requiredText(raw.brokerAccountId, 'Brokerkonto', 80)
  const brokerOrderId = requiredText(raw.brokerOrderId, 'Broker-Order-ID', 100)
  const ticker = requiredText(raw.ticker, 'Ticker', 40).toUpperCase()
  if (!/^[#A-Z0-9][#A-Z0-9.\-!/^=:_]{0,39}$/.test(ticker)) {
    throw new ApiError(422, 'Ticker ist ungültig.')
  }
  const direction = raw.direction
  if (direction !== 'long' && direction !== 'short') {
    throw new ApiError(422, 'Richtung ist ungültig.')
  }
  const orderType = raw.orderType
  if (orderType !== 'limit' && orderType !== 'market' && orderType !== 'stop' && orderType !== 'other') {
    throw new ApiError(422, 'Ordertyp ist ungültig.')
  }
  const state = raw.state
  if (state !== 'accepted' && state !== 'filled' && state !== 'cancelled') {
    throw new ApiError(422, 'Brokerstatus ist ungültig.')
  }
  const observedAt = optionalDate(raw.observedAt, 'Beobachtungszeit')
  if (!observedAt) throw new ApiError(422, 'Beobachtungszeit fehlt.')
  const placedAt = optionalDate(raw.placedAt, 'Auftragszeit')
  const filledAt = optionalDate(raw.filledAt, 'Ausführungszeit')
  const executionPrice = optionalNumber(raw.executionPrice, 'Ausführungskurs')
  return {
    portfolioId, broker: 'avatrade', brokerAccountId, brokerOrderId,
    brokerPositionId: optionalText(raw.brokerPositionId, 'Broker-Positions-ID', 100),
    ticker, direction, orderType, state,
    limitPrice: optionalNumber(raw.limitPrice, 'Limitkurs'), executionPrice,
    quantity: optionalNumber(raw.quantity, 'Menge'),
    stopLoss: optionalNumber(raw.stopLoss, 'Stop-Loss'),
    takeProfit: optionalNumber(raw.takeProfit, 'Kursziel'),
    placedAt, filledAt, observedAt,
  }
}

export function matchingPlannedTradeId(order: {
  ticker: string; direction: string; limitPrice: number | null
}, plans: Array<{ id: number; ticker: string; direction: string; entryPrice: number }>) {
  if (order.limitPrice == null) return null
  const normalizedTicker = order.ticker.replace(/^#/, '')
  const matches = plans.filter((plan) =>
    plan.ticker.replace(/^#/, '').toUpperCase() === normalizedTicker &&
    plan.direction === order.direction &&
    Math.abs(plan.entryPrice - order.limitPrice!) <= Math.max(1, order.limitPrice!) * 0.000001)
  return matches.length === 1 ? matches[0].id : null
}
