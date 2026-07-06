'use client'

import { useEffect, useRef } from 'react'

/**
 * TV-Symbol aus Ticker/Markt ableiten; ein `symbol=`-Parameter im gespeicherten
 * Chart-Link (z. B. tradingview.com/chart/?symbol=NASDAQ:AAPL) gewinnt immer.
 */
function toTvSymbol(ticker: string, market: string, chartUrl: string | null): string {
  if (chartUrl) {
    try {
      const fromUrl = new URL(chartUrl).searchParams.get('symbol')
      if (fromUrl) return fromUrl
    } catch {
      /* kein valider Link → normale Ableitung */
    }
  }
  const t = ticker.toUpperCase().replace('/', '')
  if (market === 'krypto') {
    return t.endsWith('USDT') || t.endsWith('USD') ? `BINANCE:${t}` : `BINANCE:${t}USDT`
  }
  if (market === 'forex') return `FX:${t}`
  if (market === 'rohstoffe' && /^[A-Z]{6}$/.test(t)) return `OANDA:${t}`
  return t
}

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
}: {
  ticker: string
  market: string
  chartUrl: string | null
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.innerHTML = ''
    const widgetDiv = document.createElement('div')
    widgetDiv.className = 'tradingview-widget-container__widget'
    widgetDiv.style.height = '100%'
    widgetDiv.style.width = '100%'
    container.appendChild(widgetDiv)

    const script = document.createElement('script')
    script.src =
      'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    script.type = 'text/javascript'
    script.async = true
    // Douglas-Filter: pures Advanced Chart — keine Hotlists, kein Ideen-Feed,
    // keine Details-/Kalender-Panels.
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: toTvSymbol(ticker, market, chartUrl),
      interval: 'D',
      timezone: 'Europe/Berlin',
      theme: 'dark',
      style: '1',
      locale: 'de_DE',
      backgroundColor: '#131722',
      allow_symbol_change: true,
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      details: false,
      hotlist: false,
      calendar: false,
      withdateranges: true,
      support_host: 'https://www.tradingview.com',
    })
    container.appendChild(script)

    return () => {
      container.innerHTML = ''
    }
  }, [ticker, market, chartUrl])

  return (
    <div className="glass-card overflow-hidden p-0">
      <div
        ref={containerRef}
        className="tradingview-widget-container h-[520px] w-full sm:h-[600px]"
      />
      <p className="border-t border-border px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
        TradingView-Modus: alle TV-Tools &amp; Indikatoren — Zeichnungen werden hier
        nicht in der App gespeichert. Plan-Linien &amp; persistente Zeichnungen: Cockpit-Chart.
      </p>
    </div>
  )
}
