// Indikator-Berechnung für den Chart (AP 7 + AP 10/S5) — pur, ohne React/DOM,
// damit in Node testbar. Alles wird im Browser aus den bereits geladenen Kerzen
// berechnet: keine zusätzlichen Datenabrufe, keine Kosten.

import type { Candle } from '@/lib/market-data/types'

export interface LinePoint {
  time: number
  value: number
}

// ---- Basis-Mathematik --------------------------------------------------------

/** Einfacher gleitender Durchschnitt — erster Wert ab Index period−1. */
export function sma(candles: Candle[], period: number): LinePoint[] {
  return smaOverSeries(
    candles.map((c) => ({ time: c.time, value: c.close })),
    period,
  )
}

function smaOverSeries(series: LinePoint[], period: number): LinePoint[] {
  if (period < 1 || series.length < period) return []
  const out: LinePoint[] = []
  let sum = 0
  for (let i = 0; i < series.length; i++) {
    sum += series[i].value
    if (i >= period) sum -= series[i - period].value
    if (i >= period - 1) out.push({ time: series[i].time, value: sum / period })
  }
  return out
}

/** EMA über eine Werte-Reihe: Seed = SMA der ersten `period` Werte. */
function emaOver(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  if (period < 1 || values.length < period) return out
  let seed = 0
  for (let i = 0; i < period; i++) seed += values[i]
  let prev = seed / period
  out[period - 1] = prev
  const k = 2 / (period + 1)
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

/** Exponentieller gleitender Durchschnitt auf Schlusskursen. */
export function ema(candles: Candle[], period: number): LinePoint[] {
  const values = emaOver(
    candles.map((c) => c.close),
    period,
  )
  const out: LinePoint[] = []
  for (let i = 0; i < candles.length; i++) {
    const v = values[i]
    if (v != null) out.push({ time: candles[i].time, value: v })
  }
  return out
}

/** Gewichteter gleitender Durchschnitt (Gewichte 1..period). */
export function wma(candles: Candle[], period: number): LinePoint[] {
  if (period < 1 || candles.length < period) return []
  const out: LinePoint[] = []
  const denom = (period * (period + 1)) / 2
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0
    for (let j = 0; j < period; j++) sum += candles[i - j].close * (period - j)
    out.push({ time: candles[i].time, value: sum / denom })
  }
  return out
}

/** RSI nach Wilder (geglättete Durchschnitte) — erster Wert ab Index period. */
export function rsi(candles: Candle[], period: number): LinePoint[] {
  if (period < 1 || candles.length <= period) return []
  const out: LinePoint[] = []
  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close
    if (diff >= 0) avgGain += diff
    else avgLoss -= diff
  }
  avgGain /= period
  avgLoss /= period
  const toRsi = () =>
    avgLoss === 0 ? 100 : avgGain === 0 ? 0 : 100 - 100 / (1 + avgGain / avgLoss)
  out.push({ time: candles[period].time, value: toRsi() })
  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period
    out.push({ time: candles[i].time, value: toRsi() })
  }
  return out
}

export interface MacdResult {
  macd: LinePoint[]
  signal: LinePoint[]
  histogram: LinePoint[]
}

/** MACD (Standard 12/26/9): EMA(fast) − EMA(slow), Signal = EMA über MACD. */
export function macd(candles: Candle[], fast: number, slow: number, signalPeriod: number): MacdResult {
  const closes = candles.map((c) => c.close)
  const emaFast = emaOver(closes, fast)
  const emaSlow = emaOver(closes, slow)
  const macdLine: LinePoint[] = []
  const macdValues: number[] = []
  for (let i = 0; i < candles.length; i++) {
    const f = emaFast[i]
    const s = emaSlow[i]
    if (f != null && s != null) {
      macdLine.push({ time: candles[i].time, value: f - s })
      macdValues.push(f - s)
    }
  }
  const signalValues = emaOver(macdValues, signalPeriod)
  const signal: LinePoint[] = []
  const histogram: LinePoint[] = []
  for (let i = 0; i < macdLine.length; i++) {
    const s = signalValues[i]
    if (s != null) {
      signal.push({ time: macdLine[i].time, value: s })
      histogram.push({ time: macdLine[i].time, value: macdLine[i].value - s })
    }
  }
  return { macd: macdLine, signal, histogram }
}

