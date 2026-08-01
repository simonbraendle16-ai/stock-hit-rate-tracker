'use client'

// Etappe 14, Abschnitt 2: die Ansicht für den Moment, in dem der Einstieg
// erreicht ist.
//
// WARUM SIE EIGEN IST
// Die Trade-Detailseite kann alles — Chronik, Chart, Teilziele, Kennzahlen. Genau
// deshalb taugt sie hier nicht: Wer aus einer Benachrichtigung kommt, hat Sekunden
// und eine einzige offene Frage („einsteigen oder nicht?"), und eine volle Seite
// beantwortet sie schlechter als eine karge. Hier steht deshalb nur, was für diese
// Entscheidung nötig ist — der Plan, wie er vorher gefasst wurde, und die zwei
// Wege hinaus.
//
// Beide Wege benutzen die BESTEHENDEN Dialoge aus `trade-card.tsx`. Ein zweiter
// Aktivieren-Weg daneben wäre eine zweite Stelle, an der das Pre-Trade-Gate, der
// Revenge-Guard und der Emotions-Check-in hängen — und irgendwann eine, an der
// einer davon fehlt.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { TradeRow } from '@/lib/trade-stats'
import type { TradeTargetRow } from '@/lib/trade-targets'
import { effectiveTargets } from '@/lib/trade-targets'
import { tradeRisk } from '@/lib/trade-stats'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { DouglasQuote, ENTRY_QUOTES } from '@/components/douglas-quote'
import { ActivateDialog, NoTradeDialog } from '@/components/trade-card'
import { useTradeQuote } from '@/components/use-trade-quote'
import { ArrowLeft } from 'lucide-react'

