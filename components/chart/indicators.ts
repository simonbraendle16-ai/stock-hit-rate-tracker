// Indikator-Berechnung für den Chart (AP 7) — pur, ohne React/DOM, damit in
// Node testbar. Alles wird im Browser aus den bereits geladenen Kerzen
// berechnet: keine zusätzlichen Datenabrufe, keine Kosten.

import type { Candle } from '@/lib/market-data/types'

export interface LinePoint {
  time: number
  value: number
}

/** Einfacher gleitender Durchschnitt — erster Wert ab Index period−1. */
export function sma(candles: Candle[], period: number): LinePoint[] {
  if (period < 1 || candles.length < period) return []
  const out: LinePoint[] = []
  let sum = 0
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close
    if (i >= period) sum -= candles[i - period].close
    if (i >= period - 1) out.push({ time: candles[i].time, value: sum / period })
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

// ---- Konfiguration ----------------------------------------------------------

export interface IndicatorConfig {
  ema: { on: boolean; period: number }
  sma: { on: boolean; period: number }
  volume: { on: boolean }
  rsi: { on: boolean; period: number }
  macd: { on: boolean; fast: number; slow: number; signal: number }
}

export const DEFAULT_INDICATORS: IndicatorConfig = {
  ema: { on: false, period: 20 },
  sma: { on: false, period: 50 },
  volume: { on: false },
  rsi: { on: false, period: 14 },
  macd: { on: false, fast: 12, slow: 26, signal: 9 },
}

const STORAGE_KEY = 'chart-indicators'

/** Konfiguration aus localStorage laden (fehlertolerant, mit Defaults gemergt). */
export function loadIndicatorConfig(): IndicatorConfig {
  if (typeof window === 'undefined') return DEFAULT_INDICATORS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_INDICATORS
    const parsed = JSON.parse(raw) as Partial<IndicatorConfig>
    return {
      ema: { ...DEFAULT_INDICATORS.ema, ...parsed.ema },
      sma: { ...DEFAULT_INDICATORS.sma, ...parsed.sma },
      volume: { ...DEFAULT_INDICATORS.volume, ...parsed.volume },
      rsi: { ...DEFAULT_INDICATORS.rsi, ...parsed.rsi },
      macd: { ...DEFAULT_INDICATORS.macd, ...parsed.macd },
    }
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
