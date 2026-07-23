'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { StockWithStats } from '@/app/actions/stocks'
import { setWatchlistSection } from '@/app/actions/stocks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ChevronDown, ChevronRight, FolderInput, Search } from 'lucide-react'
import { toast } from 'sonner'

const MARKET_LABELS: Record<string, string> = {
  aktien: 'Aktien',
  krypto: 'Krypto',
  forex: 'Forex',
  rohstoffe: 'Rohstoffe',
  etf: 'ETF',
  optionen: 'Optionen',
  sonstiges: 'Sonstiges',
}

const NO_SECTION = 'Ohne Sektion'
const COLLAPSE_KEY = 'watchlist-collapsed-sections'

type SparkEntry =
  | { status: 'ok'; closes: number[]; last: number; changePct: number }
  | { status: 'pending' | 'nodata' | 'error' }

/**
 * Watchlist V2 (S1): EIN Batch-Request auf `/api/sparklines` statt Einzel-Fetches
 * pro Symbol. Symbole am Twelve-Data-Limit kommen als `pending` zurück und werden
 * gezielt per Re-Poll nachgeladen (Server-Cache füllt sich pro Minute weiter).
 */
function useSparklines() {
  const [sparks, setSparks] = useState<Record<number, SparkEntry>>({})

  useEffect(() => {
    let cancelled = false
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | null = null

    const load = async () => {
      try {
        const res = await fetch('/api/sparklines')
        if (!res.ok) throw new Error()
        const data = (await res.json()) as { sparks: Record<number, SparkEntry> }
        if (cancelled) return
        setSparks(data.sparks)
        // Auch transiente Fehler (kalter Cache, Netz-Hickser) automatisch nachladen.
        const hasPending = Object.values(data.sparks).some(
          (e) => e.status === 'pending' || e.status === 'error',
        )
        if (hasPending && attempts < 8) {
          attempts++
          timer = setTimeout(load, 25_000)
        }
      } catch {
        if (!cancelled && attempts < 3) {
          attempts++
          timer = setTimeout(load, 10_000)
        }
      }
    }
    void load()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  return sparks
}

function Sparkline({ closes, positive }: { closes: number[]; positive: boolean }) {
  const path = useMemo(() => {
    const w = 96
    const h = 28
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
    <svg viewBox="0 0 96 28" className="h-7 w-24" preserveAspectRatio="none">
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

function formatPrice(v: number): string {
  return v.toLocaleString('de-DE', {
    maximumFractionDigits: v >= 100 ? 2 : 6,
    minimumFractionDigits: 2,
  })
}

/** Eine kompakte Instrument-Zeile im TradingView-Stil. */
function WatchlistRow({
  s,
  spark,
  onMove,
}: {
  s: StockWithStats
  spark: SparkEntry | undefined
  onMove: (s: StockWithStats) => void
}) {
  const ok = spark?.status === 'ok' ? spark : null
  const positive = ok ? ok.changePct >= 0 : true
  const prev = ok && ok.closes.length >= 2 ? ok.closes[ok.closes.length - 2] : null
  const changeAbs = ok && prev !== null ? ok.last - prev : null

  return (
    <div className="group relative flex items-center gap-3 border-b border-border/50 px-3 py-2 transition-colors hover:bg-primary/5">
      <Link
        href={`/stock/${s.id}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-foreground">{s.ticker}</span>
            {s.total > 0 && (
              <span
                className={`font-mono text-[10px] ${
                  s.hitRate >= 50 ? 'text-positive' : 'text-destructive'
                }`}
                title={`Trefferquote: ${s.hitRate.toFixed(0)} % aus ${s.total} Prognosen`}
              >
                {s.hitRate.toFixed(0)}%
              </span>
            )}
          </div>
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {s.name} · {MARKET_LABELS[s.market] ?? s.market}
          </p>
        </div>

        <div className="hidden shrink-0 sm:block">
          {ok ? (
            <Sparkline closes={ok.closes} positive={positive} />
          ) : spark?.status === 'pending' || !spark ? (
            <span className="font-mono text-[10px] text-muted-foreground">…</span>
          ) : null}
        </div>

        <div className="w-24 shrink-0 text-right font-mono text-sm text-foreground">
          {ok ? formatPrice(ok.last) : spark?.status === 'nodata' ? '—' : spark?.status === 'error' ? '–' : '…'}
        </div>

        <div
          className={`hidden w-20 shrink-0 text-right font-mono text-xs md:block ${
            ok ? (positive ? 'text-positive' : 'text-destructive') : 'text-muted-foreground'
          }`}
        >
          {ok && changeAbs !== null
            ? `${positive ? '+' : ''}${changeAbs.toLocaleString('de-DE', { maximumFractionDigits: 4 })}`
            : ''}
        </div>

        <div
          className={`w-16 shrink-0 text-right font-mono text-xs ${
            ok ? (positive ? 'text-positive' : 'text-destructive') : 'text-muted-foreground'
          }`}
        >
          {ok ? `${positive ? '+' : ''}${ok.changePct.toFixed(2)}%` : ''}
        </div>
      </Link>

      <Button
        size="sm"
        variant="ghost"
        className="h-7 w-7 shrink-0 p-0 opacity-0 transition-opacity group-hover:opacity-100"
        title="In Sektion verschieben"
        aria-label="In Sektion verschieben"
        onClick={() => onMove(s)}
      >
        <FolderInput className="size-3.5 text-muted-foreground" />
      </Button>
    </div>
  )
}

export function WatchlistGrid({ stocks }: { stocks: StockWithStats[] }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [marketFilter, setMarketFilter] = useState('alle')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [moveTarget, setMoveTarget] = useState<StockWithStats | null>(null)
  const [newSection, setNewSection] = useState('')
  const [isPending, startTransition] = useTransition()
  const sparks = useSparklines()

  // Collapse-Zustand aus localStorage (erst nach Mount — kein Hydration-Mismatch).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY)
      if (raw) setCollapsed(JSON.parse(raw))
    } catch {
      /* defekter Eintrag → Standard: alles offen */
    }
  }, [])

  const toggleSection = (name: string) => {
    setCollapsed((p) => {
      const next = { ...p, [name]: !p[name] }
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next))
      } catch {
        /* Speicher voll/blockiert → Collapse gilt nur für die Sitzung */
      }
      return next
    })
  }

  const markets = useMemo(
    () => Array.from(new Set(stocks.map((s) => s.market))),
    [stocks],
  )
  const sections = useMemo(
    () =>
      Array.from(
        new Set(stocks.map((s) => s.watchlistSection).filter((x): x is string => !!x)),
      ).sort((a, b) => a.localeCompare(b, 'de')),
    [stocks],
  )

  const filtered = stocks.filter((s) => {
    if (marketFilter !== 'alle' && s.market !== marketFilter) return false
    const q = query.trim().toLowerCase()
    if (!q) return true
    return s.name.toLowerCase().includes(q) || s.ticker.toLowerCase().includes(q)
  })

  // Gruppierung: benannte Sektionen alphabetisch, „Ohne Sektion“ zuletzt.
  const grouped = useMemo(() => {
    const map = new Map<string, StockWithStats[]>()
    for (const name of sections) map.set(name, [])
    map.set(NO_SECTION, [])
    for (const s of filtered) {
      map.get(s.watchlistSection ?? NO_SECTION)?.push(s)
    }
    return Array.from(map.entries()).filter(([, list]) => list.length > 0)
  }, [filtered, sections])

  const applySection = (section: string | null) => {
    if (!moveTarget) return
    const target = moveTarget
    startTransition(async () => {
      try {
        await setWatchlistSection(target.id, section)
        setMoveTarget(null)
        setNewSection('')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Sektion konnte nicht gesetzt werden.')
      }
    })
  }

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
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {filtered.length} / {stocks.length} Instrumente
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="font-mono text-xs text-muted-foreground">
          Keine Instrumente gefunden.
        </p>
      ) : (
        <div className="glass-card overflow-hidden">
          {grouped.map(([name, list]) => {
            const isCollapsed = !!collapsed[name]
            return (
              <div key={name}>
                <button
                  type="button"
                  onClick={() => toggleSection(name)}
                  className="flex w-full items-center gap-1.5 border-b border-border bg-card/60 px-3 py-1.5 text-left"
                >
                  {isCollapsed ? (
                    <ChevronRight className="size-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="size-3.5 text-muted-foreground" />
                  )}
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {name}
                  </span>
                  <Badge variant="secondary" className="ml-auto font-mono text-[9px]">
                    {list.length}
                  </Badge>
                </button>
                {!isCollapsed &&
                  list.map((s) => (
                    <WatchlistRow key={s.id} s={s} spark={sparks[s.id]} onMove={setMoveTarget} />
                  ))}
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={!!moveTarget} onOpenChange={(open) => !open && setMoveTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading text-base">
              {moveTarget?.ticker} in Sektion verschieben
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {sections.map((name) => (
              <Button
                key={name}
                variant={moveTarget?.watchlistSection === name ? 'secondary' : 'outline'}
                size="sm"
                disabled={isPending}
                onClick={() => applySection(name)}
                className="justify-start font-mono text-xs"
              >
                {name}
              </Button>
            ))}
            <div className="flex gap-2">
              <Input
                placeholder="Neue Sektion …"
                value={newSection}
                onChange={(e) => setNewSection(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newSection.trim()) applySection(newSection)
                }}
                className="h-8 font-mono text-xs"
                maxLength={40}
              />
              <Button
                size="sm"
                disabled={isPending || !newSection.trim()}
                onClick={() => applySection(newSection)}
                className="h-8"
              >
                OK
              </Button>
            </div>
            {moveTarget?.watchlistSection && (
              <Button
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={() => applySection(null)}
                className="justify-start font-mono text-xs text-muted-foreground"
              >
                Aus Sektion entfernen
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
