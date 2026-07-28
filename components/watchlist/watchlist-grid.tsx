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
import { CHART_COLORS } from '@/components/chart/colors'
import { InstrumentCard, type InstrumentQuote } from '@/components/instrument-card'
import type { InstrumentStats } from '@/lib/instrument-stats'
import {
  SymbolRepairDialog,
  type RepairTarget,
} from '@/components/watchlist/symbol-repair-dialog'
import { syncAllSymbols } from '@/app/actions/symbols'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  FolderInput,
  RefreshCw,
  Search,
} from 'lucide-react'
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
  | {
      status: 'ok'
      closes: number[]
      last: number
      changePct: number
      currency: string | null
      quotedAt: number
      fetchedAt: string
      symbol: string
      approximate: boolean
    }
  | { status: 'unresolved'; note: string | null }
  | { status: 'pending' | 'nodata' | 'error' }

/**
 * Kurse für die ganze Watchlist in EINEM Request.
 *
 * Seit Etappe 9 liest `/api/sparklines` die Kurse aus dem Kursspeicher der
 * Datenbank statt sie beim Anbieter zu holen. Deshalb kommt hier praktisch
 * immer sofort ein vollständiges Ergebnis — das frühere Nachladen wegen
 * Rate-Limits gibt es nicht mehr. Erneut versucht wird nur noch, solange der
 * Speicher für einzelne Symbole noch gar nicht gefüllt ist (`pending`).
 */
/**
 * Takt, in dem die offene Watchlist nachfragt.
 *
 * Die Route frischt dabei selbst auf, wenn der Kursspeicher älter als
 * `QUOTE_STALE_MS` ist — eine Minute Takt heißt also nicht „jede Minute zum
 * Anbieter", sondern „höchstens so alt darf das Angezeigte werden".
 */
const POLL_MS = 60_000

function useSparklines() {
  const [sparks, setSparks] = useState<Record<number, SparkEntry>>({})
  // Hochzählen erzwingt einen neuen Durchlauf des Effekts. Gebraucht nach jeder
  // Änderung an der Zuordnung: `router.refresh()` erneuert nur die Server-Daten,
  // die Kursliste hier liegt im Client — ohne dieses Signal stünde nach einer
  // erfolgreichen Reparatur weiterhin „kein Symbol" in der Zeile.
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | null = null

    const schedule = (ms: number) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(load, ms)
    }

    const load = async ({ force = false } = {}) => {
      // Im Hintergrundtab nicht WEITER abfragen: Niemand sieht die Zahl, und der
      // Anbieter bekommt trotzdem Verkehr. Beim Zurückkommen holt der
      // Sichtbarkeits-Horcher unten sofort nach.
      //
      // Der erste Abruf läuft trotzdem (`force`) — sonst stünde in einem im
      // Hintergrund geöffneten Tab dauerhaft „…" statt eines Kurses.
      if (!force && document.visibilityState === 'hidden') {
        schedule(POLL_MS)
        return
      }
      try {
        const res = await fetch('/api/sparklines', { cache: 'no-store' })
        if (!res.ok) throw new Error()
        const data = (await res.json()) as { sparks: Record<number, SparkEntry> }
        if (cancelled) return
        setSparks(data.sparks)
        attempts = 0
        // Noch ungefüllte Symbole kommen schneller dran als der Regeltakt.
        const hasPending = Object.values(data.sparks).some((e) => e.status === 'pending')
        schedule(hasPending ? 20_000 : POLL_MS)
      } catch {
        if (cancelled) return
        // Nach einem Fehlschlag zurückhaltender werden statt stur weiterzuklopfen.
        attempts++
        schedule(Math.min(POLL_MS, 10_000 * attempts))
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    void load({ force: true })

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      if (timer) clearTimeout(timer)
    }
  }, [reloadKey])

  return { sparks, reload: () => setReloadKey((k) => k + 1) }
}

/**
 * „vor 3 Min." statt einer Uhrzeit, die man erst umrechnen muss.
 *
 * Wichtig ist die Ehrlichkeit dahinter: Angezeigt wird, wann der Kurs GEHOLT
 * wurde. Ein Kurs von gestern Abend bleibt sichtbar ein Kurs von gestern Abend —
 * die Alternative wäre, ihn wie einen aktuellen aussehen zu lassen.
 */
