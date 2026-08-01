'use client'

// Der Kurs eines Trades im Browser — ein Ladeweg für alle Ansichten.
//
// Bis Etappe 14 stand dieser Haken privat in `live-position.tsx`. Mit der
// Einstiegs-Ansicht kam eine zweite Stelle dazu, die denselben Kurs braucht, und
// eine Kopie wäre genau die Art von Duplikat, an der später eine Seite den
// `stockId`-Parameter verliert — und damit den falschen Kurs anzeigt, statt gar
// keinen (Etappe 11: 28,10 € für eine Bitcoin-Position).
//
// Deshalb: **Wer einen Trade-Kurs braucht, nimmt diesen Haken.**

import { useEffect, useState } from 'react'

export interface QuoteState {
  price: number | null
  /** Unix-Sekunden der Kerze — Grundlage für „Kurs von 14:32". */
  time: number | null
  loading: boolean
  error: string | null
  errorCode: string | null
}

/**
 * @param stockId Verknüpftes Instrument. Ohne ihn ist ein Trade-Ticker nicht
 *                verlässlich auflösbar — `SOL` ist beim Anbieter nicht `SOL-USD`.
 */
export function useTradeQuote(
  symbol: string,
  market: string,
  stockId: number | null,
  enabled = true,
): QuoteState {
  const [state, setState] = useState<QuoteState>({
    price: null,
    time: null,
    loading: enabled,
    error: null,
    errorCode: null,
  })

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    setState((s) => ({ ...s, loading: true, error: null, errorCode: null }))

    const params = new URLSearchParams({ symbol, market })
    if (stockId != null) params.set('stockId', String(stockId))
    fetch(`/api/quote?${params}`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) {
          setState({
            price: null,
            time: null,
            loading: false,
            error: data.error ?? 'Kurs konnte nicht geladen werden.',
            errorCode: data.code ?? null,
          })
          return
        }
        setState({
          price: data.price,
          time: data.time,
          loading: false,
          error: null,
          errorCode: null,
        })
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setState({
          price: null,
          time: null,
          loading: false,
          error: 'Netzwerkfehler beim Laden des Kurses.',
          errorCode: null,
        })
      })

    return () => controller.abort()
  }, [symbol, market, enabled, stockId])

  return state
}

/** Kerzen-Zeitstempel → „Kurs von 14:32" (bzw. mit Datum, wenn nicht heute). */
export function quoteTimeLabel(timeSec: number): string {
  const d = new Date(timeSec * 1000)
  const now = new Date()
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return `Kurs von ${time}`
  const date = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
  return `Kurs von ${date}, ${time}`
}