/** True Range je Kerze. */
function trueRanges(candles: Candle[]): number[] {
  return candles.map((c, i) => {
    if (i === 0) return c.high - c.low
    const prevClose = candles[i - 1].close
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose))
  })
}

/** ATR nach Wilder. */
export function atr(candles: Candle[], period: number): LinePoint[] {
  if (period < 1 || candles.length <= period) return []
  const tr = trueRanges(candles)
  const out: LinePoint[] = []
  let prev = 0
  for (let i = 1; i <= period; i++) prev += tr[i]
  prev /= period
  out.push({ time: candles[period].time, value: prev })
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period
    out.push({ time: candles[i].time, value: prev })
  }
  return out
}

/** Bollinger-Bänder: Mitte = SMA, Bänder = ± mult·Standardabweichung. */
export function bollinger(
  candles: Candle[],
  period: number,
  mult: number,
): { upper: LinePoint[]; mid: LinePoint[]; lower: LinePoint[] } {
  const upper: LinePoint[] = []
  const mid: LinePoint[] = []
  const lower: LinePoint[] = []
  if (period < 2 || candles.length < period) return { upper, mid, lower }
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].close
    const mean = sum / period
    let variance = 0
    for (let j = i - period + 1; j <= i; j++) variance += (candles[j].close - mean) ** 2
    const sd = Math.sqrt(variance / period)
    const t = candles[i].time
    mid.push({ time: t, value: mean })
    upper.push({ time: t, value: mean + mult * sd })
    lower.push({ time: t, value: mean - mult * sd })
  }
  return { upper, mid, lower }
}

/** VWAP kumulativ über die geladenen Kerzen (typischer Preis × Volumen). */
export function vwap(candles: Candle[]): LinePoint[] {
  const out: LinePoint[] = []
  let cumPV = 0
  let cumV = 0
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3
    cumPV += tp * c.volume
    cumV += c.volume
    if (cumV > 0) out.push({ time: c.time, value: cumPV / cumV })
  }
  return out
}

/** Keltner-Kanal: Mitte = EMA(period), Bänder = ± mult·ATR(atrPeriod). */
export function keltner(
  candles: Candle[],
  period: number,
  mult: number,
  atrPeriod: number,
): { upper: LinePoint[]; mid: LinePoint[]; lower: LinePoint[] } {
  const midLine = ema(candles, period)
  const atrLine = atr(candles, atrPeriod)
  const atrByTime = new Map(atrLine.map((p) => [p.time, p.value]))
  const upper: LinePoint[] = []
  const mid: LinePoint[] = []
  const lower: LinePoint[] = []
  for (const m of midLine) {
    const a = atrByTime.get(m.time)
    if (a == null) continue
    mid.push(m)
    upper.push({ time: m.time, value: m.value + mult * a })
    lower.push({ time: m.time, value: m.value - mult * a })
  }
  return { upper, mid, lower }
}

/** Donchian-Kanal: höchstes Hoch / tiefstes Tief der letzten `period` Kerzen. */
export function donchian(
  candles: Candle[],
  period: number,
): { upper: LinePoint[]; mid: LinePoint[]; lower: LinePoint[] } {
  const upper: LinePoint[] = []
  const mid: LinePoint[] = []
  const lower: LinePoint[] = []
  if (period < 1 || candles.length < period) return { upper, mid, lower }
  for (let i = period - 1; i < candles.length; i++) {
    let hi = -Infinity
    let lo = Infinity
    for (let j = i - period + 1; j <= i; j++) {
      hi = Math.max(hi, candles[j].high)
      lo = Math.min(lo, candles[j].low)
    }
    const t = candles[i].time
    upper.push({ time: t, value: hi })
    lower.push({ time: t, value: lo })
    mid.push({ time: t, value: (hi + lo) / 2 })
  }
  return { upper, mid, lower }
}

