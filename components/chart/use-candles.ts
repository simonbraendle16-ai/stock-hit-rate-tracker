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

export function useCandles(
  symbol: string,
  market: string,
  interval: Interval,
): CandlesState {
  const [state, setState] = useState<CandlesState>({
    candles: null,
    loading: true,
    error: null,
    errorCode: null,
  })

  useEffect(() => {
    const controller = new AbortController()
    setState((s) => ({ ...s, loading: true, error: null, errorCode: null }))

    const params = new URLSearchParams({ symbol, market, interval })
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
  }, [symbol, market, interval])

  return state
}
