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

    const params = new URLSearchParams()
    if (trainingSessionId != null) {
      params.set('trainingSessionId', String(trainingSessionId))
      // Nur die Zeitebene darf von außen kommen — Symbol und Markt bleiben beim
      // Server, sonst wäre die Verdeckung über diesen Weg zu umgehen.
      if (timeframe) params.set('tf', timeframe)
    } else {
      params.set('symbol', symbol)
      params.set('market', market)
      params.set('interval', interval)
      if (stockId != null) params.set('stockId', String(stockId))
    }

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