/** Parabolic SAR (Standard 0.02 / 0.2) — Punkte über/unter dem Kurs. */
export function psar(candles: Candle[], step: number, maxStep: number): LinePoint[] {
  if (candles.length < 3) return []
  const out: LinePoint[] = []
  let up = candles[1].close >= candles[0].close
  let sar = up ? candles[0].low : candles[0].high
  let ep = up ? candles[0].high : candles[0].low
  let af = step
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]
    sar = sar + af * (ep - sar)
    if (up) {
      sar = Math.min(sar, candles[i - 1].low, i >= 2 ? candles[i - 2].low : candles[i - 1].low)
      if (c.low < sar) {
        up = false
        sar = ep
        ep = c.low
        af = step
      } else if (c.high > ep) {
        ep = c.high
        af = Math.min(af + step, maxStep)
      }
    } else {
      sar = Math.max(sar, candles[i - 1].high, i >= 2 ? candles[i - 2].high : candles[i - 1].high)
      if (c.high > sar) {
        up = true
        sar = ep
        ep = c.high
        af = step
      } else if (c.low < ep) {
        ep = c.low
        af = Math.min(af + step, maxStep)
      }
    }
    out.push({ time: c.time, value: sar })
  }
  return out
}

/** SuperTrend (period/mult): eine Linie je Trendrichtung (mit Lücken). */
export function supertrend(
  candles: Candle[],
  period: number,
  mult: number,
): { up: (LinePoint | { time: number })[]; down: (LinePoint | { time: number })[] } {
  const atrLine = atr(candles, period)
  const atrByTime = new Map(atrLine.map((p) => [p.time, p.value]))
  const up: (LinePoint | { time: number })[] = []
  const down: (LinePoint | { time: number })[] = []
  let prevFinalUpper = Infinity
  let prevFinalLower = -Infinity
  let prevClose: number | null = null
  let trendUp = true
  for (const c of candles) {
    const a = atrByTime.get(c.time)
    if (a == null) continue
    const mid = (c.high + c.low) / 2
    const upper = mid + mult * a
    const lower = mid - mult * a
    // Final Bands: dürfen sich nur in Trendrichtung bewegen (Standard-Algorithmus).
    const finalUpper =
      prevClose == null || upper < prevFinalUpper || prevClose > prevFinalUpper
        ? upper
        : prevFinalUpper
    const finalLower =
      prevClose == null || lower > prevFinalLower || prevClose < prevFinalLower
        ? lower
        : prevFinalLower
    if (trendUp && c.close < finalLower) trendUp = false
    else if (!trendUp && c.close > finalUpper) trendUp = true
    if (trendUp) {
      up.push({ time: c.time, value: finalLower })
      down.push({ time: c.time })
    } else {
      down.push({ time: c.time, value: finalUpper })
      up.push({ time: c.time })
    }
    prevFinalUpper = finalUpper
    prevFinalLower = finalLower
    prevClose = c.close
  }
  return { up, down }
}

/** Stochastik: %K (geglättet) und %D. */
export function stochastic(
  candles: Candle[],
  kPeriod: number,
  dPeriod: number,
  smooth: number,
): { k: LinePoint[]; d: LinePoint[] } {
  if (candles.length < kPeriod) return { k: [], d: [] }
  const raw: LinePoint[] = []
  for (let i = kPeriod - 1; i < candles.length; i++) {
    let hi = -Infinity
    let lo = Infinity
    for (let j = i - kPeriod + 1; j <= i; j++) {
      hi = Math.max(hi, candles[j].high)
      lo = Math.min(lo, candles[j].low)
    }
    const span = hi - lo || 1
    raw.push({ time: candles[i].time, value: ((candles[i].close - lo) / span) * 100 })
  }
  const k = smaOverSeries(raw, Math.max(1, smooth))
  const d = smaOverSeries(k, Math.max(1, dPeriod))
  return { k, d }
}

