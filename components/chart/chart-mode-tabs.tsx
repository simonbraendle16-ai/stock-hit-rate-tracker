'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { TradingViewWidget } from './tradingview-widget'

const MODE_KEY = 'chart-mode'
type Mode = 'cockpit' | 'tv'

/**
 * Umschalter Cockpit-Chart ↔ TradingView-Embed (AP 10/S6). Cockpit bleibt
 * Default (nur er zeigt Plan-Linien + persistente Zeichnungen); der TV-Modus
 * liefert 100 % TradingView-Funktionsumfang. Wahl wird gemerkt.
 */
export function ChartModeTabs({
  ticker,
  market,
  chartUrl,
  children,
}: {
  ticker: string
  market: string
  chartUrl: string | null
  children: ReactNode
}) {
  const [mode, setMode] = useState<Mode>('cockpit')

  // Gemerkten Modus erst nach dem Mount laden (kein SSR-Mismatch).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(MODE_KEY)
      if (saved === 'tv' || saved === 'cockpit') setMode(saved)
    } catch {
      /* localStorage gesperrt — Default bleibt */
    }
  }, [])

  const switchMode = (m: Mode) => {
    setMode(m)
    try {
      window.localStorage.setItem(MODE_KEY, m)
    } catch {
      /* localStorage gesperrt — gilt nur für die Sitzung */
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        <Button
          size="sm"
          variant={mode === 'cockpit' ? 'secondary' : 'ghost'}
          className="h-7 px-2.5 font-mono text-[11px]"
          onClick={() => switchMode('cockpit')}
        >
          Cockpit-Chart
        </Button>
        <Button
          size="sm"
          variant={mode === 'tv' ? 'secondary' : 'ghost'}
          className="h-7 px-2.5 font-mono text-[11px]"
          onClick={() => switchMode('tv')}
        >
          TradingView
        </Button>
      </div>
      {/* Cockpit bleibt gemountet (Zeichnungen/State), TV lädt nur bei Bedarf. */}
      <div className={mode === 'cockpit' ? '' : 'hidden'}>{children}</div>
      {mode === 'tv' && (
        <TradingViewWidget ticker={ticker} market={market} chartUrl={chartUrl} />
      )}
    </div>
  )
}
