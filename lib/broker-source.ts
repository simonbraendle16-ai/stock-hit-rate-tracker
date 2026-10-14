import { ApiError } from '@/lib/assistant-api'

export type BrokerSource = 'avatrade' | 'ctrader'

// Old collectors omit broker. Keep that contract without attributing cTrader to AvaTrade.
export function normalizeBrokerSource(value: unknown): BrokerSource {
  if (value === undefined) return 'avatrade'
  if (value === 'avatrade' || value === 'ctrader') return value
  throw new ApiError(422, 'Broker ist ungültig.')
}

export function assertBrokerBinding(broker: BrokerSource, account: string, portfolioId: number,
  env: Record<string, string | undefined> = process.env) {
  const expected = broker === 'ctrader' ? env.CTRADER_DEMO_ACCOUNT_ID : env.AVATRADE_DEMO_ACCOUNT_ID
  if (!expected) throw new ApiError(503, 'Demo-Brokerkonto ist noch nicht konfiguriert.')
  if (account !== expected) throw new ApiError(403, 'Brokerkonto nicht freigegeben.')
  // cTrader has a separate, explicit portfolio binding. Never select the first demo portfolio.
  if (broker === 'ctrader' && (!/^[1-9]\d*$/.test(env.CTRADER_DEMO_PORTFOLIO_ID ?? '') ||
      Number(env.CTRADER_DEMO_PORTFOLIO_ID) !== portfolioId)) {
    throw new ApiError(403, 'cTrader-Demo-Depot nicht freigegeben.')
  }
}

export function brokerLabel(broker: string) {
  return broker === 'ctrader' ? 'cTrader' : 'AvaTrade'
}

export type BrokerDetails = {
  symbolId: number
  sourceOrderType: string
  sourceStatus: string
  advancedTakeProfit: Array<{ takeProfit: number; volume: number }>
  trailingStopLoss: boolean
}

export function normalizeBrokerDetails(value: unknown, broker: BrokerSource): BrokerDetails | null {
  if (value == null) return null
  if (broker !== 'ctrader' || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(422, 'Brokerdetails sind ungültig.')
  }
  const r = value as Record<string, unknown>
  const keys = ['symbolId', 'sourceOrderType', 'sourceStatus', 'advancedTakeProfit', 'trailingStopLoss']
  if (Object.keys(r).some(k => !keys.includes(k)) || !Number.isSafeInteger(r.symbolId) || Number(r.symbolId) <= 0 ||
      typeof r.sourceOrderType !== 'string' || r.sourceOrderType.length > 40 ||
      typeof r.sourceStatus !== 'string' || r.sourceStatus.length > 40 ||
      typeof r.trailingStopLoss !== 'boolean' || !Array.isArray(r.advancedTakeProfit) || r.advancedTakeProfit.length > 20) {
    throw new ApiError(422, 'Brokerdetails sind ungültig.')
  }
  const levels = r.advancedTakeProfit.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ApiError(422, 'Teilziel ist ungültig.')
    const level = item as Record<string, unknown>
    if (Object.keys(level).some(k => !['takeProfit', 'volume'].includes(k)) ||
        typeof level.takeProfit !== 'number' || !Number.isFinite(level.takeProfit) || level.takeProfit <= 0 ||
        !Number.isSafeInteger(level.volume) || Number(level.volume) <= 0) throw new ApiError(422, 'Teilziel ist ungültig.')
    return { takeProfit: level.takeProfit, volume: Number(level.volume) }
  })
  return { symbolId: Number(r.symbolId), sourceOrderType: r.sourceOrderType,
    sourceStatus: r.sourceStatus, advancedTakeProfit: levels, trailingStopLoss: r.trailingStopLoss }
}
