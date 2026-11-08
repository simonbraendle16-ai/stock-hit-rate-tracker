/** A broker execution is evidence of an outcome, not evidence of an original plan. */
export type ExecutionImport = {
  broker: 'match_trader'
  accountFingerprint: string
  positionId: string
  closingUid: string | null
  volumeLots: number
  openTime: string
  closeTime: string | null
  openPrice: number
  closePrice: number | null
  currency: 'USD'
  gross: number | null
  net: number | null
  commission: number
  swap: number
  closeReason: string | null
  observedStop: number | null
  observedTarget: number | null
}

export function importedExecution(t: { externalSource?: { kind: string; execution?: ExecutionImport } | null }): ExecutionImport | null {
  return t.externalSource?.kind === 'broker_execution_import' ? t.externalSource.execution ?? null : null
}

export function hasTradePlan<T extends {stopLoss:number|null;takeProfit:number|null}>(t:T):t is T & {stopLoss:number;takeProfit:number} {
  return t.stopLoss !== null && t.takeProfit !== null
}

export function normalizeExecutionImport(raw: Record<string, unknown>) {
  const keys = ['portfolioId','ticker','market','direction','execution','capturedAt']
  if (Object.keys(raw).some(k => !keys.includes(k))) throw new Error('Unbekanntes Importfeld.')
  if (!Number.isSafeInteger(raw.portfolioId) || Number(raw.portfolioId) <= 0) throw new Error('Depot fehlt.')
  if (typeof raw.ticker !== 'string' || !/^[A-Z0-9][A-Z0-9._-]{0,39}$/i.test(raw.ticker)) throw new Error('Ticker fehlt.')
  if (!['rohstoffe','krypto','sonstiges','forex'].includes(String(raw.market))) throw new Error('Markt ungültig.')
  if (!['long','short'].includes(String(raw.direction))) throw new Error('Richtung fehlt.')
  const e = raw.execution as ExecutionImport
  const fields = ['broker','accountFingerprint','positionId','closingUid','volumeLots','openTime','closeTime','openPrice','closePrice','currency','gross','net','commission','swap','closeReason','observedStop','observedTarget']
  if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).some(k => !fields.includes(k))) throw new Error('Ausführungsbeleg fehlt.')
  if (e.broker !== 'match_trader' || e.currency !== 'USD' || !/^[a-f0-9]{64}$/.test(e.accountFingerprint)) throw new Error('Quellkonto oder Währung ungültig.')
  const text = (v: unknown, nullable = false) => nullable && v === null || typeof v === 'string' && v.length > 0 && v.length <= 200
  const number = (v: unknown, positive = false) => typeof v === 'number' && Number.isFinite(v) && (!positive || v > 0)
  const date = (v: unknown) => typeof v === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v))
  if (!text(e.positionId) || !text(e.closingUid,true) || !text(e.closeReason,true) || !number(e.volumeLots,true) || !number(e.openPrice,true) || !date(e.openTime) || !date(raw.capturedAt)) throw new Error('Ausführung unvollständig.')
  if (Date.parse(e.openTime) > Date.parse(String(raw.capturedAt))) throw new Error('Eröffnung nach Beobachtung.')
  if (![e.observedStop,e.observedTarget].every(v => v === null || number(v,true)) || !number(e.commission) || !number(e.swap) || e.commission > 0) throw new Error('Kosten oder beobachtete Levels ungültig.')
  if (e.closeTime === null) {
    if (e.closingUid !== null || e.closePrice !== null || e.gross !== null || e.net !== null || e.closeReason !== null) throw new Error('Offene Position hat kein realisiertes Ergebnis.')
  } else {
    if (!date(e.closeTime) || Date.parse(e.closeTime) < Date.parse(e.openTime) || Date.parse(e.closeTime) > Date.parse(String(raw.capturedAt)) || !text(e.closingUid) || !number(e.closePrice,true) || !number(e.gross) || !number(e.net)) throw new Error('Abschlussbeleg unvollständig.')
    if (Math.abs(e.gross! + e.commission + e.swap - e.net!) > 0.011) throw new Error('Nettoergebnis widerspricht Kostenbeleg.')
  }
  return { portfolioId: Number(raw.portfolioId), ticker: raw.ticker.toUpperCase(), market: String(raw.market), direction: String(raw.direction), execution: e, capturedAt: String(raw.capturedAt) }
}