/** ADX/DMI nach Wilder: +DI, −DI und ADX. */
export function adx(
  candles: Candle[],
  period: number,
): { plusDi: LinePoint[]; minusDi: LinePoint[]; adxLine: LinePoint[] } {
  const plusDi: LinePoint[] = []
  const minusDi: LinePoint[] = []
  const adxLine: LinePoint[] = []
  if (candles.length <= period + 1) return { plusDi, minusDi, adxLine }
  const tr = trueRanges(candles)
  let smTr = 0
  let smPlus = 0
  let smMinus = 0
  for (let i = 1; i <= period; i++) {
    const upMove = candles[i].high - candles[i - 1].high
    const downMove = candles[i - 1].low - candles[i].low
    smTr += tr[i]
    smPlus += upMove > downMove && upMove > 0 ? upMove : 0
    smMinus += downMove > upMove && downMove > 0 ? downMove : 0
  }
  const dxs: number[] = []
  for (let i = period; i < candles.length; i++) {
    if (i > period) {
      const upMove = candles[i].high - candles[i - 1].high
      const downMove = candles[i - 1].low - candles[i].low
      smTr = smTr - smTr / period + tr[i]
      smPlus = smPlus - smPlus / period + (upMove > downMove && upMove > 0 ? upMove : 0)
      smMinus = smMinus - smMinus / period + (downMove > upMove && downMove > 0 ? downMove : 0)
    }
    const pdi = smTr > 0 ? (smPlus / smTr) * 100 : 0
    const mdi = smTr > 0 ? (smMinus / smTr) * 100 : 0
    plusDi.push({ time: candles[i].time, value: pdi })
    minusDi.push({ time: candles[i].time, value: mdi })
    const dx = pdi + mdi > 0 ? (Math.abs(pdi - mdi) / (pdi + mdi)) * 100 : 0
    dxs.push(dx)
    if (dxs.length === period) {
      adxLine.push({
        time: candles[i].time,
        value: dxs.reduce((a, b) => a + b, 0) / period,
      })
    } else if (dxs.length > period) {
      const prev = adxLine[adxLine.length - 1].value
      adxLine.push({ time: candles[i].time, value: (prev * (period - 1) + dx) / period })
    }
  }
  return { plusDi, minusDi, adxLine }
}

/** On-Balance-Volume. */
export function obv(candles: Candle[]): LinePoint[] {
  const out: LinePoint[] = []
  let acc = 0
  for (let i = 0; i < candles.length; i++) {
    if (i > 0) {
      if (candles[i].close > candles[i - 1].close) acc += candles[i].volume
      else if (candles[i].close < candles[i - 1].close) acc -= candles[i].volume
    }
    out.push({ time: candles[i].time, value: acc })
  }
  return out
}

/** Commodity Channel Index. */
export function cci(candles: Candle[], period: number): LinePoint[] {
  if (candles.length < period) return []
  const tps = candles.map((c) => (c.high + c.low + c.close) / 3)
  const out: LinePoint[] = []
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += tps[j]
    const mean = sum / period
    let dev = 0
    for (let j = i - period + 1; j <= i; j++) dev += Math.abs(tps[j] - mean)
    const meanDev = dev / period || 1
    out.push({ time: candles[i].time, value: (tps[i] - mean) / (0.015 * meanDev) })
  }
  return out
}

/** Williams %R. */
export function williamsR(candles: Candle[], period: number): LinePoint[] {
  if (candles.length < period) return []
  const out: LinePoint[] = []
  for (let i = period - 1; i < candles.length; i++) {
    let hi = -Infinity
    let lo = Infinity
    for (let j = i - period + 1; j <= i; j++) {
      hi = Math.max(hi, candles[j].high)
      lo = Math.min(lo, candles[j].low)
    }
    const span = hi - lo || 1
    out.push({ time: candles[i].time, value: ((hi - candles[i].close) / span) * -100 })
  }
  return out
}

/** Money Flow Index. */
export function mfi(candles: Candle[], period: number): LinePoint[] {
  if (candles.length <= period) return []
  const out: LinePoint[] = []
  const tps = candles.map((c) => (c.high + c.low + c.close) / 3)
  for (let i = period; i < candles.length; i++) {
    let pos = 0
    let neg = 0
    for (let j = i - period + 1; j <= i; j++) {
      const flow = tps[j] * candles[j].volume
      if (tps[j] > tps[j - 1]) pos += flow
      else if (tps[j] < tps[j - 1]) neg += flow
    }
    const ratio = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg)
    out.push({ time: candles[i].time, value: ratio })
  }
  return out
}

/** Rate of Change in Prozent. */
export function roc(candles: Candle[], period: number): LinePoint[] {
  if (candles.length <= period) return []
  const out: LinePoint[] = []
  for (let i = period; i < candles.length; i++) {
    const base = candles[i - period].close || 1
    out.push({ time: candles[i].time, value: ((candles[i].close - base) / base) * 100 })
  }
  return out
}

