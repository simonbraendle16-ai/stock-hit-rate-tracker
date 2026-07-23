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
  PreTradeQuestionsDialog,
  PRE_TRADE_QUESTIONS,
  type PreTradeAnswer,
} from '@/components/pre-trade-questions-dialog'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Coins,
  FlaskConical,
  Shield,
  TrendingDown,
  TrendingUp,
  Waves,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  computePositionValue,
  computeShares,
  projectStopLoss,
  projectTakeProfit,
} from '@/lib/trade-math'
import { currencySymbol, formatMoney } from '@/lib/format'

const num = (n: number, d = 4) =>
  n.toLocaleString('de-DE', { maximumFractionDigits: d })

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

export function TradeForm({
  startCapital = 10000,
  maxRiskPct = 2,
  currency = 'EUR',
  defaultFeeEntry = 9,
  defaultFeeExit = 9,
}: {
  startCapital?: number
  maxRiskPct?: number
  currency?: string
  defaultFeeEntry?: number
  defaultFeeExit?: number
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [questionsOpen, setQuestionsOpen] = useState(false)
  const [tradedWithMoney, setTradedWithMoney] = useState(true)
  const money$ = (n: number | null | undefined) => formatMoney(n, currency)
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
    investedAmount: '',
    leverage: '1',
    feeEntry: String(defaultFeeEntry),
    feeExit: String(defaultFeeExit),
    takeProfitPct: '100',
    broker: '',
    strategy: '',
    notes: '',
  })

  const set = (k: keyof typeof form, v: string) =>
    setForm((p) => ({ ...p, [k]: v }))

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

  // --- Geld-/Gebühren-Projektion (nur Echtgeld) ---
  const money = useMemo(() => {
    if (!tradedWithMoney) return null
    const invested = parseFloat(form.investedAmount)
    const entry = parseFloat(form.entryPrice)
    if (!invested || !entry) return null
    const sl = parseFloat(form.stopLoss)
    const tp = parseFloat(form.takeProfit)
    const sellPct = parseFloat(form.takeProfitPct) || 100
    const leverage = parseFloat(form.leverage) || 1
    // Gebühren aus dem Formular — 0 ist ein gültiger Wert (gebührenfreier Broker).
    const feeEntry = form.feeEntry.trim() === '' ? defaultFeeEntry : parseFloat(form.feeEntry)
    const feeExit = form.feeExit.trim() === '' ? defaultFeeExit : parseFloat(form.feeExit)
    const fees = { entry: feeEntry, exit: feeExit }
    return {
      shares: computeShares(invested, entry, leverage),
      positionValue: computePositionValue(invested, leverage),
      leverage,
      tp:
        tp > 0
          ? projectTakeProfit({ invested, entry, tp, direction: form.direction, sellPct, leverage, fees })
          : null,
      sl:
        sl > 0
          ? projectStopLoss({ invested, entry, sl, direction: form.direction, leverage, fees })
          : null,
    }
  }, [
    tradedWithMoney,
    form.investedAmount,
    form.entryPrice,
    form.stopLoss,
    form.takeProfit,
    form.takeProfitPct,
    form.leverage,
    form.feeEntry,
    form.feeExit,
    form.direction,
    defaultFeeEntry,
    defaultFeeExit,
  ])

  // --- Risiko-Guard (nur Echtgeld): wie viel % des Kontos riskiert der Stop? ---
  const risk = useMemo(() => {
    if (!tradedWithMoney || !money?.sl || !startCapital) return null
    const riskEur = Math.abs(money.sl.grossLoss)
    const pct = (riskEur / startCapital) * 100
    return { riskEur, pct, over: pct > maxRiskPct }
  }, [tradedWithMoney, money, startCapital, maxRiskPct])

  // Schritt 1: Pflichtfelder prüfen, dann den 4-Fragen-Dialog öffnen.
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.ticker.trim()) {
      toast.error('Ticker ist erforderlich.')
      return
    }
    if (!form.entryPrice.trim() || !form.stopLoss.trim()) {
      toast.error('Einstieg und Stop-Loss sind erforderlich.')
      return
    }
    setQuestionsOpen(true)
  }

  // Schritt 2: Nach Beantwortung der 4 Fragen den Trade anlegen.
  const handleAnswersComplete = async (answers: PreTradeAnswer[]) => {
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
        investedAmount:
          tradedWithMoney && form.investedAmount ? parseFloat(form.investedAmount) : null,
        leverage: form.leverage ? parseFloat(form.leverage) : 1,
        feeEntry: form.feeEntry.trim() === '' ? null : parseFloat(form.feeEntry),
        feeExit: form.feeExit.trim() === '' ? null : parseFloat(form.feeExit),
        takeProfitPct: form.takeProfitPct ? parseFloat(form.takeProfitPct) : 100,
        broker: form.broker || null,
        strategy: form.strategy || null,
        notes: form.notes || null,
        elliottWaveCount: form.elliottWaveCount || null,
        waveDegree: form.waveDegree || null,
        elliottInvalidation: form.elliottInvalidation
          ? parseFloat(form.elliottInvalidation)
          : null,
        tradedWithMoney,
        preTradeAnswers: answers,
      }
      const allYes = answers.every((a) => a.answer === 'ja')
      const { id } = await createTrade(payload)
      setQuestionsOpen(false)
      toast.success(
        allYes
          ? 'Trade geplant — bereit zur Aktivierung.'
          : 'Entwurf gespeichert. Bei einem „Nein" bleibt der Trade nicht aktivierbar.',
      )
      router.push(`/trades/${id}`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Konnte nicht gespeichert werden.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Douglas-Fragen-Gate — beim Speichern als eigene Fenster abgefragt */}
      <div className="glass-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Shield className="size-4 text-primary" />
          <p className="font-mono text-[10px] font-bold tracking-widest text-primary">
            DIE FRAGEN VON DOUGLAS — ENTSCHEIDE DEN TRADE VORHER
          </p>
        </div>
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {PRE_TRADE_QUESTIONS.map((q, i) => (
            <li key={q.key} className="flex items-center gap-2">
              <span className="flex size-5 items-center justify-center rounded-full border border-border font-mono text-[10px] text-muted-foreground">
                {i + 1}
              </span>
              <span className="font-mono text-xs text-muted-foreground">{q.question}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 font-mono text-[11px] text-muted-foreground">
          Beim Speichern beantwortest du jede Frage einzeln mit Ja/Nein. Nur wenn alle mit
          „Ja" beantwortet sind, ist der Trade aktivierbar — sonst bleibt er ein Entwurf.
        </p>
      </div>

      {/* Mit echtem Geld vs. Demo */}
      <div className="space-y-2">
        <Label className={labelCls}>Handelsart</Label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setTradedWithMoney(true)}
            className={cn(
              'flex items-center justify-center gap-2 rounded-lg border py-2.5 font-mono text-sm font-bold transition-all',
              tradedWithMoney
                ? 'border-positive/40 bg-positive/15 text-positive'
                : 'border-border text-muted-foreground',
            )}
          >
            <Banknote className="size-4" /> MIT ECHTEM GELD
          </button>
          <button
            type="button"
            onClick={() => setTradedWithMoney(false)}
            className={cn(
              'flex items-center justify-center gap-2 rounded-lg border py-2.5 font-mono text-sm font-bold transition-all',
              !tradedWithMoney
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-border text-muted-foreground',
            )}
          >
            <FlaskConical className="size-4" /> DEMO · PAPERTRADE
          </button>
        </div>
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

      {/* Risiko-Guard (nur Echtgeld) */}
      {risk != null && (
        <div
          className={cn(
            'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2.5 font-mono text-sm',
            risk.over
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : 'border-positive/30 bg-positive/10 text-positive',
          )}
        >
          <Shield className="size-4" />
          Konto-Risiko:{' '}
          <span className="font-bold">
            {money$(risk.riskEur)} · {risk.pct.toFixed(2)} %
          </span>
          <span className="text-muted-foreground">
            von {money$(startCapital)} (Schwelle {num(maxRiskPct, 1)} %)
          </span>
          {risk.over && (
            <span className="w-full text-xs font-bold">
              ⚠️ Über deiner Risikoschwelle — Position verkleinern oder Stop enger setzen.
            </span>
          )}
        </div>
      )}

      {/* Kapital & Gebühren — nur bei Echtgeld */}
      {tradedWithMoney && (
        <div className="glass-card space-y-4 p-4">
          <div className="flex items-center gap-2">
            <Coins className="size-4 text-primary" />
            <p className="font-mono text-[10px] font-bold tracking-widest text-primary">
              KAPITAL & GEBÜHREN
            </p>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              Gebühren gelten für diesen Trade
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className={labelCls}>Kapitaleinsatz ({currencySymbol(currency)})</Label>
              <Input
                type="number"
                step="any"
                min="0"
                value={form.investedAmount}
                onChange={(e) => set('investedAmount', e.target.value)}
                placeholder="z. B. 5000"
                className="input-ocean h-11 font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label className={labelCls}>Hebel</Label>
              <Input
                type="number"
                step="any"
                min="1"
                value={form.leverage}
                onChange={(e) => set('leverage', e.target.value)}
                placeholder="1"
                className="input-ocean h-11 font-mono"
              />
            </div>
          </div>

          {/* Hebel wirkt auf die Positionsgröße, nicht auf das gebundene Kapital.
              Das Risiko bleibt der Stop — genau so wird es hier auch gezeigt. */}
          {money && money.leverage > 1 && (
            <div className="rounded-lg border border-warning/25 bg-warning/5 p-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-xs sm:grid-cols-3">
                <Row label="Gebundenes Kapital" value={money$(parseFloat(form.investedAmount))} />
                <Row label="Positionswert" value={money$(money.positionValue)} strong />
                <Row label="Stückzahl" value={num(money.shares)} />
              </dl>
              <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                Der Hebel vergrößert die Position, nicht dein Risiko — das bestimmt weiterhin
                allein dein Stop. Prüfe die Risikoschwelle oben.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label className={labelCls}>Gebühr Kauf ({currencySymbol(currency)})</Label>
              <Input
                type="number"
                step="any"
                min="0"
                value={form.feeEntry}
                onChange={(e) => set('feeEntry', e.target.value)}
                className="input-ocean h-11 font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label className={labelCls}>Gebühr Verkauf ({currencySymbol(currency)})</Label>
              <Input
                type="number"
                step="any"
                min="0"
                value={form.feeExit}
                onChange={(e) => set('feeExit', e.target.value)}
                className="input-ocean h-11 font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label className={labelCls}>Verkaufsanteil beim Take-Profit (%)</Label>
              <Input
                type="number"
                step="any"
                min="0"
                max="100"
                value={form.takeProfitPct}
                onChange={(e) => set('takeProfitPct', e.target.value)}
                placeholder="100"
                className="input-ocean h-11 font-mono"
              />
            </div>
          </div>

          {money && (money.tp || money.sl) && (
            <div className="space-y-3">
              {money.tp && (
                <div className="rounded-lg border border-positive/25 bg-positive/5 p-3">
                  <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-positive">
                    <TrendingUp className="size-3.5" /> Beim Take-Profit
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-xs sm:grid-cols-3">
                    <Row label="Stückzahl gesamt" value={num(money.tp.shares)} />
                    <Row label="Davon verkauft" value={num(money.tp.soldShares)} />
                    <Row label="Restposition" value={num(money.tp.remainingShares)} />
                    <Row label="Verkaufserlös" value={money$(money.tp.proceeds)} />
                    <Row label="Brutto-Gewinn" value={money$(money.tp.grossProfit)} />
                    <Row label="Gebühren" value={`−${money$(money.tp.fees)}`} tone="neg" />
                    <Row
                      label="Netto-Gewinn"
                      value={money$(money.tp.netProfit)}
                      tone={money.tp.netProfit >= 0 ? 'pos' : 'neg'}
                      strong
                    />
                  </dl>
                </div>
              )}
              {money.sl && (
                <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3">
                  <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-destructive">
                    <TrendingDown className="size-3.5" /> Beim Stop-Loss (volle Position)
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-xs sm:grid-cols-3">
                    <Row label="Kursverlust" value={money$(money.sl.grossLoss)} tone="neg" />
                    <Row label="Gebühren" value={`−${money$(money.sl.fees)}`} tone="neg" />
                    <Row
                      label="Netto-Verlust"
                      value={money$(money.sl.netLoss)}
                      tone="neg"
                      strong
                    />
                  </dl>
                </div>
              )}
            </div>
          )}
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
        {tradedWithMoney ? (
          <div className="space-y-2">
            <Label className={labelCls}>Stückzahl (aus Kapitaleinsatz)</Label>
            <div className="input-ocean flex h-11 items-center rounded-lg px-3 font-mono text-sm text-muted-foreground">
              {money?.shares != null ? num(money.shares) : '—'}
            </div>
          </div>
        ) : (
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
        )}
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
          {loading ? 'WIRD GESPEICHERT…' : 'WEITER ZUR FINALEN ENTSCHEIDUNG'}
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

      <PreTradeQuestionsDialog
        open={questionsOpen}
        onOpenChange={setQuestionsOpen}
        onComplete={handleAnswersComplete}
        submitting={loading}
      />
    </>
  )
}

function Row({
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
      <dt className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          strong ? 'font-bold' : 'font-medium',
          tone === 'pos' && 'text-positive',
          tone === 'neg' && 'text-destructive',
          !tone && 'text-foreground',
        )}
      >
        {value}
      </dd>
    </div>
  )
}