export function EntryMoment({
  trade,
  targets,
  currency,
}: {
  trade: TradeRow
  targets: TradeTargetRow[]
  currency: string
}) {
  const router = useRouter()
  const [activateOpen, setActivateOpen] = useState(false)
  const [noTradeOpen, setNoTradeOpen] = useState(false)
  const [ziel, setZiel] = useState<string | null>(null)

  // Die Weiterleitung hängt bewusst an einem Effekt statt direkt im Callback des
  // Dialogs: Ein `router.push` aus dem Schließzyklus des Dialogs heraus wird
  // verschluckt — geprüft, es passierte schlicht nichts. Der Nutzer stand danach
  // weiter vor einer Entscheidung, die er gerade getroffen hatte, mit einem Knopf,
  // der beim zweiten Druck nur noch einen Fehler geliefert hätte.
  //
  // `replace`, nicht `push`: Der Moment ist mit der Entscheidung vorbei; ein
  // Zurück-Wisch am Handy darf nicht hierher zurückführen.
  useEffect(() => {
    if (!ziel) return
    router.replace(ziel)
    router.refresh()
  }, [ziel, router])

  const quote = useTradeQuote(trade.ticker, trade.market, trade.stockId)
  const stufen = effectiveTargets(trade, targets)
  const risiko = tradeRisk(trade)
  const long = trade.direction !== 'short'

  // Abstand zum geplanten Einstieg — die eine Zahl, die sagt, ob der Moment
  // wirklich jetzt ist. Ohne Kurs bleibt das Feld leer statt zu raten.
  const abstandPct =
    quote.price != null && trade.entryPrice
      ? ((quote.price - trade.entryPrice) / trade.entryPrice) * 100
      : null

  return (
    <div className="space-y-4">
      <Link
        href={`/trades/${trade.id}`}
        className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" /> Zur vollen Trade-Ansicht
      </Link>

      <header className="panel-raised rise-in p-4 sm:p-5">
        <p className="font-mono text-[10px] uppercase tracking-widest text-primary/70">
          Einstieg erreicht
        </p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {trade.ticker}
        </h1>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {long ? 'Long' : 'Short'} · geplant für {fmt(trade.entryPrice)}
        </p>

        <div className="mt-3 font-mono text-sm">
          {quote.loading ? (
            <span className="text-muted-foreground">Kurs wird geladen …</span>
          ) : quote.price != null ? (
            <>
              <span className="text-lg font-bold text-foreground">{fmt(quote.price)}</span>
              {abstandPct != null && (
                <span
                  className={cn(
                    'ml-2',
                    Math.abs(abstandPct) < 0.5 ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  {abstandPct >= 0 ? '+' : ''}
                  {abstandPct.toFixed(2)} % zum Einstieg
                </span>
              )}
              {quote.time != null && (
                <span className="ml-2 text-muted-foreground">
                  · Kurs von {new Date(quote.time * 1000).toLocaleTimeString('de-DE', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">
              Kurs gerade nicht abrufbar — der Plan unten gilt trotzdem.
            </span>
          )}
        </div>
      </header>

      {/* Der Plan, wie er VORHER gefasst wurde. Nichts hier ist auf dieser Seite
          änderbar: Wer im Auslösemoment am Stop dreht, hat keinen Plan mehr. */}
      <section className="panel rise-in-1 p-4 sm:p-5">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Dein Plan
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 font-mono text-sm sm:grid-cols-4">
          <PlanRow label="Einstieg" value={fmt(trade.entryPrice)} />
          <PlanRow label="Stop" value={fmt(trade.stopLoss)} tone="neg" />
          <PlanRow
            label={stufen.length > 1 ? `Ziel 1 von ${stufen.length}` : 'Ziel'}
            value={stufen.length > 0 ? fmt(stufen[0].price) : '—'}
            tone="pos"
          />
          <PlanRow
            label="Risiko"
            value={trade.tradedWithMoney ? formatMoney(risiko, currency) : `${fmt(risiko)} (Papier)`}
            tone="neg"
          />
          {trade.positionSize != null && (
            <PlanRow label="Stückzahl" value={fmt(trade.positionSize)} />
          )}
          {trade.riskRewardRatio != null && (
            <PlanRow label="CRV" value={`${trade.riskRewardRatio.toFixed(2)} : 1`} />
          )}
          {(trade.leverage ?? 1) > 1 && <PlanRow label="Hebel" value={`${fmt(trade.leverage!)}×`} />}
          {trade.elliottInvalidation != null && (
            <PlanRow label="Invalidation" value={fmt(trade.elliottInvalidation)} />
          )}
        </dl>

        {stufen.length > 1 && (
          <p className="note mt-3">
            Weitere Stufen:{' '}
            {stufen
              .slice(1)
              .map((s) => `${fmt(s.price)} (${fmt(s.sharePct)} %)`)
              .join(' · ')}
          </p>
        )}

        {trade.strategy && (
          <p className="note mt-3">
            <span className="text-muted-foreground">Warum du das geplant hast: </span>
            {trade.strategy}
          </p>
        )}
      </section>

      <div className="rise-in-2">
        <DouglasQuote lines={ENTRY_QUOTES} />
      </div>

      {/* Zwei Wege, bewusst gleich gewichtet. Ein großer „Einsteigen"-Knopf neben
          einem kleinen grauen „nicht einsteigen" wäre keine Entscheidung mehr,
          sondern eine Aufforderung. */}
      <section className="rise-in-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Button
          onClick={() => setActivateOpen(true)}
          className="btn-teal-glow h-14 font-mono text-sm font-bold tracking-wider"
        >
          JETZT EINSTEIGEN
        </Button>
        <Button
          variant="outline"
          onClick={() => setNoTradeOpen(true)}
          className="h-14 font-mono text-sm font-bold tracking-wider"
        >
          BEWUSST NICHT EINSTEIGEN
        </Button>
      </section>

      <p className="note">
        Einsteigen führt durch den gewohnten Weg samt Check-in. „Bewusst nicht einsteigen"
        hält den Trade als <span className="font-mono">kein Handel</span> fest — er zählt
        weder als Gewinn noch als Verlust, aber die Entscheidung ist festgehalten statt
        vergessen.
      </p>

      <ActivateDialog
        trade={trade}
        open={activateOpen}
        onOpenChange={setActivateOpen}
        onDone={() => setZiel(`/trades/${trade.id}`)}
      />
      <NoTradeDialog
        trade={trade}
        open={noTradeOpen}
        onOpenChange={setNoTradeOpen}
        onDone={() => setZiel('/trades')}
      />
    </div>
  )
}

function PlanRow({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'pos' | 'neg'
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'font-bold',
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

function fmt(v: number): string {
  const digits = Math.abs(v) >= 1 ? 2 : 6
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  }).format(v)
}
