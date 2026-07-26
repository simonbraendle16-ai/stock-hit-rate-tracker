'use client'

import type React from 'react'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import {
  ChoiceButton,
  Field,
  FormSection,
  InlineNotice,
  ResultBlock,
  ResultRow,
} from '@/components/form-frame'
import { createTrade, type TradeInput } from '@/app/actions/trades'
import { SetupTagsInput } from '@/components/setup-tags-input'
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
  NotebookPen,
  Shield,
  Target,
  TrendingDown,
  TrendingUp,
  Waves,
} from 'lucide-react'
import { toast } from 'sonner'
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

/** Einheitliche Feldhöhe im ganzen Formular. */
const inputCls = 'input-ocean h-11 font-mono'
const selectCls = 'input-ocean h-11 w-full rounded-lg px-2.5 font-mono text-sm'

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
  const [setupTags, setSetupTags] = useState<string[]>([])
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
        setupTags,
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
      <FormSection
        icon={Shield}
        title="Die Fragen von Douglas"
        hint="Entscheide den Trade, bevor du ihn eingehst."
      >
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {PRE_TRADE_QUESTIONS.map((q, i) => (
            <li key={q.key} className="flex items-center gap-2">
              <span className="eyebrow flex size-5 shrink-0 items-center justify-center rounded-full border border-border">
                {i + 1}
              </span>
              <span className="font-mono text-xs text-muted-foreground">{q.question}</span>
            </li>
          ))}
        </ol>
        <p className="note">
          Beim Speichern beantwortest du jede Frage einzeln mit Ja/Nein. Nur wenn alle mit
          „Ja" beantwortet sind, ist der Trade aktivierbar — sonst bleibt er ein Entwurf.
        </p>
      </FormSection>

      {/* Der Plan selbst: Handelsart, Instrument, Richtung, Kurse */}
      <FormSection
        icon={Target}
        title="Der Plan"
        hint="Einstieg, Stop und Ziel stehen fest, bevor Geld im Markt ist."
        delay="rise-in-1"
      >
        <Field label="Handelsart" as="div">
          <div className="grid grid-cols-2 gap-2">
            <ChoiceButton
              active={tradedWithMoney}
              tone="positive"
              icon={Banknote}
              onClick={() => setTradedWithMoney(true)}
            >
              MIT ECHTEM GELD
            </ChoiceButton>
            <ChoiceButton
              active={!tradedWithMoney}
              tone="primary"
              icon={FlaskConical}
              onClick={() => setTradedWithMoney(false)}
            >
              DEMO · PAPERTRADE
            </ChoiceButton>
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Ticker / Symbol *">
            <Input
              value={form.ticker}
              onChange={(e) => set('ticker', e.target.value.toUpperCase())}
              placeholder="z. B. AAPL, BTC, EUR/USD"
              className={inputCls}
              required
            />
          </Field>
          <Field label="Richtung *" as="div">
            <div className="grid grid-cols-2 gap-2">
              <ChoiceButton
                active={form.direction === 'long'}
                tone="positive"
                icon={ArrowUpRight}
                onClick={() => set('direction', 'long')}
              >
                LONG
              </ChoiceButton>
              <ChoiceButton
                active={form.direction === 'short'}
                tone="destructive"
                icon={ArrowDownRight}
                onClick={() => set('direction', 'short')}
              >
                SHORT
              </ChoiceButton>
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-3">
          <Field label="Einstiegskurs *">
            <Input
              type="number"
              step="any"
              value={form.entryPrice}
              onChange={(e) => set('entryPrice', e.target.value)}
              placeholder="0.00"
              className={inputCls}
              required
            />
          </Field>
          <Field label="Stop-Loss *" icon={AlertTriangle} tone="destructive">
            <Input
              type="number"
              step="any"
              value={form.stopLoss}
              onChange={(e) => set('stopLoss', e.target.value)}
              placeholder="0.00"
              className={inputCls}
              required
            />
          </Field>
          <Field label="Take-Profit" tone="positive">
            <Input
              type="number"
              step="any"
              value={form.takeProfit}
              onChange={(e) => set('takeProfit', e.target.value)}
              placeholder="0.00"
              className={inputCls}
            />
          </Field>
        </div>

        {/* CRV */}
        {rr != null && (
          <InlineNotice
            tone={rr >= 2 ? 'positive' : rr >= 1 ? 'warning' : 'destructive'}
            icon={Waves}
          >
            CRV: <span className="font-bold">1:{rr.toFixed(2)}</span>
            {rr < 1 && <span className="text-xs">Risiko überwiegt.</span>}
          </InlineNotice>
        )}

        {/* Risiko-Guard (nur Echtgeld) */}
        {risk != null && (
          <InlineNotice tone={risk.over ? 'destructive' : 'positive'} icon={Shield}>
            Konto-Risiko:{' '}
            <span className="font-bold">
              {money$(risk.riskEur)} · {risk.pct.toFixed(2)} %
            </span>
            <span className="text-muted-foreground">
              von {money$(startCapital)} (Schwelle {num(maxRiskPct, 1)} %)
            </span>
            {risk.over && (
              <span className="w-full text-xs font-bold">
                Über deiner Risikoschwelle — Position verkleinern oder Stop enger setzen.
              </span>
            )}
          </InlineNotice>
        )}
      </FormSection>

      {/* Kapital & Gebühren — nur bei Echtgeld */}
      {tradedWithMoney && (
        <FormSection
          icon={Coins}
          title="Kapital und Gebühren"
          hint="Die Gebühren gelten für diesen Trade — die Voreinstellung steht in den Einstellungen."
          delay="rise-in-2"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label={`Kapitaleinsatz (${currencySymbol(currency)})`}>
              <Input
                type="number"
                step="any"
                min="0"
                value={form.investedAmount}
                onChange={(e) => set('investedAmount', e.target.value)}
                placeholder="z. B. 5000"
                className={inputCls}
              />
            </Field>
            <Field label="Hebel">
              <Input
                type="number"
                step="any"
                min="1"
                value={form.leverage}
                onChange={(e) => set('leverage', e.target.value)}
                placeholder="1"
                className={inputCls}
              />
            </Field>
          </div>

          {/* Hebel wirkt auf die Positionsgröße, nicht auf das gebundene Kapital.
              Das Risiko bleibt der Stop — genau so wird es hier auch gezeigt. */}
          {money && money.leverage > 1 && (
            <ResultBlock tone="warning">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                <ResultRow
                  label="Gebundenes Kapital"
                  value={money$(parseFloat(form.investedAmount))}
                />
                <ResultRow label="Positionswert" value={money$(money.positionValue)} strong />
                <ResultRow label="Stückzahl" value={num(money.shares)} />
              </dl>
              <p className="note mt-2">
                Der Hebel vergrößert die Position, nicht dein Risiko — das bestimmt weiterhin
                allein dein Stop. Prüfe die Risikoschwelle oben.
              </p>
            </ResultBlock>
          )}

          <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-3">
            <Field label={`Gebühr Kauf (${currencySymbol(currency)})`}>
              <Input
                type="number"
                step="any"
                min="0"
                value={form.feeEntry}
                onChange={(e) => set('feeEntry', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label={`Gebühr Verkauf (${currencySymbol(currency)})`}>
              <Input
                type="number"
                step="any"
                min="0"
                value={form.feeExit}
                onChange={(e) => set('feeExit', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Verkaufsanteil beim Take-Profit (%)">
              <Input
                type="number"
                step="any"
                min="0"
                max="100"
                value={form.takeProfitPct}
                onChange={(e) => set('takeProfitPct', e.target.value)}
                placeholder="100"
                className={inputCls}
              />
            </Field>
          </div>

          {money && (money.tp || money.sl) && (
            <div className="space-y-3">
              {money.tp && (
                <ResultBlock tone="positive" icon={TrendingUp} title="Beim Take-Profit">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                    <ResultRow label="Stückzahl gesamt" value={num(money.tp.shares)} />
                    <ResultRow label="Davon verkauft" value={num(money.tp.soldShares)} />
                    <ResultRow label="Restposition" value={num(money.tp.remainingShares)} />
                    <ResultRow label="Verkaufserlös" value={money$(money.tp.proceeds)} />
                    <ResultRow label="Brutto-Gewinn" value={money$(money.tp.grossProfit)} />
                    <ResultRow
                      label="Gebühren"
                      value={`−${money$(money.tp.fees)}`}
                      tone="destructive"
                    />
                    <ResultRow
                      label="Netto-Gewinn"
                      value={money$(money.tp.netProfit)}
                      tone={money.tp.netProfit >= 0 ? 'positive' : 'destructive'}
                      strong
                    />
                  </dl>
                </ResultBlock>
              )}
              {money.sl && (
                <ResultBlock
                  tone="destructive"
                  icon={TrendingDown}
                  title="Beim Stop-Loss (volle Position)"
                >
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                    <ResultRow
                      label="Kursverlust"
                      value={money$(money.sl.grossLoss)}
                      tone="destructive"
                    />
                    <ResultRow
                      label="Gebühren"
                      value={`−${money$(money.sl.fees)}`}
                      tone="destructive"
                    />
                    <ResultRow
                      label="Netto-Verlust"
                      value={money$(money.sl.netLoss)}
                      tone="destructive"
                      strong
                    />
                  </dl>
                </ResultBlock>
              )}
            </div>
          )}
        </FormSection>
      )}

      {/* Elliott-Block */}
      <FormSection
        icon={Waves}
        title="Elliott-Wellen"
        hint="Wo im Zyklus steht der Markt — und ab wo ist diese Lesart hinfällig?"
        delay="rise-in-3"
      >
        <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-3">
          <Field label="Wellengrad">
            <select
              value={form.waveDegree}
              onChange={(e) => set('waveDegree', e.target.value)}
              className={selectCls}
            >
              <option value="">– wählen –</option>
              {waveDegrees.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Wellenzählung (Frage 1)">
            <Input
              value={form.elliottWaveCount}
              onChange={(e) => set('elliottWaveCount', e.target.value)}
              placeholder="z. B. Welle 3 von (3)"
              className={inputCls}
            />
          </Field>
          <Field label="Invalidation-Level (Frage 4)" tone="warning">
            <Input
              type="number"
              step="any"
              value={form.elliottInvalidation}
              onChange={(e) => set('elliottInvalidation', e.target.value)}
              placeholder="Analyse ungültig ab…"
              className={inputCls}
            />
          </Field>
        </div>
      </FormSection>

      {/* Ausführung und Einordnung */}
      <FormSection
        icon={NotebookPen}
        title="Ausführung und Einordnung"
        hint="Wo der Trade läuft — und woran du ihn später wiedererkennst."
        delay="rise-in-4"
      >
        <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-3">
          <Field label="Markt">
            <select
              value={form.market}
              onChange={(e) => set('market', e.target.value)}
              className={selectCls}
            >
              {markets.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          {tradedWithMoney ? (
            <Field label="Stückzahl (berechnet)" as="div">
              <div className="input-ocean flex h-11 items-center rounded-lg px-3 font-mono text-sm text-muted-foreground">
                {money?.shares != null ? num(money.shares) : '—'}
              </div>
            </Field>
          ) : (
            <Field label="Positionsgröße">
              <Input
                type="number"
                step="any"
                value={form.positionSize}
                onChange={(e) => set('positionSize', e.target.value)}
                placeholder="Anzahl / Betrag"
                className={inputCls}
              />
            </Field>
          )}
          <Field label="Broker">
            <Input
              value={form.broker}
              onChange={(e) => set('broker', e.target.value)}
              placeholder="z. B. Interactive Brokers"
              className={inputCls}
            />
          </Field>
        </div>

        {/* Setup (auswertbar) / Begründung (Freitext) / Notizen */}
        <SetupTagsInput
          value={setupTags}
          onChange={setSetupTags}
          freetext={form.strategy}
          disabled={loading}
        />
        <Field label="Begründung / Strategie">
          <Textarea
            value={form.strategy}
            onChange={(e) => set('strategy', e.target.value)}
            placeholder="Warum dieser Trade? Welche Bedingungen müssen erfüllt sein?"
            className="input-ocean min-h-24 font-mono text-sm"
          />
        </Field>
        <Field label="Notizen">
          <Textarea
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Marktbedingungen, News, Gedanken…"
            className="input-ocean min-h-20 font-mono text-sm"
          />
        </Field>
      </FormSection>

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

