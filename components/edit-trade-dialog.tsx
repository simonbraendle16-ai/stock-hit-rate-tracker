'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { emptyPlanContext } from '@/lib/plan-context'
import { PlanContextFields } from '@/components/plan-context-fields'
import type { ManagementReview } from '@/lib/management-review'
import type { TradeRow } from '@/lib/trade-stats'
import { currencySymbol } from '@/lib/format'
import { listTradeTargets, updateTradePlan } from '@/app/actions/trades'
import {
  TargetStages,
  checkTargets,
  parseTargetDrafts,
  type TargetDraft,
} from '@/components/target-stages'
import { parseSetupTags } from '@/lib/setups'
import { SetupTagsInput } from '@/components/setup-tags-input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'

const labelCls = 'font-mono text-[10px] tracking-widest uppercase text-primary/60'

const numOrNull = (s: string): number | null => {
  const v = parseFloat(s)
  return Number.isFinite(v) ? v : null
}

export function EditTradeDialog({
  trade,
  open,
  onOpenChange,
  onDone,
  currency = 'EUR',
}: {
  trade: TradeRow
  open: boolean
  onOpenChange: (v: boolean) => void
  onDone: () => void
  currency?: string
}) {
  const isActive = trade.status === 'aktiv'
  const [entryPrice, setEntryPrice] = useState(String(trade.entryPrice ?? ''))
  const [stopLoss, setStopLoss] = useState(String(trade.stopLoss ?? ''))
  const [takeProfit, setTakeProfit] = useState(
    trade.takeProfit != null ? String(trade.takeProfit) : '',
  )
  const [investedAmount, setInvestedAmount] = useState(
    trade.investedAmount != null ? String(trade.investedAmount) : '',
  )
  const [leverage, setLeverage] = useState(String(trade.leverage ?? 1))
  const [takeProfitPct, setTakeProfitPct] = useState(String(trade.takeProfitPct ?? 100))
  const [elliottInvalidation, setElliottInvalidation] = useState(
    trade.elliottInvalidation != null ? String(trade.elliottInvalidation) : '',
  )
  const [elliottWaveCount, setElliottWaveCount] = useState(trade.elliottWaveCount ?? '')
  const [strategy, setStrategy] = useState(trade.strategy ?? '')
  const [setupTags, setSetupTags] = useState<string[]>(parseSetupTags(trade.setupTags))
  const [notes, setNotes] = useState(trade.notes ?? '')
  const [planContext, setPlanContext] = useState(trade.planContext ?? emptyPlanContext())
  const [managementAssessment, setManagementAssessment] = useState<ManagementReview['assessment']>('unknown')
  const [managementReason, setManagementReason] = useState('Planbezug noch nicht geklärt.')
  const [busy, setBusy] = useState(false)
  const editorTrade = useRef<number|null>(null)
  const [editVersion, setEditVersion] = useState(trade.version)
  useEffect(() => {
    if (!open) { editorTrade.current=null; return }
    // A refresh must not discard an open draft or silently advance its expected version.
    if (editorTrade.current===trade.id) return
    editorTrade.current=trade.id
    setEditVersion(trade.version)
    setPlanContext(trade.planContext ?? emptyPlanContext())
    setManagementAssessment('unknown')
    setManagementReason('Planbezug noch nicht geklärt.')
    setEntryPrice(String(trade.entryPrice ?? ''))
    setStopLoss(String(trade.stopLoss ?? ''))
    setTakeProfit(String(trade.takeProfit ?? ''))
    setElliottInvalidation(String(trade.elliottInvalidation ?? ''))
    setInvestedAmount(String(trade.investedAmount ?? ''))
    setLeverage(String(trade.leverage ?? 1))
    setTakeProfitPct(String(trade.takeProfitPct ?? 100))
    setElliottWaveCount(trade.elliottWaveCount ?? '')
    setStrategy(trade.strategy ?? '')
    setSetupTags(parseSetupTags(trade.setupTags))
    setNotes(trade.notes ?? '')
  }, [open, trade])

  // Teilziele (Etappe 13). Sie hängen nicht an der Trade-Zeile, sondern in einer
  // eigenen Tabelle — deshalb werden sie beim Öffnen geladen, so wie der
  // Teilverkauf-Dialog seine offene Menge lädt.
  //
  // Ausgeführte Stufen stehen fest und sind hier gesperrt: Sie sind bereits
  // abgerechnet, und ein Plan darf keine Geschichte umschreiben. Der Server
  // lehnt es zusätzlich ab.
  const [targets, setTargets] = useState<TargetDraft[]>([])
  const [lockedCount, setLockedCount] = useState(0)

  useEffect(() => {
    if (!open) return
    listTradeTargets(trade.id)
      .then((rows) => {
        // Nur die TEILziele in die Liste — die äußerste Stufe IST das Kursziel
        // und steht in seinem eigenen Feld. Stünde sie zusätzlich hier, sähe
        // man sie doppelt und könnte sie an zwei Stellen widersprüchlich ändern.
        const teilziele = rows.slice(0, -1)
        setTargets(
          teilziele.map((r) => ({ price: String(r.price), sharePct: String(r.sharePct) })),
        )
        setLockedCount(teilziele.filter((r) => r.executedAt != null).length)
      })
      .catch(() => {
        setTargets([])
        setLockedCount(0)
      })
  }, [open, trade.id])

  const zielCheck = useMemo(
    () =>
      checkTargets({
        entry: numOrNull(entryPrice) ?? 0,
        stopLoss: numOrNull(stopLoss) ?? 0,
        direction: trade.direction,
        kursziel: numOrNull(takeProfit) ?? 0,
        drafts: targets,
      }),
    [entryPrice, stopLoss, trade.direction, takeProfit, targets],
  )
  // „Gestaffelt" heißt ab hier: mehr als das Kursziel allein.
  const hatStufen = zielCheck.targets.length > 1

  // Änderungen erkennen; die Bewertung wird getrennt und ausdrücklich erfasst.
  const movesLocked = useMemo(() => {
    if (!isActive) return false
    const nextStop = numOrNull(stopLoss)
    const nextInval = numOrNull(elliottInvalidation)
    const stopMoved = nextStop != null && nextStop !== trade.stopLoss
    const invalMoved = nextInval !== trade.elliottInvalidation
    return stopMoved || invalMoved
  }, [isActive, stopLoss, elliottInvalidation, trade.stopLoss, trade.elliottInvalidation])

  const submit = async () => {
    if (movesLocked && !managementReason.trim()) {
      toast.error('Bitte die Bewertung oder den offenen Planbezug begründen.')
      return
    }
    if (zielCheck.error) {
      toast.error(zielCheck.error)
      return
    }
    setBusy(true)
    try {
      await updateTradePlan(
        trade.id,
        {
          entryPrice: numOrNull(entryPrice) ?? undefined,
          stopLoss: numOrNull(stopLoss) ?? undefined,
          // Das Kursziel ist ein eigenes Feld und die ÄUSSERSTE Stufe — es wird
          // direkt gesetzt, nicht mehr aus der Staffel abgeleitet.
          takeProfit: takeProfit === '' ? null : numOrNull(takeProfit),
          // Hier gehen nur die TEILziele hin. Der Server setzt das Kursziel
          // selbst ans Ende (`buildTargetPlan`) — schickte man den vollen Plan,
          // läge es doppelt vor und die Dublettenprüfung schlüge zu.
          // Immer mitschicken, auch leer: Eine geleerte Liste ist die Aussage
          // „keine Teilziele mehr", und nur so lässt sich ein Staffelplan wieder
          // auf ein einzelnes Kursziel zurücknehmen.
          targets: parseTargetDrafts(targets),
          investedAmount: investedAmount === '' ? null : numOrNull(investedAmount),
          leverage: numOrNull(leverage) ?? undefined,
          takeProfitPct: numOrNull(takeProfitPct) ?? undefined,
          elliottInvalidation:
            elliottInvalidation === '' ? null : numOrNull(elliottInvalidation),
          elliottWaveCount: elliottWaveCount,
          strategy,
          setupTags,
          notes,
          ...(!isActive ? { planContext } : {}),
        },
        false,
        movesLocked ? { assessment: managementAssessment, reason: managementReason } : undefined,
        editVersion,
      )
      toast.success(
        movesLocked ? managementAssessment === 'unknown' ? 'Änderung gespeichert — Planbewertung offen.' : managementAssessment === 'violation' ? 'Änderung und bestätigte Abweichung gespeichert.' : 'Änderung laut deiner Angabe planmäßig gespeichert.' : 'Trade aktualisiert.',
      )
      onOpenChange(false)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fehler')
      // Earlier automatic fills may already have committed.
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading tracking-wide">
            {trade.ticker} bearbeiten
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {isActive
              ? 'Aktiver Trade: Änderungen werden dokumentiert. Für Stop und Invalidierung wird der Planbezug getrennt bewertet; ungeklärte Bewertungen bleiben offen.'
              : 'Geplanter Trade: alle Felder frei editierbar.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Einstieg">
            <Input type="number" step="any" value={entryPrice}
              onChange={(e) => { setEntryPrice(e.target.value); setPlanContext(c => ({ ...c, riskConfirmed: false })) }} className="input-ocean font-mono" />
          </Field>
          <Field label="Stop-Loss">
            <Input type="number" step="any" value={stopLoss}
              onChange={(e) => { setStopLoss(e.target.value); setPlanContext(c => ({ ...c, riskConfirmed: false })) }} className="input-ocean font-mono" />
          </Field>
          {/* Immer bedienbar: Das Kursziel ist die äußerste Stufe und ein
              eigenes Feld. Vorher war es bei einem gestaffelten Trade gesperrt
              und zeigte Stufe 1 — die wichtigste Zahl des Plans ließ sich also
              gar nicht mehr ändern. */}
          <Field label={hatStufen ? 'Kursziel (äußerste Stufe)' : 'Kursziel'}>
            <Input type="number" step="any" value={takeProfit}
              onChange={(e) => { setTakeProfit(e.target.value); setPlanContext(c => ({ ...c, riskConfirmed: false })) }} className="input-ocean font-mono" />
          </Field>
          {/* Einsatz und Hebel gibt es auch auf Papier — sonst ließe sich ein
              gehebelter Demo-Trade anlegen, aber nicht mehr korrigieren. */}
          <Field
            label={
              trade.tradedWithMoney
                ? `Kapitaleinsatz (${currencySymbol(currency)})`
                : `Papier-Einsatz (${currencySymbol(currency)})`
            }
          >
            <Input type="number" step="any" value={investedAmount}
              onChange={(e) => { setInvestedAmount(e.target.value); setPlanContext(c => ({ ...c, riskConfirmed: false })) }} className="input-ocean font-mono" />
          </Field>
          <Field label="Hebel">
            <Input type="number" step="any" min="1" value={leverage}
              onChange={(e) => { setLeverage(e.target.value); setPlanContext(c => ({ ...c, riskConfirmed: false })) }} className="input-ocean font-mono" />
          </Field>
          {/* Der Anteil des KURSZIELS. Mit Teilzielen ergibt er sich als Rest
              (100 % minus die Teilziele) und wird deshalb nur angezeigt. */}
          {trade.tradedWithMoney && (
            <Field
              label={hatStufen ? 'Anteil Kursziel (Rest)' : 'Verkaufsanteil TP (%)'}
            >
              <Input type="number" step="any"
                value={
                  hatStufen
                    ? String(zielCheck.targets[zielCheck.targets.length - 1].sharePct)
                    : takeProfitPct
                }
                disabled={hatStufen}
                onChange={(e) => setTakeProfitPct(e.target.value)} className="input-ocean font-mono" />
            </Field>
          )}
          <Field label="Invalidation">
            <Input type="number" step="any" value={elliottInvalidation}
              onChange={(e) => { setElliottInvalidation(e.target.value); setPlanContext(c => ({ ...c, riskConfirmed: false })) }} className="input-ocean font-mono" />
          </Field>
        </div>

        {/* Teilziele (Etappe 13). Ausgeführte Stufen bleiben gesperrt stehen —
            sie sind abgerechnet. */}
        <div className="mt-1">
          <TargetStages
            entry={numOrNull(entryPrice) ?? 0}
            stopLoss={numOrNull(stopLoss) ?? 0}
            direction={trade.direction}
            kursziel={numOrNull(takeProfit) ?? 0}
            drafts={targets}
            onChange={next => { setTargets(next); setPlanContext(c => ({ ...c, riskConfirmed: false })) }}
            disabled={busy}
            lockedCount={lockedCount}
          />
        </div>

        <div className="mt-1 space-y-3">
          <Field label="Wellenzählung">
            <Input value={elliottWaveCount}
              onChange={(e) => setElliottWaveCount(e.target.value)} className="input-ocean font-mono" />
          </Field>
          <SetupTagsInput
            value={setupTags}
            onChange={setSetupTags}
            freetext={strategy}
            disabled={busy}
          />
          <Field label="Begründung / Strategie">
            <Textarea value={strategy} onChange={(e) => setStrategy(e.target.value)}
              className="input-ocean min-h-16 font-mono text-sm" />
          </Field>
          <Field label="Notizen">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              className="input-ocean min-h-16 font-mono text-sm" />
          </Field>
        </div>

        {!isActive && <PlanContextFields value={planContext} onChange={setPlanContext} disabled={busy} />}
        {movesLocked && <div className="flex flex-col gap-3">
          <Field label="Planbezug dieser Stop-/Invalidierungsänderung">
            <select aria-label="Managementbewertung" value={managementAssessment} disabled={busy}
              onChange={e => { setManagementAssessment(e.target.value as ManagementReview['assessment']); setManagementReason(e.target.value === 'unknown' ? 'Planbezug noch nicht geklärt.' : '') }}>
              <option value="unknown">Bewertung offen</option>
              <option value="plan">Laut meiner bestätigten Regel planmäßig</option>
              <option value="violation">Ich bestätige eine Regelabweichung</option>
            </select>
          </Field>
          <Field label="Geltende Regel, Begründung oder offene Frage">
            <Textarea value={managementReason} maxLength={4000} disabled={busy}
              onChange={e => setManagementReason(e.target.value)} />
          </Field>
        </div>}

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={busy}
            className="btn-teal-glow w-full font-mono text-sm font-bold tracking-wider sm:w-auto"
          >
            {busy ? 'WIRD GESPEICHERT…' : 'SPEICHERN'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className={labelCls}>{label}</Label>
      {children}
    </div>
  )
}