/** Ichimoku (9/26/52). Senkou-Spans werden innerhalb der Daten verschoben. */
export function ichimoku(
  candles: Candle[],
  tenkanP: number,
  kijunP: number,
  senkouP: number,
): { tenkan: LinePoint[]; kijun: LinePoint[]; senkouA: LinePoint[]; senkouB: LinePoint[]; chikou: LinePoint[] } {
  const midOf = (i: number, period: number): number | null => {
    if (i < period - 1) return null
    let hi = -Infinity
    let lo = Infinity
    for (let j = i - period + 1; j <= i; j++) {
      hi = Math.max(hi, candles[j].high)
      lo = Math.min(lo, candles[j].low)
    }
    return (hi + lo) / 2
  }
  const tenkan: LinePoint[] = []
  const kijun: LinePoint[] = []
  const senkouA: LinePoint[] = []
  const senkouB: LinePoint[] = []
  const chikou: LinePoint[] = []
  for (let i = 0; i < candles.length; i++) {
    const t = midOf(i, tenkanP)
    const k = midOf(i, kijunP)
    if (t != null) tenkan.push({ time: candles[i].time, value: t })
    if (k != null) kijun.push({ time: candles[i].time, value: k })
    // Senkou um kijunP nach vorn verschoben (nur innerhalb der geladenen Daten).
    if (t != null && k != null && i + kijunP < candles.length) {
      senkouA.push({ time: candles[i + kijunP].time, value: (t + k) / 2 })
    }
    const sb = midOf(i, senkouP)
    if (sb != null && i + kijunP < candles.length) {
      senkouB.push({ time: candles[i + kijunP].time, value: sb })
    }
    // Chikou = Schlusskurs um kijunP zurückversetzt.
    if (i - kijunP >= 0) {
      chikou.push({ time: candles[i - kijunP].time, value: candles[i].close })
    }
  }
  return { tenkan, kijun, senkouA, senkouB, chikou }
}

// ---- Deklaratives Indikator-System (AP 10/S5) ---------------------------------

export type IndicatorType =
  | 'ema'
  | 'sma'
  | 'wma'
  | 'vwap'
  | 'bollinger'
  | 'keltner'
  | 'donchian'
  | 'psar'
  | 'supertrend'
  | 'ichimoku'
  | 'volume'
  | 'rsi'
  | 'macd'
  | 'stochastic'
  | 'atr'
  | 'adx'
  | 'obv'
  | 'cci'
  | 'williams'
  | 'mfi'
  | 'roc'

export interface IndicatorParamDef {
  key: string
  label: string
  def: number
  min?: number
  max?: number
  step?: number
}

export interface IndicatorDef {
  label: string
  category: 'Trend (Overlay)' | 'Bänder (Overlay)' | 'Oszillatoren' | 'Volumen'
  params: IndicatorParamDef[]
}

