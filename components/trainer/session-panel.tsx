'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { TradePlanForm } from './trade-plan-form'
import { TradeVerdictForm } from './trade-verdict-form'
import {
  getSessionReview,
  endTrainingSession,
  logTrainingCheckpoint,
} from '@/app/actions/training-trades'
import { TRAINING_TASKS, type TrainingMode } from '@/lib/training'
import {
  CHECKPOINT_DECISIONS,
  summarizeSession,
  type CheckpointDecision,
  type PickField,
  type TrainingTradeView,
} from '@/lib/training-trade'
import { CheckCircle2, ChevronRight, Flag, TrendingDown, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'

function fmt(n: number | null | undefined, stellen = 2): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString('de-DE', {
    minimumFractionDigits: stellen,
    maximumFractionDigits: stellen,
  })
}

/** Ein geübter Trade in der Liste — Plan links, Ergebnis rechts. */
function TradeRow({ t }: { t: TrainingTradeView }) {
  const enthaltung = t.direction === 'keine'
  const ton =
    t.outcome === 'ziel'
      ? 'text-positive'
      : t.outcome === 'stop'
        ? 'text-destructive'
        : 'text-muted-foreground'

  return (
    <div className="panel-sunken flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
      <span className="font-mono text-[10px] text-muted-foreground">#{t.seq}</span>
      {enthaltung ? (
        <span className="font-mono text-xs text-muted-foreground">Kein Setup</span>
      ) : (
        <>
          <span className="flex items-center gap-1 font-mono text-xs">
            {t.direction === 'long' ? (
              <TrendingUp className="size-3.5 text-positive" />
            ) : (
              <TrendingDown className="size-3.5 text-destructive" />
            )}
            {t.direction === 'long' ? 'Long' : 'Short'}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {fmt(t.entryPrice)} · S {fmt(t.stopLoss)} · Z {fmt(t.takeProfit)}
          </span>
          <span className="grow" />
          {t.outcome ? (
            <span className={`font-mono text-xs font-semibold ${ton}`}>
              {t.outcome === 'ziel' ? 'Ziel' : t.outcome === 'stop' ? 'Stop' : 'offen'}{' '}
              {t.rMultiple != null && `${t.rMultiple >= 0 ? '+' : ''}${fmt(t.rMultiple)} R`}
            </span>
          ) : (
            <span className="font-mono text-[11px] text-muted-foreground">läuft</span>
          )}
        </>
      )}
      {t.ambiguous && (
        <span
          className="font-mono text-[10px] text-warning"
          title="Stop und Ziel lagen in derselben Kerze — konservativ gilt der Stop."
        >
          uneindeutig
        </span>
      )}
      {t.rating && (
        <Badge variant="outline" className="font-mono text-[10px]">
          {t.rating}
        </Badge>
      )}
    </div>
  )
}

/**
 * Die Steuerung der Sitzung: Auftrag, laufender Trade, Haltepunkte, Bilanz.
 *
 * Der Ablauf ist bewusst eine Kette kleiner Entscheidungen statt eines großen
 * Formulars — im Markt trifft man auch nicht eine Entscheidung, sondern viele
 * hintereinander. Was hier steht, richtet sich immer nach der Lage: Ist kein
 * Trade offen, ist die einzige Frage „siehst du ein Setup?"; läuft einer, geht
 * es nur noch darum, ob die These trägt.
 */
