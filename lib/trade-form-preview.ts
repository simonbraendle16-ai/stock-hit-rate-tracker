import { formNumber } from './form-number'
import { contractTradeFelder } from './contract-trade'
import type { ContractSpec } from './contract-specs'
import type { MoneyCurrency } from './money-currency'
import { buildTargetPlan } from './trade-targets'
import { computeShares, projectStopLoss, projectTakeProfit, type Direction, type Fees } from './trade-math'

export type PreviewForm = {
  entryPrice: string; stopLoss: string; takeProfit: string; direction: Direction
  investedAmount: string; positionSize: string; contracts: string; leverage: string
}

/** Uses the same quantity, contract, target and currency functions as persisted trades. */
export function tradeFormPreview(args: {
  form: PreviewForm
  targets: { price: number; sharePct: number }[]
  conversion: MoneyCurrency | null
  conversionError: string | null
  instrumentStatus: 'idle' | 'loading' | 'ready' | 'error'
  spec: ContractSpec | null
  fees: Fees
}) {
  try {
    if (args.instrumentStatus !== 'ready') throw new Error('Instrumentprüfung abwarten bzw. Abruf wiederholen.')
    if (!args.conversion) throw new Error(args.conversionError ?? 'Depot- und Kurswährung sowie gültigen FX-Plankurs prüfen.')
    const { form, conversion, spec, fees } = args
    const entry = formNumber(form.entryPrice), sl = formNumber(form.stopLoss), tp = formNumber(form.takeProfit)
    const leverage = form.leverage.trim() ? formNumber(form.leverage) : 1
    if (!(entry > 0 && sl > 0 && tp > 0)) throw new Error('Einstieg, Stop und Kursziel als positive Dezimalzahlen eingeben (z. B. 45,28).')
    if (!(leverage >= 1)) throw new Error('Hebel als Zahl ab 1 eingeben.')
    if (form.direction === 'short' ? sl <= entry : sl >= entry) throw new Error('Stop muss auf der Verlustseite des Einstiegs liegen.')
    if (!(fees.entry >= 0 && fees.exit >= 0) || !Number.isFinite(fees.entry + fees.exit)) throw new Error('Gültige Gebühren ab 0 eingeben.')
    const targets = buildTargetPlan({ entry, stopLoss: sl, direction: form.direction, kursziel: tp, teilziele: args.targets })
    const rate = conversion.quoteToAccountRate
    const contract = spec ? contractTradeFelder({ spec, contracts: formNumber(form.contracts), entryPrice: entry, stopLoss: sl, leverage }) : null
    if (spec && !contract) throw new Error('Positive Kontraktzahl eingeben.')
    const invested = contract ? contract.contractInitialMargin * rate
      : form.investedAmount.trim() ? formNumber(form.investedAmount)
      : formNumber(form.positionSize) * entry * rate / leverage
    if (!(invested > 0) || !Number.isFinite(invested)) throw new Error('Positiven Kapitaleinsatz oder eine manuelle Menge eingeben.')
    const shares = contract?.positionSize ?? (form.investedAmount.trim()
      ? computeShares(invested, entry, leverage, rate) : formNumber(form.positionSize))
    const common = { invested, entry, direction: form.direction, leverage, quoteToAccountRate: rate, positionSize: shares, fees }
    const stop = projectStopLoss({ ...common, sl })
    if (!stop) throw new Error('Positionsgröße konnte nicht berechnet werden.')
    const stages = targets.map(target => ({ ...target, projection: projectTakeProfit({ ...common, tp: target.price, sellPct: target.sharePct })! }))
    // Entry is paid once; each target is a separate exit order.
    const grossProfit = stages.reduce((sum, stage) => sum + stage.projection.grossProfit, 0)
    const totalFees = fees.entry + fees.exit * stages.length
    return { error: null, value: { shares, invested, leverage, positionValue: shares * entry * rate, stop, stages, grossProfit, totalFees, netProfit: grossProfit - totalFees } }
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message : 'Vorschau nicht berechenbar.' }
  }
}