export const INDICATOR_DEFS: Record<IndicatorType, IndicatorDef> = {
  ema: { label: 'EMA', category: 'Trend (Overlay)', params: [{ key: 'period', label: 'Periode', def: 20 }] },
  sma: { label: 'SMA', category: 'Trend (Overlay)', params: [{ key: 'period', label: 'Periode', def: 50 }] },
  wma: { label: 'WMA', category: 'Trend (Overlay)', params: [{ key: 'period', label: 'Periode', def: 20 }] },
  vwap: { label: 'VWAP', category: 'Trend (Overlay)', params: [] },
  psar: {
    label: 'Parabolic SAR',
    category: 'Trend (Overlay)',
    params: [
      { key: 'step', label: 'Schritt', def: 0.02, min: 0.001, max: 0.2, step: 0.01 },
      { key: 'max', label: 'Maximum', def: 0.2, min: 0.05, max: 0.8, step: 0.05 },
    ],
  },
  supertrend: {
    label: 'SuperTrend',
    category: 'Trend (Overlay)',
    params: [
      { key: 'period', label: 'ATR-Periode', def: 10 },
      { key: 'mult', label: 'Faktor', def: 3, min: 1, max: 10, step: 0.5 },
    ],
  },
  ichimoku: {
    label: 'Ichimoku',
    category: 'Trend (Overlay)',
    params: [
      { key: 'tenkan', label: 'Tenkan', def: 9 },
      { key: 'kijun', label: 'Kijun', def: 26 },
      { key: 'senkou', label: 'Senkou B', def: 52 },
    ],
  },
  bollinger: {
    label: 'Bollinger-Bänder',
    category: 'Bänder (Overlay)',
    params: [
      { key: 'period', label: 'Periode', def: 20 },
      { key: 'mult', label: 'Faktor', def: 2, min: 0.5, max: 5, step: 0.5 },
    ],
  },
  keltner: {
    label: 'Keltner-Kanal',
    category: 'Bänder (Overlay)',
    params: [
      { key: 'period', label: 'EMA-Periode', def: 20 },
      { key: 'mult', label: 'Faktor', def: 2, min: 0.5, max: 5, step: 0.5 },
      { key: 'atr', label: 'ATR-Periode', def: 10 },
    ],
  },
  donchian: {
    label: 'Donchian-Kanal',
    category: 'Bänder (Overlay)',
    params: [{ key: 'period', label: 'Periode', def: 20 }],
  },
  volume: { label: 'Volumen', category: 'Volumen', params: [] },
  obv: { label: 'OBV', category: 'Volumen', params: [] },
  mfi: { label: 'MFI', category: 'Volumen', params: [{ key: 'period', label: 'Periode', def: 14 }] },
  rsi: { label: 'RSI', category: 'Oszillatoren', params: [{ key: 'period', label: 'Periode', def: 14 }] },
  macd: {
    label: 'MACD',
    category: 'Oszillatoren',
    params: [
      { key: 'fast', label: 'Schnell', def: 12 },
      { key: 'slow', label: 'Langsam', def: 26 },
      { key: 'signal', label: 'Signal', def: 9 },
    ],
  },
  stochastic: {
    label: 'Stochastik',
    category: 'Oszillatoren',
    params: [
      { key: 'k', label: '%K', def: 14 },
      { key: 'd', label: '%D', def: 3 },
      { key: 'smooth', label: 'Glättung', def: 3 },
    ],
  },
  atr: { label: 'ATR', category: 'Oszillatoren', params: [{ key: 'period', label: 'Periode', def: 14 }] },
  adx: { label: 'ADX / DMI', category: 'Oszillatoren', params: [{ key: 'period', label: 'Periode', def: 14 }] },
  cci: { label: 'CCI', category: 'Oszillatoren', params: [{ key: 'period', label: 'Periode', def: 20 }] },
  williams: { label: 'Williams %R', category: 'Oszillatoren', params: [{ key: 'period', label: 'Periode', def: 14 }] },
  roc: { label: 'ROC', category: 'Oszillatoren', params: [{ key: 'period', label: 'Periode', def: 12 }] },
}

export interface IndicatorInstance {
  id: string
  type: IndicatorType
  params: Record<string, number>
  color: string
}

export interface IndicatorConfig {
  instances: IndicatorInstance[]
}

/** Punkt einer Render-Serie; value == null → Lücke (Whitespace). */
export interface SpecPoint {
  time: number
  value?: number
  color?: string
}

/** Eine zu zeichnende Serie: Overlay im Hauptchart oder eigenes Sub-Pane. */
export interface SeriesSpec {
  kind: 'line' | 'histogram' | 'points'
  overlay: boolean
  color: string
  title?: string
  data: SpecPoint[]
  lineWidth?: number
  /** Gestrichelte Referenzlinien im Sub-Pane (z. B. RSI 30/70). */
  levels?: number[]
}

const p = (inst: IndicatorInstance, key: string): number => {
  const def = INDICATOR_DEFS[inst.type].params.find((d) => d.key === key)?.def ?? 14
  const v = inst.params[key]
  return Number.isFinite(v) ? v : def
}

/**
 * Berechnet die Render-Serien eines Indikator-Exemplars aus den Kerzen.
 * `palette` liefert die Kerzenfarben (für Volumen/MACD-Histogramm).
 */
