'use client'

import { useMemo } from 'react'
import { toTradingViewSymbol } from '@/lib/market-data/tradingview-symbol'

/**
 * Offizielles TradingView Advanced-Chart-Widget (gratis Embed) — AP 10/S6:
 * der „100 %-TradingView-Modus“ mit ALLEN TV-Indikatoren und -Zeichentools.
 * Hinweis: Zeichnungen hier werden nicht in der App gespeichert; der
 * Cockpit-Chart bleibt der Standard (Plan-Linien + Persistenz).
 */
export function TradingViewWidget({
  ticker,
  market,
  chartUrl,
  exchange,
}: {
  ticker: string
  market: string
  chartUrl: string | null
  /** Börse aus der bestätigten Symbolauflösung (`stock.resolvedExchange`). */
  exchange?: string | null
}) {
  // Direktes iframe-Embed (statt TV-Script): robust gegen React-Remounts.
  // Douglas-Filter: pures Advanced Chart — keine Hotlists, kein Ideen-Feed.
  const tvSymbol = useMemo(
    () => toTradingViewSymbol(ticker, market, chartUrl, exchange),
    [ticker, market, chartUrl, exchange],
  )

  const src = useMemo(() => {
    const params = new URLSearchParams({
      symbol: tvSymbol,
      interval: 'D',
      theme: 'dark',
      style: '1',
      locale: 'de',
      timezone: 'Europe/Berlin',
      toolbarbg: '131722',
      hidesidetoolbar: '0',
      hidetoptoolbar: '0',
      symboledit: '1',
      saveimage: '1',
      withdateranges: '1',
      studies: '[]',
      frameElementId: 'tv-advanced-chart',
    })
    return `https://s.tradingview.com/widgetembed/?${params.toString()}`
  }, [tvSymbol])

  return (
    <div className="panel rise-in overflow-hidden p-0">
      <iframe
        key={src}
        src={src}
        title="TradingView Advanced Chart"
        className="h-[520px] w-full border-0 sm:h-[600px]"
        allow="fullscreen"
        allowFullScreen
      />
      {/* Welches Symbol wirklich läuft, gehört sichtbar hin: Bei Terminkontrakten
          zeigt das Embed die frei abrufbare Notierung desselben Basiswerts
          (`CL1!` → `TVC:USOIL`), weil die Börsenreihe dort leer bleibt. Ohne
          diese Zeile wäre das ein stiller Tausch. */}
      <p className="note border-t border-border px-3 py-1.5">
        TradingView-Modus · Symbol <span className="font-mono">{tvSymbol}</span> — alle
        TV-Tools &amp; Indikatoren, Zeichnungen werden hier nicht in der App gespeichert.
        Plan-Linien &amp; persistente Zeichnungen: Cockpit-Chart.
      </p>
    </div>
  )
}
