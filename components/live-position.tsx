'use client'

// Live-Stand einer OFFENEN Position (Etappe 3). Zeigt den aktuellen Kurs (aus
// der letzten Kerze, sichtbar mit Zeitstempel), den unrealisierten P&L in
// Kontowährung UND in R, die Abstände zu Stop und Ziel sowie einen Balken, der
// den Kurs zwischen Stop und Ziel verortet.
//
// Ehrlichkeit vor Schein: der Kurs ist NICHT live, sondern der Schluss der
// letzten geladenen Kerze. Genau so wird er beschriftet („Kurs von 14:32").

import { useEffect, useState } from 'react'
import type { TradeRow } from '@/lib/trade-stats'
import {
  directionalDiff,
  pricePositionFraction,
  unrealizedPnl,
  unrealizedR,
} from '@/lib/trade-stats'
import { settlePosition, type TradeEventRow } from '@/lib/trade-events'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Activity, AlertCircle, BellPlus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SetAlertDialog } from '@/components/set-alert-dialog'

interface QuoteState {
  price: number | null
  time: number | null
  loading: boolean
  error: string | null
  errorCode: string | null
}

function useQuote(symbol: string, market: string, enabled: boolean): QuoteState {
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
        setState({ price: data.price, time: data.time, loading: false, error: null, errorCode: null })
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
  }, [symbol, market, enabled])

  return state
}

const pct = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 1 })
const rMultiple = (n: number) =>
  `${n >= 0 ? '+' : ''}${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} R`