export function computeIndicator(
  candles: Candle[],
  inst: IndicatorInstance,
  palette: { up: string; down: string },
): SeriesSpec[] {
  const col = inst.color
  const line = (
    data: LinePoint[] | SpecPoint[],
    opts?: Partial<SeriesSpec>,
  ): SeriesSpec => ({
    kind: 'line',
    overlay: true,
    color: col,
    data,
    ...opts,
  })

  switch (inst.type) {
    case 'ema':
      return [line(ema(candles, p(inst, 'period')), { title: `EMA ${p(inst, 'period')}` })]
    case 'sma':
      return [line(sma(candles, p(inst, 'period')), { title: `SMA ${p(inst, 'period')}` })]
    case 'wma':
      return [line(wma(candles, p(inst, 'period')), { title: `WMA ${p(inst, 'period')}` })]
    case 'vwap':
      return [line(vwap(candles), { title: 'VWAP', lineWidth: 2 })]
    case 'psar':
      return [
        {
          kind: 'points',
          overlay: true,
          color: col,
          title: 'PSAR',
          data: psar(candles, p(inst, 'step'), p(inst, 'max')),
        },
      ]
    case 'supertrend': {
      const st = supertrend(candles, p(inst, 'period'), p(inst, 'mult'))
      return [
        line(st.up as SpecPoint[], { title: 'SuperTrend', color: '#4FBE8C', lineWidth: 2 }),
        line(st.down as SpecPoint[], { color: '#D8505F', lineWidth: 2 }),
      ]
    }
    case 'ichimoku': {
      const ich = ichimoku(candles, p(inst, 'tenkan'), p(inst, 'kijun'), p(inst, 'senkou'))
      return [
        line(ich.tenkan, { title: 'Tenkan', color: '#45a8ec' }),
        line(ich.kijun, { color: '#D8505F' }),
        line(ich.senkouA, { color: '#4FBE8C' }),
        line(ich.senkouB, { color: '#D4AC4E' }),
        line(ich.chikou, { color: '#9b8ec4' }),
      ]
    }
    case 'bollinger': {
      const bb = bollinger(candles, p(inst, 'period'), p(inst, 'mult'))
      return [
        line(bb.upper, { title: `BB ${p(inst, 'period')}` }),
        line(bb.mid, { color: '#D4AC4E' }),
        line(bb.lower),
      ]
    }
    case 'keltner': {
      const kc = keltner(candles, p(inst, 'period'), p(inst, 'mult'), p(inst, 'atr'))
      return [line(kc.upper, { title: 'Keltner' }), line(kc.mid, { color: '#D4AC4E' }), line(kc.lower)]
    }
    case 'donchian': {
      const dc = donchian(candles, p(inst, 'period'))
      return [line(dc.upper, { title: 'Donchian' }), line(dc.mid, { color: '#D4AC4E' }), line(dc.lower)]
    }
    case 'volume':
      return [
        {
          kind: 'histogram',
          overlay: true,
          color: col,
          title: 'Volumen',
          data: candles.map((c, i) => ({
            time: c.time,
            value: c.volume,
            color: (i > 0 ? c.close >= candles[i - 1].close : true)
              ? `${palette.up}59`
              : `${palette.down}59`,
          })),
        },
      ]
    case 'obv':
      return [line(obv(candles), { overlay: false, title: 'OBV' })]
    case 'mfi':
      return [
        line(mfi(candles, p(inst, 'period')), {
          overlay: false,
          title: `MFI ${p(inst, 'period')}`,
          levels: [20, 80],
        }),
      ]
    case 'rsi':
      return [
        line(rsi(candles, p(inst, 'period')), {
          overlay: false,
          title: `RSI ${p(inst, 'period')}`,
          levels: [30, 70],
        }),
      ]
    case 'macd': {
      const m = macd(candles, p(inst, 'fast'), p(inst, 'slow'), p(inst, 'signal'))
      return [
        {
          kind: 'histogram',
          overlay: false,
          color: col,
          data: m.histogram.map((pt) => ({
            ...pt,
            color: pt.value >= 0 ? `${palette.up}73` : `${palette.down}73`,
          })),
        },
        line(m.macd, { overlay: false, title: 'MACD', color: '#45a8ec' }),
        line(m.signal, { overlay: false, color: '#D8505F' }),
      ]
    }
    case 'stochastic': {
      const st = stochastic(candles, p(inst, 'k'), p(inst, 'd'), p(inst, 'smooth'))
      return [
        line(st.k, { overlay: false, title: 'Stoch %K', color: '#45a8ec', levels: [20, 80] }),
        line(st.d, { overlay: false, color: '#D8505F' }),
      ]
    }
    case 'atr':
      return [line(atr(candles, p(inst, 'period')), { overlay: false, title: `ATR ${p(inst, 'period')}` })]
    case 'adx': {
      const a = adx(candles, p(inst, 'period'))
      return [
        line(a.adxLine, { overlay: false, title: 'ADX', color: '#D4AC4E', levels: [25], lineWidth: 2 }),
        line(a.plusDi, { overlay: false, color: '#4FBE8C' }),
        line(a.minusDi, { overlay: false, color: '#D8505F' }),
      ]
    }
    case 'cci':
      return [
        line(cci(candles, p(inst, 'period')), {
          overlay: false,
          title: `CCI ${p(inst, 'period')}`,
          levels: [-100, 100],
        }),
      ]
    case 'williams':
      return [
        line(williamsR(candles, p(inst, 'period')), {
          overlay: false,
          title: `W%R ${p(inst, 'period')}`,
          levels: [-80, -20],
        }),
      ]
    case 'roc':
      return [
        line(roc(candles, p(inst, 'period')), {
          overlay: false,
          title: `ROC ${p(inst, 'period')}`,
          levels: [0],
        }),
      ]
    default:
      return []
  }
}

