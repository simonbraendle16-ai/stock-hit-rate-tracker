'use client'

import type React from 'react'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { createTrade, type TradeInput } from '@/app/actions/trades'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Shield,
  Waves,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const markets = [
  ['aktien', 'Aktien'],
  ['krypto', 'Krypto'],
  ['forex', 'Forex'],
  ['rohstoffe', 'Rohstoffe'],
  ['etf', 'ETF'],
  ['optionen', 'Optionen'],
  ['sonstiges', 'Sonstiges'],
] as const

// deutsche Wellengrad-Notation (Frost & Prechter)
const waveDegrees = [
  'GrandSupercycle',
  'Supercycle',
  'Zyklus',
  'Primär',
  'Intermediär',
  'Minor',
  'Minute',
  'Minuette',
  'Subminuette',
]

const labelCls = 'font-mono text-[10px] tracking-widest uppercase text-primary/60'

export function TradeForm() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    ticker: '',
    direction: 'long' as 'long' | 'short',
    entryPrice: '',
    stopLoss: '',
    takeProfit: '',
    elliottWaveCount: '',
    waveDegree: '',
    elliottInvalidation: '',
    market: 'aktien',
    positionSize: '',
    broker: '',
    strategy: '',
    notes: '',
  })

  const set = (k: keyof typeof form, v: string) =>
    setForm((p) => ({ ...p, [k]: v }))

  // --- Douglas: Die 4 Fragen ---
  const gate = useMemo(() => {
    const q1 = form.elliottWaveCount.trim().length > 0
    const q2 = form.entryPrice.trim().length > 0
    const q3 = form.stopLoss.trim().length > 0
    const q4 =
      form.takeProfit.trim().length > 0 || form.elliottInvalidation.trim().length > 0
    return { q1, q2, q3, q4, all: q1 && q2 && q3 && q4 }
  }, [form])

  // --- live CRV ---
  const rr = useMemo(() => {
    const entry = parseFloat(form.entryPrice)
    const sl = parseFloat(form.stopLoss)
    const tp = parseFloat(form.takeProfit)
    if (!entry || !sl || !tp) return null
    const risk = Math.abs(entry - sl)
    if (risk === 0) return null
    return Math.abs(tp - entry) / risk
  }, [form.entryPrice, form.stopLoss, form.takeProfit])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const payload: TradeInput = {
        ticker: form.ticker,
        direction: form.direction,
        market: form.market,
        entryPrice: parseFloat(form.entryPrice),
        stopLoss: parseFloat(form.stopLoss),
        takeProfit: form.takeProfit ? parseFloat(form.takeProfit) : null,
        positionSize: form.positionSize ? parseFloat(form.positionSize) : null,
        broker: form.broker || null,
        strategy: form.strategy || null,
        notes: form.notes || null,
        elliottWaveCount: form.elliottWaveCount || null,
        waveDegree: form.waveDegree || null,
        elliottInvalidation: form.elliottInvalidation
          ? parseFloat(form.elliottInvalidation)
          : null,
      }
      const { id } = await createTrade(payload)
      toast.success(
        gate.all
          ? 'Trade geplant — bereit zur Ausführung.'
          : 'Entwurf gespeichert. Erst die 4 Fragen vollständig beantworten, dann aktivierbar.',
      )
      router.push(`/trades/${id}`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Konnte nicht gespeichert werden.')
    } finally {
      setLoading(false)
    }
  }

  const Q = ({ ok, n, text }: { ok: boolean; n: number; text: string }) => (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'flex size-5 items-center justify-center rounded-full border font-mono text-[10px]',
          ok
            ? 'border-primary/40 bg-primary/15 text-primary'
            : 'border-border text-muted-foreground',
        )}
      >
        {ok ? <Check className="size-3" /> : n}
      </span>
      <span className={cn('font-mono text-xs', ok ? 'text-foreground' : 'text-muted-foreground')}>
        {text}
      </span>
    </div>
  )

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Douglas 4-Fragen-Gate */}
      <div
        className={cn(
          'glass-card p-4',
          gate.all && 'ring-1 ring-primary/40',
        )}
      >
        <div className="mb-3 flex items-center gap-2">
          <Shield className="size-4 text-primary" />
          <p className="font-mono text-[10px] font-bold tracking-widest text-primary">
            DIE 4 FRAGEN VON DOUGLAS — ENTSCHEIDE DEN TRADE VORHER
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Q ok={gate.q1} n={1} text="Wellenzählung eindeutig?" />
          <Q ok={gate.q2} n={2} text="Wo ist mein Einstieg?" />
          <Q ok={gate.q3} n={3} text="Wo liegt mein Stop-Loss?" />
          <Q ok={gate.q4} n={4} text="Wo ist Ziel / Invalidation?" />
        </div>
        <p className="mt-3 font-mono text-[11px] text-muted-foreground">
          {gate.all
            ? '✓ Der Trade ist entschieden. Ab jetzt wird nur noch ausgeführt — nicht mehr analysiert.'
            : 'Solange nicht alle vier beantwortet sind, bleibt der Trade ein Entwurf und ist nicht aktivierbar.'}
        </p>
      </div>

      {/* Ticker & Richtung */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label className={labelCls}>Ticker / Symbol *</Label>
          <Input
            value={form.ticker}
            onChange={(e) => set('ticker', e.target.value.toUpperCase())}
            placeholder="z. B. AAPL, BTC, EUR/USD"
            className="input-ocean h-11 font-mono"
            required
          />
        </div>
        <div className="space-y-2">
          <Label className={labelCls}>Richtung *</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => set('direction', 'long')}
              className={cn(
                'flex items-center justify-center gap-2 rounded-lg border py-2.5 font-mono text-sm font-bold transition-all',
                form.direction === 'long'
                  ? 'border-positive/40 bg-positive/15 text-positive'
                  : 'border-border text-muted-foreground',
              )}
            >
              <ArrowUpRight className="size-4" /> LONG
            </button>
            <button
              type="button"
              onClick={() => set('direction', 'short')}
              className={cn(
                'flex items-center justify-center gap-2 rounded-lg border py-2.5 font-mono text-sm font-bold transition-all',
                form.direction === 'short'
                  ? 'border-destructive/40 bg-destructive/15 text-destructive'
                  : 'border-border text-muted-foreground',
              )}
            >
              <ArrowDownRight className="size-4" /> SHORT
            </button>
          </div>
        </div>
      </div>

      {/* Kurse */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label className={labelCls}>Einstiegskurs *</Label>
          <Input
            type="number"
            step="any"
            value={form.entryPrice}
            onChange={(e) => set('entryPrice', e.target.value)}
            placeholder="0.00"
            className="input-ocean h-11 font-mono"
            required
          />
        </div>
        <div className="space-y-2">
          <Label className={cn(labelCls, 'flex items-center gap-1 text-destructive/70')}>
            <AlertTriangle className="size-3" /> Stop-Loss *
          </Label>
          <Input
            type="number"
            step="any"
            value={form.stopLoss}
            onChange={(e) => set('stopLoss', e.target.value)}
            placeholder="0.00"
            className="input-ocean h-11 font-mono"
            required
          />
        </div>
        <div className="space-y-2">
          <Label className={cn(labelCls, 'text-positive/70')}>Take-Profit</Label>
          <Input
            type="number"
            step="any"
            value={form.takeProfit}
            onChange={(e) => set('takeProfit', e.target.value)}
            placeholder="0.00"
            className="input-ocean h-11 font-mono"
          />
        </div>
      </div>

      {/* CRV */}
      {rr != null && (
        <div
          className={cn(
            'flex items-center gap-3 rounded-lg border px-3 py-2.5 font-mono text-sm',
            rr >= 2
              ? 'border-positive/30 bg-positive/10 text-positive'
              : rr >= 1
                ? 'border-warning/30 bg-warning/10 text-warning'
                : 'border-destructive/30 bg-destructive/10 text-destructive',
          )}
        >
          <Waves className="size-4" />
          CRV: <span className="font-bold">1:{rr.toFixed(2)}</span>
          {rr < 1 && <span className="ml-1 text-xs">⚠️ Risiko überwiegt!</span>}
        </div>
      )}

      {/* Elliott-Block */}
      <div className="glass-card space-y-4 p-4">
        <div className="flex items-center gap-2">
          <Waves className="size-4 text-primary" />
          <p className="font-mono text-[10px] font-bold tracking-widest text-primary">
            ELLIOTT-WELLEN
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-2 md:col-span-1">
            <Label className={labelCls}>Wellengrad</Label>
            <select
              value={form.waveDegree}
              onChange={(e) => set('waveDegree', e.target.value)}
              className="input-ocean h-11 w-full rounded-lg px-2.5 font-mono text-sm"
            >
              <option value="">– wählen –</option>
              {waveDegrees.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2 md:col-span-1">
            <Label className={labelCls}>Wellenzählung (Frage 1)</Label>
            <Input
              value={form.elliottWaveCount}
              onChange={(e) => set('elliottWaveCount', e.target.value)}
              placeholder="z. B. Welle 3 von (3)"
              className="input-ocean h-11 font-mono"
            />
          </div>
          <div className="space-y-2 md:col-span-1">
            <Label className={labelCls}>Invalidation-Level (Frage 4)</Label>
            <Input
              type="number"
              step="any"
              value={form.elliottInvalidation}
              onChange={(e) => set('elliottInvalidation', e.target.value)}
              placeholder="Analyse ungültig ab…"
              className="input-ocean h-11 font-mono"
            />
          </div>
        </div>
      </div>

      {/* Markt / Größe / Broker */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label className={labelCls}>Markt</Label>
          <select
            value={form.market}
            onChange={(e) => set('market', e.target.value)}
            className="input-ocean h-11 w-full rounded-lg px-2.5 font-mono text-sm"
          >
            {markets.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label className={labelCls}>Positionsgröße</Label>
          <Input
            type="number"
            step="any"
            value={form.positionSize}
            onChange={(e) => set('positionSize', e.target.value)}
            placeholder="Anzahl / Betrag"
            className="input-ocean h-11 font-mono"
          />
        </div>
        <div className="space-y-2">
          <Label className={labelCls}>Broker</Label>
          <Input
            value={form.broker}
            onChange={(e) => set('broker', e.target.value)}
            placeholder="z. B. Interactive Brokers"
            className="input-ocean h-11 font-mono"
          />
        </div>
      </div>

      {/* Strategie / Notizen */}
      <div className="space-y-2">
        <Label className={labelCls}>Strategie / Setup</Label>
        <Textarea
          value={form.strategy}
          onChange={(e) => set('strategy', e.target.value)}
          placeholder="Warum dieser Trade? Welche Bedingungen müssen erfüllt sein?"
          className="input-ocean min-h-24 font-mono text-sm"
        />
      </div>
      <div className="space-y-2">
        <Label className={labelCls}>Notizen</Label>
        <Textarea
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          placeholder="Marktbedingungen, News, Gedanken…"
          className="input-ocean min-h-20 font-mono text-sm"
        />
      </div>

      <div className="flex gap-3 pt-1">
        <Button
          type="submit"
          disabled={loading}
          className="btn-teal-glow h-11 flex-1 font-mono text-sm font-bold tracking-wider"
        >
          {loading ? 'WIRD GESPEICHERT…' : 'TRADE PLANEN'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          className="h-11 px-6 font-mono text-sm"
        >
          ABBRECHEN
        </Button>
      </div>
    </form>
  )
}