function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'gerade eben'
  if (min < 60) return `vor ${min} Min.`
  const h = Math.floor(min / 60)
  if (h < 24) return `vor ${h} Std.`
  return `vor ${Math.floor(h / 24)} Tg.`
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
        stroke={positive ? CHART_COLORS.up : CHART_COLORS.down}
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
  onRepair,
  card,
  cardQuote,
  currency,
  expanded,
  onToggleCard,
}: {
  s: StockWithStats
  spark: SparkEntry | undefined
  onMove: (s: StockWithStats) => void
  onRepair: (s: StockWithStats) => void
  /** Kennzahlen des Instruments; fehlt, wenn es weder Prognosen noch Trades hat. */
  card: InstrumentStats | undefined
  cardQuote: InstrumentQuote | undefined
  currency: string
  expanded: boolean
  onToggleCard: (id: number) => void
}) {
  const ok = spark?.status === 'ok' ? spark : null
  const positive = ok ? ok.changePct >= 0 : true
  const prev = ok && ok.closes.length >= 2 ? ok.closes[ok.closes.length - 2] : null
  const changeAbs = ok && prev !== null ? ok.last - prev : null

  // Ohne Zuordnung gibt es keinen Kurs — und der Nutzer soll erfahren WARUM und
  // was er dagegen tun kann, statt vor einem leeren Feld zu stehen.
  const needsRepair =
    spark?.status === 'unresolved' ||
    (!spark && s.resolutionStatus !== null && s.resolutionStatus !== 'ok')

  return (
    <div className="border-b border-border/50">
    <div className="group relative flex items-center gap-3 px-3 py-2 transition-colors hover:bg-primary/5">
      <Link href={`/stock/${s.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-foreground">{s.ticker}</span>
            {/* Weicht das Anbieter-Symbol ab, gehört das sichtbar dazu: Der Kurs
                stammt aus „CL=F", auch wenn in der Watchlist „CL1!" steht. */}
            {ok && ok.symbol.toUpperCase() !== s.ticker.toUpperCase() && (
              <span
                className="font-mono text-[10px] text-muted-foreground"
                title={`Kursquelle: ${ok.symbol}`}
              >
                → {ok.symbol}
              </span>
            )}
            {ok?.approximate && (
              <span
                className="font-mono text-[9px] uppercase tracking-wider text-[color:var(--gold,#e0b455)]"
                title="Näherung: Für diesen Wert gibt es keinen echten Spotkurs, angezeigt wird der Terminkontrakt."
              >
                Näherung
              </span>
            )}
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
          {ok && ok.closes.length >= 2 ? (
            <Sparkline closes={ok.closes} positive={positive} />
          ) : spark?.status === 'pending' || !spark ? (
            <span className="font-mono text-[10px] text-muted-foreground">…</span>
          ) : null}
        </div>

        <div className="w-28 shrink-0 text-right">
          {ok ? (
            <>
              <span className="font-mono text-sm text-foreground">{formatPrice(ok.last)}</span>
              {ok.currency && (
                <span className="ml-1 font-mono text-[9px] text-muted-foreground">
                  {ok.currency}
                </span>
              )}
              {ok.fetchedAt && (
                <p className="font-mono text-[9px] text-muted-foreground">
                  {relativeAge(ok.fetchedAt)}
                </p>
              )}
            </>
          ) : needsRepair ? (
            <span className="font-mono text-[10px] text-destructive">kein Symbol</span>
          ) : (
            <span className="font-mono text-sm text-muted-foreground">…</span>
          )}
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

      {/* Aufklappen nur, wo es auch etwas zu zeigen gibt: Ein Instrument ohne
          Prognosen und ohne Trades hätte eine leere Karte. */}
      {card && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 shrink-0 p-0"
          title={expanded ? 'Kennzahlen einklappen' : 'Prognosen und Trades zeigen'}
          aria-label={expanded ? 'Kennzahlen einklappen' : 'Prognosen und Trades zeigen'}
          aria-expanded={expanded}
          onClick={() => onToggleCard(s.id)}
        >
          <ChevronsUpDown
            className={`size-3.5 ${expanded ? 'text-primary' : 'text-muted-foreground'}`}
          />
        </Button>
      )}

      {needsRepair ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 gap-1 px-2 font-mono text-[10px] text-destructive"
          title={s.resolutionNote ?? 'Symbol zuordnen'}
          onClick={() => onRepair(s)}
        >
          <AlertTriangle className="size-3.5" />
          zuordnen
        </Button>
      ) : (
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
      )}
    </div>

    {expanded && card && (
      <div className="px-3 pb-3">
        <InstrumentCard stats={card} quote={cardQuote} currency={currency} />
      </div>
    )}
    </div>
  )
}

export function WatchlistGrid({
  stocks,
  cards = [],
  cardQuotes = {},
  currency = 'EUR',
}: {
  stocks: StockWithStats[]
  /** Kennzahlen je Instrument (Etappe 10) — die aufklappbare Karte unter der Zeile. */
  cards?: InstrumentStats[]
  cardQuotes?: Record<number, InstrumentQuote>
  currency?: string
}) {
  const router = useRouter()
  const [expandedCard, setExpandedCard] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [marketFilter, setMarketFilter] = useState('alle')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [moveTarget, setMoveTarget] = useState<StockWithStats | null>(null)
  const [repairTarget, setRepairTarget] = useState<RepairTarget | null>(null)
  const [newSection, setNewSection] = useState('')
  const [isPending, startTransition] = useTransition()
  const [syncing, setSyncing] = useState(false)
  const { sparks, reload: reloadQuotes } = useSparklines()

  const cardById = useMemo(() => {
    const m = new Map<number, InstrumentStats>()
    for (const c of cards) m.set(c.stockId, c)
    return m
  }, [cards])

  /** Instrumente ohne belastbare Zuordnung — die Zahl im Hinweisbalken. */
  const unresolved = useMemo(
    () => stocks.filter((s) => s.resolutionStatus !== null && s.resolutionStatus !== 'ok'),
    [stocks],
  )

  const openRepair = (s: StockWithStats) => {
    // Die geprüften Kandidaten liegen bereits an der Zeile — der Dialog muss
    // dafür nichts nachladen.
    let candidates: RepairTarget['candidates'] = []
    try {
      if (s.resolutionCandidates) candidates = JSON.parse(s.resolutionCandidates)
    } catch {
      /* beschädigter Eintrag → Dialog zeigt nur die freie Suche */
    }
    setRepairTarget({
      id: s.id,
      ticker: s.ticker,
      name: s.name,
      providerSymbol: s.providerSymbol,
      note: s.resolutionNote,
      candidates,
    })
  }

  const runSync = () => {
    setSyncing(true)
    startTransition(async () => {
      try {
        const r = await syncAllSymbols()
        if (r.error) {
          toast.error(`Synchronisierung mit Fehler: ${r.error}`)
        } else {
          toast.success(
            `${r.quotesUpdated} Kurse aktualisiert` +
              (r.resolvedNew > 0 ? `, ${r.resolvedNew} Symbole neu zugeordnet` : '') +
              (r.stillUnresolved > 0 ? ` · ${r.stillUnresolved} offen` : ''),
          )
        }
        reloadQuotes()
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Synchronisierung fehlgeschlagen.')
      } finally {
        setSyncing(false)
      }
    })
  }

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
        <div className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted-foreground">
            {filtered.length} / {stocks.length} Instrumente
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={syncing || isPending}
            onClick={runSync}
            title="Symbole prüfen und Kurse neu holen"
            className="h-8 gap-1.5 px-2 font-mono text-[10px]"
          >
            <RefreshCw className={`size-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'läuft …' : 'Kurse aktualisieren'}
          </Button>
        </div>
      </div>

      {unresolved.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2">
          <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
          <span className="font-mono text-[11px] text-foreground">
            {unresolved.length === 1
              ? '1 Instrument hat noch kein gesichertes Symbol'
              : `${unresolved.length} Instrumente haben noch kein gesichertes Symbol`}{' '}
            — ohne Zuordnung gibt es dafür keinen Kurs.
          </span>
          <div className="flex flex-wrap gap-1">
            {unresolved.slice(0, 8).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => openRepair(s)}
                className="rounded border border-destructive/40 px-1.5 py-0.5 font-mono text-[10px] text-destructive transition-colors hover:bg-destructive/10"
              >
                {s.ticker}
              </button>
            ))}
            {unresolved.length > 8 && (
              <span className="font-mono text-[10px] text-muted-foreground">
                +{unresolved.length - 8}
              </span>
            )}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="font-mono text-xs text-muted-foreground">
          Keine Instrumente gefunden.
        </p>
      ) : (
        <div className="panel sheen overflow-hidden">
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
                    <WatchlistRow
                      key={s.id}
                      s={s}
                      spark={sparks[s.id]}
                      onMove={setMoveTarget}
                      onRepair={openRepair}
                      card={cardById.get(s.id)}
                      cardQuote={cardQuotes[s.id]}
                      currency={currency}
                      expanded={expandedCard === s.id}
                      onToggleCard={(id) =>
                        setExpandedCard((cur) => (cur === id ? null : id))
                      }
                    />
                  ))}
              </div>
            )
          })}
        </div>
      )}

      <SymbolRepairDialog
        target={repairTarget}
        onClose={() => setRepairTarget(null)}
        onChanged={reloadQuotes}
      />

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
