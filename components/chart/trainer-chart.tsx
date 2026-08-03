'use client'

import { PriceChart, type ChartTimeframe } from '@/components/chart/price-chart'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'

const MARKETS = [
  { value: 'aktien', label: 'Aktien' },
  { value: 'krypto', label: 'Krypto' },
  { value: 'forex', label: 'Forex' },
  { value: 'rohstoffe', label: 'Rohstoffe' },
  { value: 'etf', label: 'ETF' },
  { value: 'optionen', label: 'Optionen' },
  { value: 'sonstiges', label: 'Sonstiges' },
]

const TIMEFRAMES: ChartTimeframe[] = ['15m', '30m', '1h', '4h', 'T', 'W', 'M']

function normalizeTimeframe(value: string): ChartTimeframe {
  return TIMEFRAMES.includes(value as ChartTimeframe) ? (value as ChartTimeframe) : '15m'
}

export function TrainerChart({
  initialSymbol,
  initialMarket,
  initialTimeframe,
}: {
  initialSymbol: string
  initialMarket: string
  initialTimeframe: string
}) {
  const timeframe = normalizeTimeframe(initialTimeframe)
  const market = MARKETS.some((m) => m.value === initialMarket) ? initialMarket : 'aktien'
  const symbol = initialSymbol || 'AAPL'

  return (
    <div className="space-y-4">
      <form className="panel flex flex-wrap items-end gap-3 p-4" action="/trainer">
        <label className="min-w-44 flex-1">
          <span className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Symbol
          </span>
          <Input
            name="symbol"
            defaultValue={symbol}
            placeholder="AAPL, BTC-USD, SAP.DE ..."
            className="h-9 font-mono text-xs uppercase"
          />
        </label>

        <label className="min-w-36">
          <span className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Markt
          </span>
          <select
            name="market"
            defaultValue={market}
            className="input-ocean h-9 w-full rounded-lg px-2.5 font-mono text-xs"
          >
            {MARKETS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label className="min-w-28">
          <span className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Start
          </span>
          <select
            name="timeframe"
            defaultValue={timeframe}
            className="input-ocean h-9 w-full rounded-lg px-2.5 font-mono text-xs"
          >
            {TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </select>
        </label>

        <Button type="submit" className="h-9 gap-1.5 px-3 font-mono text-xs">
          <Search className="size-3.5" />
          Laden
        </Button>
      </form>

      <PriceChart
        key={`${symbol}-${market}-${timeframe}`}
        symbol={symbol}
        market={market}
        defaultTimeframe={timeframe}
        replayMode
      />
    </div>
  )
}
