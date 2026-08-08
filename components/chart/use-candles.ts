'use client'

import { useEffect, useState } from 'react'
import type { Candle, Interval } from '@/lib/market-data/types'

interface CandlesState {
  candles: Candle[] | null
  loading: boolean
  /** Fehlermeldung (deutsch, direkt anzeigbar) */
  error: string | null
  /** 'unsupported' → Markt hat keine Gratis-Daten (Forex/Optionen) */
  errorCode: string | null
}

export interface UseCandlesOptions {
  /** Instrument aus der Watchlist — nur damit stimmt die Symbolauflösung (Etappe 11). */
  stockId?: number
  /**
   * Trainingseinheit statt Symbol: Der Server nimmt Symbol, Markt und Intervall
   * aus der Übung. Bei einer verdeckten Übung erfährt der Browser das Symbol
   * dadurch gar nicht erst — „verdeckt" wäre sonst nur ein Anzeige-Trick.
   */
  trainingSessionId?: number
  /**
   * Zeitebene, die bei einer Übung ABWEICHEND von der eingestellten geladen
   * werden soll. Nötig für die Analyse von oben nach unten: Der Server nimmt
   * Symbol und Markt weiter aus der Übung (das Instrument bleibt verdeckt),
   * nur das Intervall kommt von hier.
   */
  timeframe?: string
  /**
   * Aus, solange die Reihe nicht gebraucht wird. Hooks lassen sich nicht
   * bedingt aufrufen — ein Schalter ist der ehrliche Weg, statt einen zweiten
   * Abruf mitlaufen zu lassen, den niemand ansieht.
   */
  enabled?: boolean
}

/**
 * Die Abfrage-Parameter — an EINER Stelle, weil sie zwei Aufrufer haben.
 *
 * Bei einer Übung darf ausschließlich die Zeitebene von außen kommen; Symbol
 * und Markt bleiben beim Server. Stünde das an zwei Stellen, verriete die eine
 * irgendwann das Instrument, das die andere verdeckt.
 */
function candleParams(
  symbol: string,
  market: string,
  interval: Interval,
  opts: UseCandlesOptions,
): URLSearchParams {
  const params = new URLSearchParams()
  if (opts.trainingSessionId != null) {
    params.set('trainingSessionId', String(opts.trainingSessionId))
    if (opts.timeframe) params.set('tf', opts.timeframe)
  } else {
    params.set('symbol', symbol)
    params.set('market', market)
    params.set('interval', interval)
    if (opts.stockId != null) params.set('stockId', String(opts.stockId))
  }
  return params
}

/**
 * Ältere Kerzen nachladen — ausschließlich nach links.
 *
 * Kein zweiter Ladeweg: Es ist dieselbe Route und damit derselbe
 * `getCachedCandles`, nur mit `before`. Ein eigener Weg an ihm vorbei wäre eine
 * zweite Wahrheit darüber, woher Kerzen kommen — und die Wache gegen
 * unaufgelöste Rohticker sitzt genau dort.
 *
 * Nach RECHTS gibt es das bewusst nicht: Der rechte Rand gehört im Trainer dem
 * Replay-Stand.
 */
export async function ladeAeltereKerzen(
  symbol: string,
  market: string,
  interval: Interval,
  before: number,
  opts: UseCandlesOptions = {},
  signal?: AbortSignal,
): Promise<Candle[]> {
  const params = candleParams(symbol, market, interval, opts)
  params.set('before', String(Math.floor(before)))
  const res = await fetch(`/api/candles?${params}`, { signal })
  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data.candles) ? (data.candles as Candle[]) : []
}

export function useCandles(
  symbol: string,
  market: string,
  interval: Interval,
  options: number | UseCandlesOptions = {},
): CandlesState {
  // Rückwärtsverträglich: früher war der vierte Parameter direkt die stockId.
  const opts: UseCandlesOptions = typeof options === 'number' ? { stockId: options } : options
  const { stockId, trainingSessionId, timeframe, enabled = true } = opts

  const [state, setState] = useState<CandlesState>({
    candles: null,
    loading: true,
    error: null,
    errorCode: null,
  })

  useEffect(() => {
    if (!enabled) {
      setState({ candles: null, loading: false, error: null, errorCode: null })
      return
    }
    const controller = new AbortController()
    setState((s) => ({ ...s, loading: true, error: null, errorCode: null }))

    const params = candleParams(symbol, market, interval, {
      stockId,
      trainingSessionId,
      timeframe,
    })

    fetch(`/api/candles?${params}`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) {
          setState({
            candles: null,
            loading: false,
            error: data.error ?? 'Kursdaten konnten nicht geladen werden.',
            errorCode: data.code ?? null,
          })
          return
        }
        setState({ candles: data.candles, loading: false, error: null, errorCode: null })
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setState({
          candles: null,
          loading: false,
          error: 'Netzwerkfehler beim Laden der Kursdaten.',
          errorCode: null,
        })
      })

    return () => controller.abort()
  }, [symbol, market, interval, stockId, trainingSessionId, timeframe, enabled])

  return state
}
