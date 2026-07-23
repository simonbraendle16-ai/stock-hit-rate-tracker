'use client'

import { useMemo } from 'react'

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
  // Direktes iframe-Embed (statt TV-Script): robust gegen React-Remounts.
  // Douglas-Filter: pures Advanced Chart — keine Hotlists, kein Ideen-Feed.
  const src = useMemo(() => {
    const params = new URLSearchParams({
      symbol: toTvSymbol(ticker, market, chartUrl),
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
  }, [ticker, market, chartUrl])

  return (
    <div className="glass-card overflow-hidden p-0">
      <iframe
        key={src}
        src={src}
        title="TradingView Advanced Chart"
        className="h-[520px] w-full border-0 sm:h-[600px]"
        allow="fullscreen"
        allowFullScreen
      />
      <p className="border-t border-border px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
        TradingView-Modus: alle TV-Tools &amp; Indikatoren — Zeichnungen werden hier
        nicht in der App gespeichert. Plan-Linien &amp; persistente Zeichnungen: Cockpit-Chart.
      </p>
    </div>
  )
}