// ---- Konfiguration ----------------------------------------------------------

/** Rotierende Linienfarben für neue Indikator-Instanzen. */
export const INDICATOR_COLORS = [
  '#45a8ec',
  '#D4AC4E',
  '#4FBE8C',
  '#D8505F',
  '#9b8ec4',
  '#5fb8b0',
  '#d88f50',
  '#f1ece0',
]

export const DEFAULT_INDICATORS: IndicatorConfig = { instances: [] }

let idCounter = 0

/** Neues Indikator-Exemplar mit Default-Parametern und rotierender Farbe. */
export function createInstance(type: IndicatorType, existing: IndicatorInstance[]): IndicatorInstance {
  const params: Record<string, number> = {}
  for (const d of INDICATOR_DEFS[type].params) params[d.key] = d.def
  return {
    id: `${type}-${Date.now()}-${idCounter++}`,
    type,
    params,
    color: INDICATOR_COLORS[existing.length % INDICATOR_COLORS.length],
  }
}

const STORAGE_KEY = 'chart-indicators-v2'
const LEGACY_KEY = 'chart-indicators'

interface LegacyConfig {
  ema?: { on: boolean; period: number }
  sma?: { on: boolean; period: number }
  volume?: { on: boolean }
  rsi?: { on: boolean; period: number }
  macd?: { on: boolean; fast: number; slow: number; signal: number }
}

/** Alte AP-7-Konfiguration (feste 5 Indikatoren) in Instanzen überführen. */
function migrateLegacy(raw: string): IndicatorConfig {
  try {
    const old = JSON.parse(raw) as LegacyConfig
    const instances: IndicatorInstance[] = []
    if (old.ema?.on) {
      const i = createInstance('ema', instances)
      i.params.period = old.ema.period
      instances.push(i)
    }
    if (old.sma?.on) {
      const i = createInstance('sma', instances)
      i.params.period = old.sma.period
      instances.push(i)
    }
    if (old.volume?.on) instances.push(createInstance('volume', instances))
    if (old.rsi?.on) {
      const i = createInstance('rsi', instances)
      i.params.period = old.rsi.period
      instances.push(i)
    }
    if (old.macd?.on) {
      const i = createInstance('macd', instances)
      i.params = { fast: old.macd.fast, slow: old.macd.slow, signal: old.macd.signal }
      instances.push(i)
    }
    return { instances }
  } catch {
    return DEFAULT_INDICATORS
  }
}

/** Konfiguration aus localStorage laden (fehlertolerant, migriert AP-7-Format). */
export function loadIndicatorConfig(): IndicatorConfig {
  if (typeof window === 'undefined') return DEFAULT_INDICATORS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<IndicatorConfig>
      if (Array.isArray(parsed.instances)) {
        return {
          instances: parsed.instances.filter(
            (i): i is IndicatorInstance =>
              !!i && typeof i.id === 'string' && i.type in INDICATOR_DEFS,
          ),
        }
      }
    }
    const legacy = window.localStorage.getItem(LEGACY_KEY)
    if (legacy) return migrateLegacy(legacy)
    return DEFAULT_INDICATORS
  } catch {
    return DEFAULT_INDICATORS
  }
}

export function saveIndicatorConfig(cfg: IndicatorConfig): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
  } catch {
    // localStorage voll/gesperrt — Konfiguration gilt dann nur für die Sitzung.
  }
}
