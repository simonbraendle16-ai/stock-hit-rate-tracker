'use client'

import type React from 'react'
import { formNumber } from '@/lib/form-number'
import { tradeFormPreview } from '@/lib/trade-form-preview'
import { getPortfolioFxRates } from '@/app/actions/portfolios'
import { useEffect, useMemo, useState } from 'react'
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
import { manualPositionSize, updateSizeForm } from '@/lib/trade-form-size'
import { SetupTagsInput } from '@/components/setup-tags-input'
import {
  TargetStages,
  checkTargets,
  parseTargetDrafts,
  type TargetDraft,
} from '@/components/target-stages'
import { PaperBadge } from '@/components/paper-badge'
import type { PortfolioOption } from '@/lib/portfolio-scope'
import { emptyPlanContext } from '@/lib/plan-context'
import { PlanContextFields } from '@/components/plan-context-fields'
import type { PreTradeAnswer } from '@/lib/pre-trade-questions'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Coins,
  FlaskConical,
  NotebookPen,
  Route,
  Shield,
  Target,
  TrendingDown,
  TrendingUp,
  Waves,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { ticksBetween } from '@/lib/trade-math'
import { getTradeFormInstrumentFor } from '@/app/actions/stocks'
import { contractTradeFelder } from '@/lib/contract-trade'
import type { ContractSpec } from '@/lib/contract-specs'
import { currencySymbol, formatMoney } from '@/lib/format'
import { parseFxRates } from '@/lib/margin'
import { resolveMoneyCurrency } from '@/lib/money-currency'
import {
  DEFAULT_TRADE_KIND,
  TRADE_KIND_HINT,
  TRADE_KIND_LABEL,
  type TradeKind,
} from '@/lib/trade-kind'

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
  maxRiskPct = 2,
  currency = 'EUR',
  // Die wählbaren Depots und das vorbelegte (Etappe 12). Startkapital und
  // Gebühren stehen AM DEPOT — deshalb kommen sie nicht mehr als eigene Werte
  // herein, sondern hängen an der Auswahl unten.
  portfolios,
  defaultPortfolioId = null,
}: {
  maxRiskPct?: number
  currency?: string
  portfolios: PortfolioOption[]
  defaultPortfolioId?: number | null
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [setupTags, setSetupTags] = useState<string[]>([])
  const [planContext, setPlanContext] = useState(emptyPlanContext)
  const [spec, setSpec] = useState<ContractSpec | null>(null)
  const [instrumentStatus, setInstrumentStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [instrumentRetry, setInstrumentRetry] = useState(0)
  const [instrumentCurrency, setInstrumentCurrency] = useState<{ ticker: string; market: string; currency: string | null } | null>(null)

  // Das DEPOT ist die Wahl — nicht mehr die Handelsart.
  //
  // Vorher stand hier ein Umschalter „MIT ECHTEM GELD / DEMO", vorbelegt mit
  // Echtgeld. Ein vergessener Klick hat genügt, damit ein Übungstrade in der
  // echten Auswertung landete. Jetzt wählt man den Ort, und der Ort bestimmt die
  // Handelsart — ein Widerspruch ist nicht mehr eingebbar.
  //
  // Vorbelegt ist das aktive Depot aus der Kopfzeile. Ist dort das Aggregat
  // gewählt, bleibt die Auswahl LEER und muss getroffen werden: In eine
  // Zusammenfassung kann man nicht buchen, und eine stille Ersatzwahl wäre wieder
  // eine Vorbelegung, die man übersieht.
  const [portfolioId, setPortfolioId] = useState<number | null>(defaultPortfolioId)
  const depot = portfolios.find((p) => p.id === portfolioId) ?? null
  currency = depot?.currency ?? currency
  const tradedWithMoney = depot == null || depot.kind !== 'demo'
  const startCapital = depot?.startCapital ?? 0
  const defaultFeeEntry = depot?.defaultFeeEntry ?? 0
  const defaultFeeExit = depot?.defaultFeeExit ?? 0

  // Erfassungsweg. Vorbelegt ist der volle Weg — die Abkürzung wählt man
  // bewusst, nicht aus Versehen.
  const [tradeKind, setTradeKind] = useState<TradeKind>(DEFAULT_TRADE_KIND)
  const quick = tradeKind === 'schnell'
  const money$ = (n: number | null | undefined) => formatMoney(n, currency)
  const [form, setForm] = useState({
    quoteCurrency: '',
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
    contracts: '',
    leverage: '1',
    feeEntry: String(defaultFeeEntry),
    feeExit: String(defaultFeeExit),
    takeProfitPct: '100',
    broker: '',
    strategy: '',
    notes: '',
  })

  const set = (k: keyof typeof form, v: string) => {
    setForm((p) => updateSizeForm(p, k, v))
    setPlanContext(p => ({ ...p, riskConfirmed: false }))
  }

  // Teilziele — optional und IMMER vor dem Kursziel. Das Kursziel selbst steht
  // oben im Formular, ist Pflicht und bildet die äußerste Stufe; der nicht
  // verteilte Rest der Position gehört ihm. Siehe `buildTargetPlan`.
  const [targets, setTargets] = useState<TargetDraft[]>([])

  // --- live CRV ---
  //
  // Mit Stufen der nach Anteilen gewichtete Wert (dieselbe reine Funktion wie
  // auf dem Server), sonst das Verhältnis zum Kursziel.
  const zielCheck = useMemo(
    () =>
      checkTargets({
        entry: formNumber(form.entryPrice),
        stopLoss: formNumber(form.stopLoss),
        direction: form.direction,
        kursziel: formNumber(form.takeProfit),
        drafts: targets,
      }),
    [form.entryPrice, form.stopLoss, form.direction, form.takeProfit, targets],
  )

  const rr = useMemo(() => {
    if (zielCheck.targets.length > 1) return zielCheck.rr
    const entry = formNumber(form.entryPrice)
    const sl = formNumber(form.stopLoss)
    const tp = formNumber(form.takeProfit)
    if (!entry || !sl || !tp) return null
    const risk = Math.abs(entry - sl)
    if (risk === 0) return null
    return Math.abs(tp - entry) / risk
  }, [form.entryPrice, form.stopLoss, form.takeProfit, zielCheck])

  // --- Geld-/Gebühren-Projektion ---
  //
  // Läuft auch auf Papier: Ein Demo-Trade mit Hebel ist nur dann eine echte
  // Übung, wenn Positionswert und Stückzahl dieselben sind wie später mit
  // echtem Geld. Der Unterschied bleibt, dass auf Papier keine Gebühren
  // anfallen — dieselbe Regel wie in `tradeFees`.
  const [fxSnapshots, setFxSnapshots] = useState<Record<number, { rates: Record<string, number>; stand: Date | null }>>({})
  const [fxBusy, setFxBusy] = useState(false)
  const fxSnapshot = portfolioId == null ? null : fxSnapshots[portfolioId]
  const reloadFx = async () => {
    if (portfolioId == null) return
    const id = portfolioId
    setFxBusy(true)
    try {
      const snapshot = await getPortfolioFxRates(id)
      setFxSnapshots(previous => ({ ...previous, [id]: snapshot }))
      setPlanContext(previous => ({ ...previous, riskConfirmed: false }))
    } catch { toast.error('Depotkurse konnten nicht gelesen werden. Eingaben bleiben erhalten.') }
    finally { setFxBusy(false) }
  }
  // Revalidate age on every render, including after a long pause or a new input.
  const conversion = (() => {
    try {
      return { value: resolveMoneyCurrency({
        accountCurrency: currency, quoteCurrency: form.quoteCurrency,
        resolvedCurrency: instrumentCurrency?.ticker === form.ticker.trim().toUpperCase() && instrumentCurrency.market === form.market ? instrumentCurrency.currency : null,
        rates: fxSnapshot?.rates ?? parseFxRates(depot?.fxRates),
        ratesAt: fxSnapshot ? (fxSnapshot.stand ? new Date(fxSnapshot.stand) : null) : depot?.fxRatesAt ? new Date(depot.fxRatesAt) : null,
      }), error: null }
    } catch (err) {
      return { value: null, error: err instanceof Error ? err.message : 'Umrechnung fehlt.' }
    }
  })()
  const preview = tradeFormPreview({
    form, targets: parseTargetDrafts(targets), conversion: conversion.value,
    conversionError: conversion.error, instrumentStatus, spec,
    fees: tradedWithMoney ? {
      entry: quick || !form.feeEntry.trim() ? defaultFeeEntry : formNumber(form.feeEntry),
      exit: quick || !form.feeExit.trim() ? defaultFeeExit : formNumber(form.feeExit),
    } : { entry: 0, exit: 0 },
  })
  const money = preview.value ? { ...preview.value, sl: preview.value.stop } : null

  // --- Kontrakt-Spezifikation (Teil 3) --------------------------------------
  //
  // Hat das Instrument eine gültige Spezifikation, wird in KONTRAKTEN bemessen
  // statt über einen Kapitaleinsatz: Ein Terminkontrakt wird gezählt, nicht für
  // einen Betrag gekauft. Gefragt wird der Server, weil dort auch die
  // Handeingabe am Instrument liegt — die Vorgabenliste allein kennt sie nicht.
  //
  // Der Abruf ist entprellt: Wer „ES1!" tippt, soll nicht bei jedem Buchstaben
  // eine Anfrage auslösen.
  useEffect(() => {
    const ticker = form.ticker.trim()
    if (!ticker) {
      setSpec(null)
      setInstrumentCurrency(null)
      setInstrumentStatus('idle')
      return
    }
    setSpec(null)
    setInstrumentCurrency(null)
    setInstrumentStatus('loading')
    let abgebrochen = false
    const deadline = setTimeout(() => {
      if (!abgebrochen) { abgebrochen = true; setInstrumentStatus('error') }
    }, 20000)
    const timer = setTimeout(() => {
      void getTradeFormInstrumentFor(ticker, form.market)
        .then(({ spec: s, currency }) => {
          if (!abgebrochen) {
            clearTimeout(deadline)
            setSpec(s)
            setInstrumentCurrency({ ticker: ticker.toUpperCase(), market: form.market, currency })
            setInstrumentStatus('ready')
          }
        })
        .catch(() => {
          clearTimeout(deadline)
          if (!abgebrochen) { setSpec(null); setInstrumentStatus('error') }
        })
    }, 400)
    return () => {
      abgebrochen = true
      clearTimeout(timer)
      clearTimeout(deadline)
    }
  }, [form.ticker, form.market, instrumentRetry])

  /** Live-Werte des Kontrakt-Trades: Risiko, Einschuss, Positionsgröße. */
  const kontrakt = useMemo(() => {
    if (!spec) return null
    const n = formNumber(form.contracts)
    const entry = formNumber(form.entryPrice)
    const sl = formNumber(form.stopLoss)
    if (!n || n <= 0 || !entry) return null
    const felder = contractTradeFelder({
      spec,
      contracts: n,
      entryPrice: entry,
      stopLoss: sl || entry,
      leverage: formNumber(form.leverage) || 1,
    })
    if (!felder) return null
    const ticks = sl ? ticksBetween(entry, sl, spec.tickSize) : 0
    return { ...felder, ticks }
  }, [spec, form.contracts, form.entryPrice, form.stopLoss, form.leverage])

  // --- Risiko-Guard: wie viel % des Depotkapitals riskiert der Stop? ---
  //
  // Greift seit Etappe 12 in BEIDEN Depotarten. Vorher war er auf Papier
  // abgeschaltet („dein echtes Konto steht hier nicht im Feuer") — das war ein
  // Denkfehler: Wer die Positionsgröße ohne Bremse übt, übt gerade das ein, wovor
  // die Bremse später schützen soll. Im Demo-Depot misst er gegen das
  // Papier-Startkapital, und weil das gleich groß gewählt ist wie das echte,
  // ergibt derselbe Trade dieselbe Prozentzahl.
  //
  // Die Schwelle selbst (`maxRiskPct`) bleibt kontoweit: „höchstens 2 % pro
  // Trade" ist eine Regel über das eigene Verhalten, keine Eigenschaft eines
  // Kontos — und sie soll in der Übung genauso gelten.
  const risk = useMemo(() => {
    if (!Number.isFinite(startCapital) || !startCapital) return null
    const riskEur = kontrakt && conversion.value
      ? kontrakt.risiko * conversion.value.quoteToAccountRate
      : money?.sl ? Math.abs(money.sl.grossLoss) : null
    if (riskEur === null) return null
    const pct = (riskEur / startCapital) * 100
    return { riskEur, pct, over: pct > maxRiskPct }
  }, [money, kontrakt, conversion, startCapital, maxRiskPct])

  // Schritt 1: Pflichtfelder prüfen. Auf dem vollen Weg öffnet das den
  // Fragen-Dialog; der schnelle Trade legt direkt an — genau das ist sein Zweck.
  //
  // Ticker, Einstieg und Stop werden in BEIDEN Wegen verlangt: ohne Stop gibt es
  // kein vordefiniertes Risiko, und dann wäre es kein schneller Trade, sondern
  // gar kein Plan.
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (instrumentStatus !== 'ready') { toast.error('Bitte warte auf die Instrumentprüfung oder wiederhole den Abruf.'); return }
    if (!conversion.value) { toast.error(conversion.error ?? 'Währungsprüfung fehlt.'); return }
    // Das Depot zuerst: Ohne es wäre nicht bestimmt, ob echtes Geld im Spiel ist.
    // Der Server lehnt es ebenfalls ab (`resolveZielDepot`) — hier steht die
    // Prüfung nur, damit der Hinweis beim Feld erscheint und nicht als Fehler
    // nach dem Absenden.
    if (portfolioId == null) {
      toast.error('Bitte wähle das Depot, in das dieser Trade gebucht wird.')
      return
    }
    if (!form.ticker.trim()) {
      toast.error('Ticker ist erforderlich.')
      return
    }
    if (!form.entryPrice.trim() || !form.stopLoss.trim()) {
      toast.error('Einstieg und Stop-Loss sind erforderlich.')
      return
    }
    // Das Kursziel ist Pflicht — in beiden Erfassungswegen. Ohne es gibt es
    // kein Chance-Risiko-Verhältnis und keinen Wecker am Ziel; ein Plan mit
    // offenem Ende ist kein vordefiniertes Risiko.
    if (!form.takeProfit.trim()) {
      toast.error('Ein Kursziel ist erforderlich — es ist die äußerste Stufe deines Plans.')
      return
    }
    // Ein unschlüssiger Staffelplan bricht später auf dem Server ab — die
    // Meldung gehört aber hierher, solange die Felder noch vor einem stehen.
    if (zielCheck.error) {
      toast.error(zielCheck.error)
      return
    }
    void submitTrade([])
  }

  // Schritt 2: Trade anlegen — mit den Antworten des vollen Wegs oder ohne.
  const submitTrade = async (answers: PreTradeAnswer[]) => {
    if (instrumentStatus !== 'ready') { toast.error('Instrumentprüfung noch nicht abgeschlossen.'); return }
    setLoading(true)
    try {
      const payload: TradeInput = {
        quoteCurrency: form.quoteCurrency,
        ticker: form.ticker,
        direction: form.direction,
        market: form.market,
        entryPrice: formNumber(form.entryPrice),
        stopLoss: formNumber(form.stopLoss),
        takeProfit: form.takeProfit ? formNumber(form.takeProfit) : null,
        positionSize: manualPositionSize({ ...form, contracts: spec ? form.contracts : '' }),
        // Auch auf Papier: Einsatz und Hebel ergeben die Positionsgröße, sonst
        // wäre der Hebel im Demo-Trade eine Zahl ohne Wirkung.
        investedAmount: form.investedAmount ? formNumber(form.investedAmount) : null,
        // Kontrakte (Teil 3): Sind sie gesetzt UND hat das Instrument eine
        // Spezifikation, bestimmen SIE die Positionsgröße, und `investedAmount`
        // wird auf dem Server zum Einschuss. Der Server entscheidet das noch
        // einmal selbst — eine Zahl aus dem Browser ist eine Behauptung.
        contracts: spec && form.contracts ? formNumber(form.contracts) : null,
        leverage: form.leverage ? formNumber(form.leverage) : 1,
        // Beim schnellen Trade bleiben Gebühren, Setup, Begründung und Elliott
        // ungefragt: die Gebühren zieht der Server aus den Einstellungen, der
        // Rest bleibt leer statt hastig ausgefüllt.
        feeEntry: quick || form.feeEntry.trim() === '' ? null : formNumber(form.feeEntry),
        feeExit: quick || form.feeExit.trim() === '' ? null : formNumber(form.feeExit),
        takeProfitPct: !quick && form.takeProfitPct ? formNumber(form.takeProfitPct) : 100,
        // Nur die TEILziele. Das Kursziel geht als `takeProfit` mit und wird
        // vom Server selbst ans Ende des Plans gesetzt (`buildTargetPlan`) —
        // schickte man den vollen Plan, läge es doppelt vor.
        targets: parseTargetDrafts(targets),
        broker: quick ? null : form.broker || null,
        strategy: quick ? null : form.strategy || null,
        setupTags: quick ? [] : setupTags,
        notes: quick ? null : form.notes || null,
        elliottWaveCount: quick ? null : form.elliottWaveCount || null,
        waveDegree: quick ? null : form.waveDegree || null,
        elliottInvalidation:
          !quick && form.elliottInvalidation ? formNumber(form.elliottInvalidation) : null,
        // Das Depot geht mit, die Handelsart NICHT: Der Server leitet sie daraus
        // ab (`createTrade`). Der Browser kann sie damit nicht mehr behaupten.
        portfolioId,
        preTradeAnswers: answers,
        planContext: quick ? null : planContext,
        tradeKind,
      }
      const result = await createTrade(payload)
      if (!result.ok) { toast.error(result.message); return }
      const { id, deckungsHinweis, planReady } = result
      // Der Trade ist angelegt, aber die Deckung konnte NICHT geprüft werden
      // (Fremdwährung ohne hinterlegten Umrechnungskurs). Das gehört gesagt:
      // Sonst sieht ein ungeprüfter Trade aus wie einer, der die Prüfung
      // bestanden hat. Als Warnung und ohne Zeitablauf, damit sie nicht
      // wegrutscht, bevor man sie gelesen hat.
      if (deckungsHinweis) {
        toast.warning(deckungsHinweis, { duration: Infinity, closeButton: true })
      }
      toast.success(
        quick
          ? 'Schneller Trade angelegt — sofort aktivierbar.'
          : planReady
            ? 'Trade geplant — bereit zur Aktivierung.'
            : 'Entwurf gespeichert. Ergänze die fehlenden Planangaben vor der Aktivierung.',
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
      {/* Erfassungsweg — bestimmt, wie viel Formular überhaupt kommt. */}
      <FormSection icon={Route} title="Wie erfasst du diesen Trade?">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ChoiceButton
            active={!quick}
            tone="primary"
            icon={Shield}
            onClick={() => setTradeKind('langfristig')}
          >
            {TRADE_KIND_LABEL.langfristig.toUpperCase()}
          </ChoiceButton>
          <ChoiceButton
            active={quick}
            tone="warning"
            icon={Zap}
            onClick={() => setTradeKind('schnell')}
          >
            {TRADE_KIND_LABEL.schnell.toUpperCase()}
          </ChoiceButton>
        </div>
        <p className="note">{TRADE_KIND_HINT[tradeKind]}</p>
        {quick && (
          <p className="note">
            Einstieg und <strong className="text-foreground">Stop bleiben Pflicht</strong> — ohne
            sie wäre es kein schneller Plan, sondern keiner. Der Trade wird als „schnell"
            gekennzeichnet, damit später sichtbar bleibt, dass hier kein Gate lief.
          </p>
        )}
      </FormSection>

      {!quick && <FormSection icon={Shield} title="Konkrete Planprüfung" hint="Vorhandene Angaben übernehmen; nur Lücken ergänzen.">
        <PlanContextFields value={planContext} onChange={setPlanContext} disabled={loading} />
      </FormSection>}

      {/* Der Plan selbst: Handelsart, Instrument, Richtung, Kurse */}
      <FormSection
        icon={Target}
        title="Der Plan"
        hint="Einstieg, Stop und Ziel stehen fest, bevor Geld im Markt ist."
        delay="rise-in-1"
      >
        {/* Das Depot statt der Handelsart (Etappe 12): Man wählt den Ort, und der
            Ort bestimmt, ob echtes Geld im Spiel ist. Ein Papier-Trade im
            Echtgeld-Depot ist damit nicht mehr eingebbar. */}
        <Field
          label="Depot *"
          as="div"
          hint={
            depot == null
              ? 'In welches Depot wird dieser Trade gebucht? Das Depot bestimmt, ob echtes Geld im Spiel ist.'
              : depot.kind === 'demo'
                ? 'Übungsdepot: Der Trade zählt in keine Echtgeld-Kennzahl und wird nie mit Freunden geteilt.'
                : 'Echtgeld: Der Trade zählt in Bilanz, Rendite und die Kennzahlen, die Freunde sehen.'
          }
        >
          <div
            className={
              portfolios.length > 2
                ? 'grid grid-cols-1 gap-2 sm:grid-cols-2'
                : 'grid grid-cols-2 gap-2'
            }
          >
            {portfolios.map((p) => (
              <ChoiceButton
                key={p.id}
                active={portfolioId === p.id}
                tone={p.kind === 'demo' ? 'warning' : 'positive'}
                icon={p.kind === 'demo' ? FlaskConical : Banknote}
                onClick={() => { setPortfolioId(p.id); setPlanContext(c => ({ ...c, riskConfirmed: false })) }}
              >
                {p.name}
              </ChoiceButton>
            ))}
          </div>
          {depot == null && (
            <InlineNotice tone="warning" className="mt-2">
              Bitte ein Depot wählen. In der Kopfzeile ist gerade die Zusammenfassung „Alle
              Echtgeld-Depots" aktiv — in die lässt sich nicht buchen.
            </InlineNotice>
          )}
          {depot?.kind === 'demo' && (
            <div className="mt-2 flex flex-col items-start gap-2">
              <PaperBadge size="compact" />
              <p className="note">
                Geplante Einstiege, TP und Stop werden automatisch zu deinen festgelegten
                Preisen verbucht, auch bei Kurssprüngen. Prüfung stündlich in
                5-Minuten-Auflösung, auch bei geschlossener App. Neue Pläne und Änderungen gelten
                ab der nächsten vollständigen Kerze. Du kannst weiterhin manuell handeln.
              </p>
            </div>
          )}
        </Field>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Kurswährung *">
            <select className={selectCls} value={form.quoteCurrency} onChange={e => set('quoteCurrency', e.target.value)}>
              <option value="">Währung des Instrumentkurses wählen</option>
              {['USD', 'EUR', 'CHF', 'GBP', 'JPY', 'CAD', 'AUD'].map(code => <option key={code} value={code}>{code}</option>)}
            </select>
            <p className="note">Depot: {currency}. {conversion.error ?? `Plankurs: 1 ${conversion.value?.quoteCurrency} = ${conversion.value?.quoteToAccountRate} ${currency}.`}</p>
          </Field>
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
              type="text"
              inputMode="decimal"
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
              type="text"
              inputMode="decimal"
              step="any"
              value={form.stopLoss}
              onChange={(e) => set('stopLoss', e.target.value)}
              placeholder="0.00"
              className={inputCls}
              required
            />
          </Field>
          {/* Das Kursziel ist PFLICHT und bleibt immer bedienbar.
              Vorher hieß das Feld „Take-Profit", war optional und wurde
              **gesperrt**, sobald Teilziele existierten — dann zeigte es Stufe 1
              der Staffel. Damit stand die wichtigste Zahl des Plans weder im
              Formular noch in der Auswertung: Ein Trade mit den Stufen 200/190
              führte 200 als „Ziel", und ändern ließ es sich gar nicht mehr. */}
          <Field
            label="Kursziel *"
            tone="positive"
            hint={
              targets.length > 0
                ? 'Die äußerste Stufe — die Teilziele liegen davor.'
                : undefined
            }
          >
            <Input
              type="text"
              inputMode="decimal"
              step="any"
              value={form.takeProfit}
              onChange={(e) => set('takeProfit', e.target.value)}
              placeholder="0.00"
              className={inputCls}
              required
            />
          </Field>
        </div>

        {/* Teilziele (Etappe 13) — der gestaffelte Ausstieg, festgelegt bevor
            die Position steht. Auch auf dem schnellen Weg: Stufen sind ein Teil
            des vordefinierten Risikos, nicht des Beiwerks. */}
        <TargetStages
          entry={formNumber(form.entryPrice)}
          stopLoss={formNumber(form.stopLoss)}
          direction={form.direction}
          kursziel={formNumber(form.takeProfit)}
          drafts={targets}
          onChange={next => { setTargets(next); setPlanContext(c => ({ ...c, riskConfirmed: false })) }}
          disabled={loading}
        />

        {/* CRV */}
        {rr != null && (
          <InlineNotice
            tone={rr >= 2 ? 'positive' : rr >= 1 ? 'warning' : 'destructive'}
            icon={Waves}
          >
            CRV: <span className="font-bold">1:{rr.toFixed(2)}</span>
            {zielCheck.targets.length > 1 && (
              <span className="text-xs text-muted-foreground">
                gewichtet über {zielCheck.targets.length} Stufen
              </span>
            )}
            {rr < 1 && <span className="text-xs">Risiko überwiegt.</span>}
          </InlineNotice>
        )}

        {/* Risiko-Guard — greift in beiden Depotarten, im Demo gegen das
            Papier-Startkapital. */}
        {risk != null && (
          <InlineNotice tone={risk.over ? 'destructive' : 'positive'} icon={Shield}>
            {tradedWithMoney ? 'Konto-Risiko:' : 'Papier-Risiko:'}{' '}
            <span className="font-bold">
              {money$(risk.riskEur)} · {risk.pct.toFixed(2)} %
            </span>
            <span className="text-muted-foreground">
              von {money$(startCapital)}
              {!tradedWithMoney && ' Papier-Startkapital'} (Schwelle {num(maxRiskPct, 1)} %)
            </span>
            {risk.over && (
              <span className="w-full text-xs font-bold">
                Über deiner Risikoschwelle — Position verkleinern oder Stop enger setzen.
              </span>
            )}
          </InlineNotice>
        )}
      </FormSection>

      {/* Kapital & Hebel — auf Papier dasselbe, nur ohne echtes Geld und ohne
          Gebühren. Ein Demo-Trade ohne Hebel wäre keine Übung für einen
          gehebelten Echtgeld-Trade. */}
      <FormSection
          icon={Coins}
          title={tradedWithMoney ? 'Kapital und Gebühren' : 'Papier-Kapital und Hebel'}
          hint={
            tradedWithMoney
              ? 'Die Gebühren gelten für diesen Trade — die Voreinstellung steht in den Einstellungen.'
              : 'Übungsgeld: Einsatz und Hebel bestimmen die Positionsgröße wie beim Echtgeld-Trade — nur zahlt niemand etwas.'
          }
          delay="rise-in-2"
        >
          {/* Kontrakte statt Kapitaleinsatz (Teil 3). Ein Terminkontrakt wird
              gezählt, nicht für einen Betrag gekauft — und das Risiko ist dann
              Ticks × Tick-Wert × Kontrakte, unabhängig davon, wie viel Kapital
              jemand einsetzt. Erscheint nur, wenn das Instrument eine gültige
              Spezifikation hat; sonst bleibt alles beim bisherigen Weg. */}
          {instrumentStatus === 'loading' && <p role="status" className="text-sm text-muted-foreground">Instrument und Kontraktdaten werden geprüft …</p>}
          {instrumentStatus === 'error' && (
            <div role="alert" className="space-y-2 text-sm text-destructive">
              <p>Instrumentdaten konnten nicht geladen werden. Die Berechnung und Speicherung bleiben bis zur Prüfung offen.</p>
              <Button type="button" variant="outline" onClick={() => setInstrumentRetry(n => n + 1)}>Erneut prüfen</Button>
            </div>
          )}
          {spec && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Kontrakte">
                  <Input
                    type="text"
                    inputMode="decimal"
                    step="1"
                    min="0"
                    value={form.contracts}
                    onChange={(e) => set('contracts', e.target.value)}
                    placeholder="z. B. 2"
                    className={inputCls}
                  />
                </Field>
                <div className="flex flex-col justify-end">
                  <p className="eyebrow">{spec.name}</p>
                  <p className="note">
                    Tick {num(spec.tickSize, 6)} = {num(spec.tickValue, 2)} {spec.currency} ·
                    Kontraktgröße {num(spec.contractSize, 4)}
                  </p>
                </div>
              </div>

              {kontrakt && (
                <ResultBlock tone="warning">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                    <ResultRow label="Ticks bis Stop" value={num(kontrakt.ticks, 1)} />
                    <ResultRow
                      label={`Risiko (${spec.currency})`}
                      value={num(kontrakt.risiko, 2)}
                      strong
                    />
                    <ResultRow
                      label={`Einschuss (${spec.currency})`}
                      value={num(kontrakt.contractInitialMargin, 2)}
                    />
                    <ResultRow label="Positionsgröße" value={num(kontrakt.positionSize, 4)} />
                  </dl>
                  <p className="note mt-2">
                    {kontrakt.contracts} × {num(kontrakt.ticks, 1)} Ticks ×{' '}
                    {num(spec.tickValue, 2)} {spec.currency}. Reicht die Depotdeckung nicht,
                    lehnt der Server den Trade beim Anlegen ab — mit Begründung, nicht
                    stillschweigend.
                    {spec.currency !== currency &&
                      ` Geprüft wird gegen dein Konto in ${currency}; dafür muss am Depot ein Umrechnungskurs für ${spec.currency} hinterlegt sein.`}
                  </p>
                </ResultBlock>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field
              label={
                spec
                  ? `Kapitaleinsatz (${currencySymbol(currency)}) — bei Kontrakten ungenutzt`
                  : tradedWithMoney
                    ? `Kapitaleinsatz (${currencySymbol(currency)})`
                    : `Papier-Einsatz (${currencySymbol(currency)})`
              }
            >
              <Input
                type="text"
                inputMode="decimal"
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
                type="text"
                inputMode="decimal"
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
          {money && !spec && form.investedAmount.trim() && money.leverage > 1 && (
            <ResultBlock tone="warning">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                <ResultRow
                  label={tradedWithMoney ? 'Gebundenes Kapital' : 'Gebundenes Papiergeld'}
                  value={money$(money.invested)}
                />
                <ResultRow label="Positionswert" value={money$(money.positionValue)} strong />
                <ResultRow label="Stückzahl" value={num(money.shares)} />
              </dl>
              <p className="note mt-2">
                Bei gleichem Einsatz erhöht der Hebel die Positionsgröße und das Stop-Risiko.
                Das Risiko hängt von der Stückzahl und dem Abstand zum Stop ab.{' '}
                {tradedWithMoney
                  ? 'Prüfe die Risikoschwelle oben.'
                  : 'Prüfe die Risikoschwelle oben — sie gilt auf Papier genauso. Wer die Positionsgröße ohne Bremse übt, übt ein, wovor die Bremse später schützen soll.'}
              </p>
            </ResultBlock>
          )}

          {/* Gebühren und Teilverkaufs-Anteil sind auf dem schnellen Weg kein
              Thema: es gelten die Standardgebühren aus den Einstellungen und
              voller Verkauf am Ziel. Auf Papier fallen ohnehin keine Gebühren
              an — dieselbe Regel wie in `tradeFees`. */}
          {!quick && tradedWithMoney && (
            <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-3">
              <Field label={`Gebühr Kauf (${currencySymbol(currency)})`}>
                <Input
                  type="text"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={form.feeEntry}
                  onChange={(e) => set('feeEntry', e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label={`Gebühr Verkauf (${currencySymbol(currency)})`}>
                <Input
                  type="text"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={form.feeExit}
                  onChange={(e) => set('feeExit', e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field
                label="Anteil am Kursziel (%)"
                hint={
                  targets.length > 0
                    ? 'Der Rest nach den Teilzielen — ergibt sich, nicht eintippbar.'
                    : 'Ohne Teilziele geht die ganze Position ins Kursziel.'
                }
              >
                {/* Nur noch Anzeige. Der Anteil des Kursziels ist seit dem
                    Umbau der REST: 100 % minus die Teilziele. Ihn zusätzlich
                    eintippen zu lassen hieße, zwei Wahrheiten über dieselbe
                    Zahl zu führen — und der eingetippte Wert würde beim
                    Speichern ohnehin von `buildTargetPlan` überschrieben. */}
                <Input
                  type="text"
                  inputMode="decimal"
                  step="any"
                  value={
                    zielCheck.targets.length > 0
                      ? String(zielCheck.targets[zielCheck.targets.length - 1].sharePct)
                      : form.takeProfitPct
                  }
                  onChange={(e) => set('takeProfitPct', e.target.value)}
                  disabled={zielCheck.targets.length > 0}
                  placeholder="100"
                  className={inputCls}
                />
              </Field>
            </div>
          )}

          <div aria-live="polite" className="flex flex-col gap-3">
            <p className="eyebrow">Gewinn-/Verlustvorschau · {currency}</p>
            {preview.error && <InlineNotice tone="warning" icon={AlertTriangle}>Vorschau fehlt: {preview.error}</InlineNotice>}
            {conversion.error && portfolioId != null && (
              <div className="flex flex-col gap-2">
                <p className="note">
                  Depot {depot?.name}: Für {form.quoteCurrency || instrumentCurrency?.currency || 'die Kurswährung'} → {currency} einen belegten aktuellen Kurs unter Einstellungen → Depots → Umrechnungskurse hinterlegen.
                  Hinterlegter Zeitpunkt: {(fxSnapshot ? fxSnapshot.stand : depot?.fxRatesAt) ? new Date((fxSnapshot ? fxSnapshot.stand : depot?.fxRatesAt)!).toLocaleString('de-DE') : 'fehlt'}.
                  Danach hier die Depotkurse neu lesen. Die Formulareingaben bleiben erhalten.
                </p>
                <a href="/settings" target="_blank" rel="noopener noreferrer" className="text-sm underline">Depoteinstellungen in neuem Tab öffnen</a>
                <Button type="button" variant="outline" disabled={fxBusy} onClick={() => void reloadFx()}>
                  {fxBusy ? 'Lese Depotkurse …' : 'Depotkurse neu lesen'}
                </Button>
              </div>
            )}
            {money && <>
              <ResultBlock tone="destructive" icon={TrendingDown} title={`Beim Stop-Loss · ${currency} · volle Position vor Teilverkäufen`}>
                <dl className="grid grid-cols-2 gap-3">
                  <ResultRow label="Menge gesamt" value={num(money.shares)} />
                  <ResultRow label={`Kursverlust (${currency})`} value={money$(money.stop.grossLoss)} strong />
                  <ResultRow label={`Mit erfassten Gebühren (${currency})`} value={money$(money.stop.netLoss)} />
                </dl>
              </ResultBlock>
              {money.stages.map((stage, index) => <ResultBlock key={index} tone="positive" icon={TrendingUp} title={`${index === money.stages.length - 1 ? 'Kursziel' : `Teilziel ${index + 1}`} · ${num(stage.price)} ${conversion.value?.quoteCurrency}`}>
                <dl className="grid grid-cols-2 gap-3">
                  <ResultRow label="Anteil der Anfangsposition" value={`${num(stage.sharePct)} %`} />
                  <ResultRow label="Menge am Ziel" value={num(stage.projection.soldShares)} />
                  <ResultRow label={`Brutto-Gewinn (${currency})`} value={money$(stage.projection.grossProfit)} strong />
                </dl>
              </ResultBlock>)}
              <ResultBlock tone={money.netProfit >= 0 ? 'positive' : 'destructive'} title={`Alle Ziele zusammen · ${currency}`}>
                <dl className="grid grid-cols-2 gap-3">
                  <ResultRow label="Brutto-Gewinn" value={money$(money.grossProfit)} />
                  <ResultRow label="Erfasste Gebühren (Einstieg einmal, je Ziel ein Ausstieg)" value={money$(money.totalFees)} />
                  <ResultRow label="Gewinn nach erfassten Gebühren" value={money$(money.netProfit)} tone={money.netProfit >= 0 ? 'positive' : 'destructive'} strong />
                </dl>
              </ResultBlock>
              <p className="note">Planwerte bei Ausführung zu den eingegebenen Kursen und konstantem FX-Plankurs. {tradedWithMoney ? 'Nur die erfassten Ordergebühren sind abgezogen.' : 'Papiergeld: gemäß Demo-Abrechnung ohne Ordergebühren.'} Spread, Slippage, Finanzierung und sonstige unbekannte Kosten sind nicht berücksichtigt. Keine vollständige Nettoprognose.</p>
            </>}
          </div>
        </FormSection>

      {/* Elliott-Block — die Zählung ist Arbeit am Chart, nicht am Ticket. */}
      {!quick && (
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
          <Field label="Wellenzählung (optional ergänzend)">
            <Input
              value={form.elliottWaveCount}
              onChange={(e) => set('elliottWaveCount', e.target.value)}
              placeholder="z. B. Welle 3 von (3)"
              className={inputCls}
            />
          </Field>
          <Field label="Invalidierung des erwarteten Verlaufs" tone="warning">
            <Input
              type="text"
              inputMode="decimal"
              step="any"
              value={form.elliottInvalidation}
              onChange={(e) => set('elliottInvalidation', e.target.value)}
              placeholder="Analyse ungültig ab…"
              className={inputCls}
            />
          </Field>
        </div>
      </FormSection>
      )}

      {/* Ausführung und Einordnung */}
      <FormSection
        icon={NotebookPen}
        title={quick ? 'Ausführung' : 'Ausführung und Einordnung'}
        hint={
          quick
            ? 'Der Markt bestimmt die Kursquelle des Charts.'
            : 'Wo der Trade läuft — und woran du ihn später wiedererkennst.'
        }
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
          {spec || form.investedAmount.trim() ? (
            <Field label="Stückzahl (berechnet)" as="div">
              <div className="input-ocean flex h-11 items-center rounded-lg px-3 font-mono text-sm text-muted-foreground">
                {kontrakt ? num(kontrakt.positionSize) : money?.shares != null ? num(money.shares) : '—'}
              </div>
              {form.investedAmount.trim() && !form.contracts.trim() ? (
                <p className="note">Die Stückzahl folgt aus Kapitaleinsatz, Einstieg, Hebel und Wechselkurs.</p>
              ) : null}
            </Field>
          ) : (
            <Field label="Positionsgröße">
              <Input
                type="text"
                inputMode="decimal"
                step="any"
                value={form.positionSize}
                onChange={(e) => set('positionSize', e.target.value)}
                placeholder="Anzahl der Einheiten"
                className={inputCls}
              />
            </Field>
          )}
          {!quick && (
            <Field label="Broker">
              <Input
                value={form.broker}
                onChange={(e) => set('broker', e.target.value)}
                placeholder="z. B. Interactive Brokers"
                className={inputCls}
              />
            </Field>
          )}
        </div>

        {/* Setup (auswertbar) / Begründung (Freitext) / Notizen — die
            Einordnungs-Schicht. Sie ist der eigentliche Unterschied der beiden
            Wege und entfällt beim schnellen Trade vollständig. Setup-Tags lassen
            sich später jederzeit nachtragen (`updateTradeSetupTags`). */}
        {!quick && (
          <>
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
          </>
        )}
      </FormSection>

      {/* Auf dem Handy untereinander: „WEITER ZUR FINALEN ENTSCHEIDUNG" neben
          „ABBRECHEN" braucht mehr Platz als ein 390er Display hergibt — die
          Zeile schob die Seite nach rechts. Der Hauptknopf steht oben. */}
      <div className="flex flex-col gap-3 pt-1 sm:flex-row">
        <Button
          type="submit"
          disabled={loading || instrumentStatus !== 'ready'}
          className="btn-teal-glow h-11 flex-1 font-mono text-sm font-bold tracking-wider"
        >
          {loading
            ? 'WIRD GESPEICHERT…'
            : quick
              ? 'SCHNELLEN TRADE ANLEGEN'
              : 'PLAN SPEICHERN'}
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

    </>
  )
}