/** Kerzen-Zeitstempel → „Kurs von 14:32" (bzw. mit Datum, wenn nicht heute). */
function quoteTimeLabel(timeSec: number): string {
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

export function LivePosition({
  t,
  currency = 'EUR',
  events,
}: {
  t: TradeRow
  currency?: string
  events?: TradeEventRow[]
}) {
  const [alertOpen, setAlertOpen] = useState(false)
  // Optionen haben keine Gratis-Kursdaten — gar nicht erst abrufen.
  const enabled = t.market !== 'optionen'
  const { price, time, loading, error, errorCode } = useQuote(t.ticker, t.market, enabled)

  // Etappe 6: liegen Events vor und wurde bereits ein Teil verkauft, bezieht sich
  // der unrealisierte Stand auf die verbleibende Restmenge zum gewichteten
  // Durchschnittseinstieg — plus ein realisierter Anteil oben. Ohne Teilverkauf
  // bleibt alles exakt wie in Etappe 3.
  const settle = events && events.length ? settlePosition(t, events) : null
  const partial = settle != null && settle.totalExited > 0
  const openQty = partial ? settle!.openQty : t.positionSize ?? null
  const avgEntry = partial ? settle!.avgEntry : t.entryPrice

  const money =
    price == null
      ? null
      : partial
        ? directionalDiff(price, avgEntry, t.direction) * (openQty ?? 0)
        : unrealizedPnl(t, price)
  const r =
    price == null
      ? null
      : partial && settle!.plannedRiskMoney > 0
        ? (directionalDiff(price, avgEntry, t.direction) * (openQty ?? 0)) / settle!.plannedRiskMoney
        : unrealizedR(t, price)
  const positive = (r ?? money ?? 0) >= 0

  // Abstände in Prozent, bezogen auf den aktuellen Kurs.
  const distStop =
    price != null && t.stopLoss != null ? (Math.abs(price - t.stopLoss) / price) * 100 : null
  const stopSide = price != null && t.stopLoss != null ? (price >= t.stopLoss ? 'über' : 'unter') : ''
  const distTarget =
    price != null && t.takeProfit != null ? (Math.abs(t.takeProfit - price) / price) * 100 : null
  const targetReached =
    price != null && t.takeProfit != null &&
    (t.direction === 'long' ? price >= t.takeProfit : price <= t.takeProfit)

  // Balken Stop (0) → Ziel (1). Marker für Kurs und Einstieg, begrenzt auf 0–100 %.
  const clampPct = (f: number | null): number | null =>
    f == null ? null : Math.max(0, Math.min(1, f)) * 100
  const priceFrac = price != null ? clampPct(pricePositionFraction(t, price)) : null
  const entryFrac = clampPct(pricePositionFraction(t, t.entryPrice))

  return (
    <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-widest text-primary/70">
          <Activity className="size-3" /> Live-Stand
        </p>
        <div className="flex items-center gap-2">
          {time != null && (
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              {quoteTimeLabel(time)}
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setAlertOpen(true)}
            className="h-6 gap-1 px-1.5 font-mono text-[10px] text-muted-foreground hover:text-primary"
          >
            <BellPlus className="size-3" /> Alert
          </Button>
        </div>
      </div>

      {partial && (
        <div className="mb-2 grid grid-cols-2 gap-x-4 gap-y-1 border-b border-primary/15 pb-2 font-mono text-xs sm:grid-cols-3">
          <LP
            label="Realisiert (R)"
            value={rMultiple(settle!.realizedR)}
            tone={settle!.realizedR >= 0 ? 'pos' : 'neg'}
            strong
          />
          {t.tradedWithMoney && (
            <LP
              label="Realisiert (Geld)"
              value={formatMoney(settle!.realizedNet, currency, { signed: true })}
              tone={settle!.realizedNet >= 0 ? 'pos' : 'neg'}
            />
          )}
          <LP
            label="Rest offen"
            value={`${(openQty ?? 0).toLocaleString('de-DE', { maximumFractionDigits: 4 })} / ${settle!.totalEntered.toLocaleString('de-DE', { maximumFractionDigits: 4 })}`}
          />
        </div>
      )}

      {loading ? (
        <p className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Kurs wird geladen …
        </p>
      ) : error ? (
        <p className="flex items-start gap-1.5 font-mono text-[11px] text-warning">
          <AlertCircle className="mt-0.5 size-3 shrink-0" />
          <span>
            {errorCode === 'unsupported'
              ? 'Für diesen Markt gibt es im Gratis-Tier keinen Kurs — bitte den Chart-Link nutzen.'
              : error}
          </span>
        </p>
      ) : price == null ? (
        <p className="font-mono text-[11px] text-muted-foreground">Kein Kurs verfügbar.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-xs sm:grid-cols-4">
            <LP label="Kurs" value={price.toLocaleString('de-DE', { maximumFractionDigits: 4 })} />
            {r != null && (
              <LP
                label={partial ? 'Unreal. Rest (R)' : 'Unreal. P&L'}
                value={rMultiple(r)}
                tone={positive ? 'pos' : 'neg'}
                strong
              />
            )}
            {money != null && t.tradedWithMoney && (
              <LP
                label="in Geld (brutto)"
                value={formatMoney(money, currency, { signed: true })}
                tone={positive ? 'pos' : 'neg'}
              />
            )}
            {distStop != null && (
              <LP label="zum Stop" value={`${pct(distStop)} % ${stopSide}`} />
            )}
            {distTarget != null && (
              <LP
                label="zum Ziel"
                value={targetReached ? 'erreicht ✓' : `noch ${pct(distTarget)} %`}
                tone={targetReached ? 'pos' : undefined}
              />
            )}
          </div>

          {priceFrac != null && (
            <div className="mt-3">
              <div className="relative h-2 rounded-full bg-border">
                {/* Füllung vom Stop bis zum aktuellen Kurs */}
                <div
                  className={cn(
                    'absolute inset-y-0 left-0 rounded-full',
                    positive ? 'bg-positive' : 'bg-destructive',
                  )}
                  style={{ width: `${priceFrac}%` }}
                />
                {/* Einstiegs-Marker */}
                {entryFrac != null && (
                  <div
                    className="absolute inset-y-[-2px] w-0.5 bg-foreground/50"
                    style={{ left: `${entryFrac}%` }}
                    title="Einstieg"
                  />
                )}
                {/* Kurs-Marker */}
                <div
                  className="absolute inset-y-[-3px] w-1 rounded-full bg-foreground"
                  style={{ left: `calc(${priceFrac}% - 2px)` }}
                  title="Aktueller Kurs"
                />
              </div>
              <div className="mt-1 flex justify-between font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                <span>Stop</span>
                <span>Ziel</span>
              </div>
            </div>
          )}
        </>
      )}

      <SetAlertDialog
        open={alertOpen}
        onOpenChange={setAlertOpen}
        ticker={t.ticker}
        market={t.market}
        stockId={t.stockId}
        tradeId={t.id}
        currentPrice={price}
      />
    </div>
  )
}

function LP({
  label,
  value,
  tone,
  strong,
}: {
  label: string
  value: string
  tone?: 'pos' | 'neg'
  strong?: boolean
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <span
        className={cn(
          strong ? 'font-bold' : 'font-medium',
          tone === 'pos' && 'text-positive',
          tone === 'neg' && 'text-destructive',
          !tone && 'text-foreground',
        )}
      >
        {value}
      </span>
    </div>
  )
}
