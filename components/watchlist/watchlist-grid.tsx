'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { StockWithStats } from '@/app/actions/stocks'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'

const MARKET_LABELS: Record<string, string> = {
  aktien: 'Aktien',
  krypto: 'Krypto',
  forex: 'Forex',
  rohstoffe: 'Rohstoffe',
  etf: 'ETF',
  optionen: 'Optionen',
  sonstiges: 'Sonstiges',
}

/** Märkte ohne Gratis-Kursdaten — keine Sparkline-Requests verschwenden. */
const NO_DATA_MARKETS = new Set(['forex', 'optionen', 'sonstiges'])

interface Spark {
  closes: number[]
  last: number
  changePct: number
}

/**
 * Lädt Sparkline-Daten gestaffelt (max. 2 parallel, kleine Pause), damit das
 * Twelve-Data-Gratis-Limit (~8 Req/min) auch bei ~20 Instrumenten hält —
 * der Server cached zusätzlich 12 h pro Symbol.
 */
function useSparklines(stocks: StockWithStats[]) {
  const [sparks, setSparks] = useState<Record<number, Spark | 'error'>>({})
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    let cancelled = false

    const queue = stocks.filter((s) => !NO_DATA_MARKETS.has(s.market))
    // Krypto zuerst (Binance ohne Limit), dann der Rest.
    queue.sort((a, b) => Number(b.market === 'krypto') - Number(a.market === 'krypto'))

    const fetchOne = async (s: StockWithStats, retried = false): Promise<void> => {
      try {
        const params = new URLSearchParams({
          symbol: s.ticker,
          market: s.market,
          interval: '1day',
        })
        const res = await fetch(`/api/candles?${params}`)
        if (res.status === 429 && !retried) {
          await new Promise((r) => setTimeout(r, 30_000))
          if (!cancelled) return fetchOne(s, true)
          return
        }
        if (!res.ok) throw new Error()
        const data = await res.json()
        const candles: { close: number }[] = data.candles.slice(-90)
        if (candles.length < 2) throw new Error()
        const closes = candles.map((c) => c.close)
        const last = closes[closes.length - 1]
        const prev = closes[closes.length - 2]
        if (!cancelled) {
          setSparks((p) => ({
            ...p,
            [s.id]: { closes, last, changePct: ((last - prev) / prev) * 100 },
          }))
        }
      } catch {
        if (!cancelled) setSparks((p) => ({ ...p, [s.id]: 'error' }))
      }
    }

    const run = async () => {
      const workers = 2
      let idx = 0
      await Promise.all(
        Array.from({ length: workers }, async () => {
          while (idx < queue.length && !cancelled) {
            const s = queue[idx++]
            await fetchOne(s)
            await new Promise((r) => setTimeout(r, 300))
          }
        }),
      )
    }
    void run()

    return () => {
      cancelled = true
    }
  }, [stocks])

  return sparks
}

function Sparkline({ closes, positive }: { closes: number[]; positive: boolean }) {
  const path = useMemo(() => {
    const w = 120
    const h = 36
    const min = Math.min(...closes)
    const max = Math.max(...closes)
    const span = max - min || 1
    return closes
      .map((c, i) => {
        const x = (i / (closes.length - 1)) * w
        const y = h - ((c - min) / span) * (h - 4) - 2
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }, [closes])

  return (
    <svg viewBox="0 0 120 36" className="h-9 w-[120px]" preserveAspectRatio="none">
      <path
        d={path}
        fill="none"
        stroke={positive ? '#4FBE8C' : '#D8505F'}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export function WatchlistGrid({ stocks }: { stocks: StockWithStats[] }) {
  const [query, setQuery] = useState('')
  const [marketFilter, setMarketFilter] = useState('alle')
  const sparks = useSparklines(stocks)

  const markets = useMemo(
    () => Array.from(new Set(stocks.map((s) => s.market))),
    [stocks],
  )

  const filtered = stocks.filter((s) => {
    if (marketFilter !== 'alle' && s.market !== marketFilter) return false
    const q = query.trim().toLowerCase()
    if (!q) return true
    return s.name.toLowerCase().includes(q) || s.ticker.toLowerCase().includes(q)
  })

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Suchen …"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 w-56 pl-8 font-mono text-xs"
          />
        </div>
        <select
          value={marketFilter}
          onChange={(e) => setMarketFilter(e.target.value)}
          className="input-ocean h-9 rounded-lg px-2.5 font-mono text-xs"
        >
          <option value="alle">Alle Märkte</option>
          {markets.map((m) => (
            <option key={m} value={m}>
              {MARKET_LABELS[m] ?? m}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="font-mono text-xs text-muted-foreground">
          Keine Instrumente gefunden.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => {
            const spark = sparks[s.id]
            const hasSpark = spark && spark !== 'error'
            const positive = hasSpark ? spark.changePct >= 0 : true
            return (
              <Link
                key={s.id}
                href={`/stock/${s.id}`}
                className="glass-card flex items-center justify-between gap-3 p-4 transition-colors hover:border-primary/40"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-heading text-sm font-semibold text-foreground">
                      {s.name}
                    </span>
                    <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
                      {s.ticker}
                    </Badge>
                  </div>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {MARKET_LABELS[s.market] ?? s.market}
                    {s.total > 0 && (
                      <span
                        className={
                          s.hitRate >= 50 ? 'ml-2 text-positive' : 'ml-2 text-destructive'
                        }
                      >
                        {s.hitRate.toFixed(0)}% · {s.total}
                      </span>
                    )}
                  </p>
                  {hasSpark && (
                    <p className="mt-1 font-mono text-xs text-foreground">
                      {spark.last.toLocaleString('de-DE', { maximumFractionDigits: 6 })}
                      <span className={positive ? 'ml-2 text-positive' : 'ml-2 text-destructive'}>
                        {positive ? '+' : ''}
                        {spark.changePct.toFixed(2)}%
                      </span>
                    </p>
                  )}
                </div>
                <div className="shrink-0">
                  {hasSpark ? (
                    <Sparkline closes={spark.closes} positive={positive} />
                  ) : spark === 'error' ? (
                    <span className="font-mono text-[10px] text-muted-foreground">–</span>
                  ) : NO_DATA_MARKETS.has(s.market) ? null : (
                    <span className="font-mono text-[10px] text-muted-foreground">…</span>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