export function SessionPanel({
  sessionId,
  mode,
  trades,
  visibleCandleTime,
  currentPrice,
  pickField,
  pickedPrice,
  onPickField,
  atCheckpoint,
  ended,
  onTradesChanged,
  onCheckpointHandled,
  onEnded,
}: {
  sessionId: number
  mode: TrainingMode
  trades: TrainingTradeView[]
  /** Zeit der letzten sichtbaren Kerze — Beleg für „vor dem Ergebnis". */
  visibleCandleTime: number | null
  /** Schlusskurs der letzten sichtbaren Kerze — belegt den Einstieg vor. */
  currentPrice: number | null
  /** Kurs-Aufnahme aus dem Chart — der Zustand liegt im Arbeitsplatz. */
  pickField: PickField | null
  pickedPrice: { field: PickField; price: number } | null
  onPickField: (f: PickField | null) => void
  /** Der Replay steht gerade an einem automatischen Haltepunkt. */
  atCheckpoint: boolean
  ended: boolean
  onTradesChanged: () => void
  onCheckpointHandled: () => void
  onEnded: () => void
}) {
  const [planen, setPlanen] = useState(false)
  // Beim ersten Trade der Sitzung offen, danach zu — wer schon einen Plan
  // geschrieben hat, muss die Anleitung nicht dreimal lesen.
  const [auftragOffen, setAuftragOffen] = useState(trades.length === 0)
  const [busy, setBusy] = useState(false)
  const [review, setReview] = useState<Awaited<ReturnType<typeof getSessionReview>> | null>(
    null,
  )

  // Die Rückschau erst laden, wenn die Sitzung steht — vorher wäre sie
  // unvollständig und würde beim Zusehen ständig neu rechnen.
  useEffect(() => {
    if (!ended) return
    let lebt = true
    getSessionReview(sessionId)
      .then((r) => {
        if (lebt) setReview(r)
      })
      .catch(() => {
        /* Ohne Rückschau bleibt die Bilanz trotzdem stehen. */
      })
    return () => {
      lebt = false
    }
  }, [ended, sessionId, trades.length])

  const auftrag = TRAINING_TASKS[mode]
  // Offen ist ein Trade, der gehandelt wurde und noch kein Ergebnis hat.
  const offener = trades.find((t) => t.direction !== 'keine' && t.outcome == null) ?? null
  const unbewertet = trades.find((t) => t.outcome != null && t.rating == null) ?? null
  const bilanz = summarizeSession(
    trades.map((t) => ({
      outcome: t.direction === 'keine' ? null : t.outcome,
      rMultiple: t.rMultiple,
    })),
  )

  async function checkpoint(decision: CheckpointDecision) {
    setBusy(true)
    try {
      await logTrainingCheckpoint({
        sessionId,
        tradeId: offener?.id ?? null,
        candleTime: visibleCandleTime,
        decision,
      })
      // „Ich wäre raus" beendet den Trade nicht — gemessen wird trotzdem bis
      // Stop oder Ziel. Sonst wäre nicht mehr zu sehen, was das Eingreifen
      // gekostet hätte; genau diese Frage stellt auch der Bot-Zwilling.
      onCheckpointHandled()
    } catch {
      toast.error('Konnte nicht gespeichert werden.')
    } finally {
      setBusy(false)
    }
  }

  // Bewusst KEIN „jetzt messen"-Knopf: Der Server misst über die volle
  // Historie, also auch über den noch verdeckten Teil hinweg. Auf Knopfdruck
  // wäre das eine Abkürzung zum Ergebnis, bevor man es aufgedeckt hat. Gemessen
  // wird deshalb nur, wenn der SICHTBARE Kurs Stop oder Ziel berührt hat
  // (erkannt im Workspace) — oder beim Beenden der Sitzung.

  async function beenden() {
    setBusy(true)
    try {
      const res = await endTrainingSession(sessionId)
      // Die Rückschau lädt der Effekt oben, sobald `ended` steht.
      if (res.gemessen > 0) {
        toast.success(`${res.gemessen} offene Trade(s) noch gemessen.`)
      }
      onEnded()
    } catch {
      toast.error('Konnte nicht beendet werden.')
    } finally {
      setBusy(false)
    }
  }

  // --- Sitzung beendet: die Bilanz -----------------------------------------
  if (ended) {
    return (
      <div className="panel space-y-3 p-4">
        <p className="eyebrow">Bilanz der Sitzung</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="panel-sunken px-3 py-2">
            <p className="note">Trades</p>
            <p className="font-mono text-lg">{bilanz.entschieden}</p>
          </div>
          <div className="panel-sunken px-3 py-2">
            <p className="note">Summe</p>
            <p
              className={`font-mono text-lg ${bilanz.summeR >= 0 ? 'text-positive' : 'text-destructive'}`}
            >
              {bilanz.summeR >= 0 ? '+' : ''}
              {fmt(bilanz.summeR)} R
            </p>
          </div>
          <div className="panel-sunken px-3 py-2">
            <p className="note">Ziel / Stop</p>
            <p className="font-mono text-lg">
              {bilanz.ziel} / {bilanz.stop}
            </p>
          </div>
          <div className="panel-sunken px-3 py-2">
            <p className="note">Trefferquote</p>
            <p className="font-mono text-lg">
              {bilanz.quote == null ? '—' : `${bilanz.quote.toFixed(0)} %`}
            </p>
          </div>
        </div>

        {bilanz.keinSetup > 0 && (
          <p className="note">
            {bilanz.keinSetup}× bewusst kein Setup gehandelt. Enthaltungen zählen nicht in
            die Quote — sich herauszuhalten ist kein Fehlschlag.
          </p>
        )}
        {review && review.keinSetup > 0 && (
          <p className="note">
            An {review.keinSetup} Haltepunkten hast du hingesehen und nichts gemacht.
          </p>
        )}

        {/* Wie weit es unterwegs gegen dich lief. Beantwortet „war mein Stop zu
            eng?" mit einer Zahl statt mit einem Gefühl. */}
        {review?.excursion && (
          <div className="panel-sunken space-y-1 px-3 py-2">
            <p className="eyebrow">Verlauf während der Haltedauer</p>
            <p className="note">
              Im Schnitt lief der Kurs{' '}
              <span className="text-destructive">
                {fmt(Math.abs(review.excursion.maeR))} R
              </span>{' '}
              gegen dich und{' '}
              <span className="text-positive">{fmt(review.excursion.mfeR)} R</span> für dich
              — gemessen über {review.excursion.trades}{' '}
              {review.excursion.trades === 1 ? 'Trade' : 'Trades'}.
            </p>
          </div>
        )}

        {/* Was das Eingreifen gekostet hätte — derselbe Gedanke wie beim
            Bot-Zwilling, nur ohne Geld und mit sofortiger Rückmeldung.
            Der Block beobachtet, er ordnet nichts an. */}
        {review && review.eingriff.ausstiege > 0 && (
          <div className="panel-sunken space-y-1 px-3 py-2">
            <p className="eyebrow">Dein Eingreifen</p>
            <p className="note">
              {review.eingriff.ausstiege}× wolltest du vorzeitig raus.{' '}
              {review.eingriff.waerenAufgegangen > 0 ? (
                <>
                  Davon {review.eingriff.waerenAufgegangen}
                  {review.eingriff.waerenAufgegangen === 1 ? ' Trade, der' : ' Trades, die'}{' '}
                  danach das Ziel erreicht{review.eingriff.waerenAufgegangen === 1 ? '' : 'en'} —{' '}
                  <span className="text-warning">
                    {fmt(review.eingriff.entgangenR)} R hätte das gekostet.
                  </span>
                </>
              ) : (
                'Keiner dieser Trades lief danach noch ins Ziel.'
              )}
              {review.eingriff.richtigGewesen > 0 &&
                ` ${review.eingriff.richtigGewesen}× wäre der Ausstieg richtig gewesen.`}
            </p>
          </div>
        )}

        {unbewertet && (
          <TradeVerdictForm
            sessionId={sessionId}
            trade={unbewertet}
            onSaved={onTradesChanged}
          />
        )}

        <div className="space-y-1.5">
          {trades.map((t) => (
            <TradeRow key={t.id} t={t} />
          ))}
        </div>
      </div>
    )
  }

  // --- Ein gemessener, aber noch nicht eingeordneter Trade ------------------
  if (unbewertet) {
    return (
      <div className="panel space-y-3 p-4">
        <TradeVerdictForm
          sessionId={sessionId}
          trade={unbewertet}
          onSaved={onTradesChanged}
        />
      </div>
    )
  }

  // --- Ein Trade planen -----------------------------------------------------
  if (planen) {
    return (
      <div className="panel p-4">
        <TradePlanForm
          sessionId={sessionId}
          mode={mode}
          entryCandleTime={visibleCandleTime}
          currentPrice={currentPrice}
          pickField={pickField}
          pickedPrice={pickedPrice}
          onPickField={onPickField}
          onCommitted={() => {
            setPlanen(false)
            onTradesChanged()
          }}
          onCancel={() => setPlanen(false)}
        />
      </div>
    )
  }

  return (
    <div className="panel space-y-4 p-4">
      {/* Der Auftrag steht oben und bleibt stehen. Ohne ausgesprochene Aufgabe
          sieht man ein Formular und weiß nicht, was man leisten soll. */}
      {/* Der Auftrag klappt zu, sobald der erste Trade steht: Ab da kennt man
          die Aufgabe, und der Platz gehört dem Chart. Der Titel bleibt immer
          stehen — er ist die eine Zeile, die man wirklich braucht. */}
      <div>
        <button
          type="button"
          className="flex w-full items-start gap-2 text-left"
          onClick={() => setAuftragOffen((o) => !o)}
          aria-expanded={auftragOffen}
        >
          <ChevronRight
            className={`mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform ${
              auftragOffen ? 'rotate-90' : ''
            }`}
          />
          <span className="min-w-0">
            <span className="eyebrow block">Deine Aufgabe</span>
            <span className="mt-1 block text-sm font-medium">{auftrag.title}</span>
          </span>
        </button>
        {auftragOffen && (
          <>
            <ol className="mt-2 space-y-1 pl-5">
              {auftrag.steps.map((s, i) => (
                <li key={i} className="note flex gap-2">
                  <span className="text-muted-foreground">{i + 1}.</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
            <p className="note mt-2 pl-5 text-muted-foreground">{auftrag.abstain}</p>
          </>
        )}
      </div>

      {offener ? (
        <div className="space-y-2">
          <p className="eyebrow">Dein laufender Trade</p>
          <TradeRow t={offener} />
          <p className="note">
            Lass den Replay laufen. Berührt der Kurs Stop oder Ziel, wird das Ergebnis
            gemessen — du musst es nicht selbst ablesen.
          </p>

          {atCheckpoint && (
            <div className="panel-sunken space-y-2 p-3">
              <p className="eyebrow">Haltepunkt — trägt die These noch?</p>
              <div className="flex flex-wrap gap-1.5">
                {CHECKPOINT_DECISIONS.filter((d) => d.needsTrade).map((d) => (
                  <Button
                    key={d.id}
                    size="sm"
                    variant="outline"
                    className="h-8 px-2.5 font-mono text-[11px]"
                    title={d.hint}
                    disabled={busy}
                    onClick={() => checkpoint(d.id)}
                  >
                    {d.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

        </div>
      ) : (
        <div className="space-y-2">
          <p className="eyebrow">
            {atCheckpoint ? 'Haltepunkt — siehst du hier ein Setup?' : 'Nächster Schritt'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" className="h-9 gap-1.5 px-3" onClick={() => setPlanen(true)}>
              <CheckCircle2 className="size-3.5" />
              Ja — Trade planen
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9 px-3 font-mono text-[11px]"
              disabled={busy}
              onClick={() => checkpoint('kein_setup')}
            >
              Nein — weiterlaufen
            </Button>
          </div>
          <p className="note">
            „Nein" wird mitgezählt. Wie oft du hinsiehst und dich heraushältst, ist die
            Zahl gegen das Überhandeln.
          </p>
        </div>
      )}

      {/* Der laufende Trade steht schon oben — hier nur das Abgeschlossene,
          sonst stünde derselbe Trade zweimal auf dem Bildschirm. */}
      {trades.some((t) => t.id !== offener?.id) && (
        <div className="space-y-1.5">
          <p className="eyebrow">Bisher in dieser Sitzung</p>
          {trades
            .filter((t) => t.id !== offener?.id)
            .map((t) => (
              <TradeRow key={t.id} t={t} />
            ))}
        </div>
      )}

      <Button
        size="sm"
        variant="ghost"
        className="h-8 w-full gap-1.5 font-mono text-[11px] text-muted-foreground"
        disabled={busy}
        onClick={beenden}
      >
        <Flag className="size-3.5" />
        Sitzung beenden
      </Button>
    </div>
  )
}
