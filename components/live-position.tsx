'use client'

// Live-Stand einer OFFENEN Position (Etappe 3). Zeigt den aktuellen Kurs (aus
// der letzten Kerze, sichtbar mit Zeitstempel), den unrealisierten P&L in
// Kontowährung UND in R, die Abstände zu Stop und Ziel sowie einen Balken, der
// den Kurs zwischen Stop und Ziel verortet.
//
// Ehrlichkeit vor Schein: der Kurs ist NICHT live, sondern der Schluss der
// letzten geladenen Kerze. Genau so wird er beschriftet („Kurs von 14:32").
//
// Seit den Teilzielen trägt der Balken zusätzlich jede geplante Stufe als Marke,
// und die erreichte Stufe lässt sich von hier aus abtragen. Grund: Der Balken
// ist die Anzeige, auf die man beim Handeln schaut — der Staffelplan gehört
// dorthin, wo der Kurs steht, nicht eine Seite weiter.
//
// Gebucht wird trotzdem nichts von selbst. Der Knopf öffnet denselben Dialog wie
// die Teilziele-Karte; ein Fill, den die App erfindet, wäre ein stiller
// Falschwert in der Geldbilanz.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { TradeRow } from '@/lib/trade-stats'
import {
  directionalDiff,
  pricePositionFraction,
  unrealizedPnl,
  unrealizedR,
} from '@/lib/trade-stats'
import { settlePosition, type TradeEventRow } from '@/lib/trade-events'
// Die Stufen rechnet dieselbe reine Funktion, die auch die Teilziele-Karte
// benutzt — die Leiste ist eine zweite Anzeige, keine zweite Wahrheit.
import {
  nextActionableTarget,
  plannedQty,
  targetMarkers,
  type TradeTargetRow,
} from '@/lib/trade-targets'
import { PLAN_COLORS } from '@/components/chart/colors'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Activity, AlertCircle, BellPlus, Check, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SetAlertDialog } from '@/components/set-alert-dialog'
import { ExecuteTargetDialog } from '@/components/execute-target-dialog'
import { CloseDialog } from '@/components/close-dialog'
// Der Kursabruf liegt seit Etappe 14 in `use-trade-quote.ts` — dieselbe Quelle
// nutzt die Einstiegs-Ansicht.
import { quoteTimeLabel, useTradeQuote } from '@/components/use-trade-quote'

const pct = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 1 })
/**
 * Wo steht die Beschriftung einer Stufe über dem Balken?
 *
 * Normalerweise mittig über der Marke. An den Rändern wird sie bündig gezogen —
 * sonst läuft sie aus der Karte, und auf dem Handy sprengt genau das die Seite.
 */
const labelPos = (fraction: number): { left: number; transform: string } => {
  const f = Math.max(0, Math.min(1, fraction)) * 100
  if (f < 8) return { left: 0, transform: 'none' }
  if (f > 92) return { left: 100, transform: 'translateX(-100%)' }
  return { left: f, transform: 'translateX(-50%)' }
}
const rMultiple = (n: number) =>
  `${n >= 0 ? '+' : ''}${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} R`

export function LivePosition({
  t,
  currency = 'EUR',
  events,
  targets,
  triggeredTargetPrices,
}: {
  t: TradeRow
  currency?: string
  events?: TradeEventRow[]
  /** Geplante Stufen. Fehlen sie, verhält sich die Leiste wie vor den Teilzielen. */
  targets?: TradeTargetRow[]
  /** Kurse bereits ausgelöster `ziel`-Alerts — damit zählt auch ein verpasster Docht. */
  triggeredTargetPrices?: number[]
}) {
  const router = useRouter()
  const [alertOpen, setAlertOpen] = useState(false)
  const [stufeOffen, setStufeOffen] = useState(false)
  const [abschlussOffen, setAbschlussOffen] = useState(false)
  // Kurse der Stufen, deren Hinweis für diese Sitzung ausgeblendet ist. Nur im
  // Browser — der Plan selbst bleibt unangetastet.
  const [weggedrueckt, setWeggedrueckt] = useState<number[]>([])
  // Optionen haben keine Gratis-Kursdaten — gar nicht erst abrufen.
  const enabled = t.market !== 'optionen'
  const { price, time, loading, error, errorCode } = useTradeQuote(
    t.ticker,
    t.market,
    t.stockId,
    enabled,
  )

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

  // Die geplanten Stufen auf derselben Skala. Ohne `targets` kommt hier die
  // implizite Einzelstufe aus `takeProfit` heraus — auch ein Trade mit nur einem
  // Kursziel bekommt dadurch seinen Weg nach vorn, sobald es berührt ist.
  const marker = useMemo(
    () => targetMarkers(t, targets ?? [], { price, triggeredPrices: triggeredTargetPrices }),
    [t, targets, price, triggeredTargetPrices],
  )
  // Liegen zwei Stufen dicht beieinander, überlappen ihre Beschriftungen. Dann
  // fällt der Anteil weg und es bleibt „Z1"/„Z2" — der Anteil steht ohnehin im
  // Plan, die LAGE auf dem Balken ist hier die Auskunft, die man sonst nirgends
  // bekommt. Der Schwellwert ist gemessen: „Z1 · 50 %" ist bei 9px-Mono rund
  // 55 px breit, ein Balken im Cockpit rund 500 px — also gut 11 %.
  const eng = useMemo(() => {
    const lagen = marker
      .map((m) => m.fraction)
      .filter((f): f is number => f != null)
      .sort((a, b) => a - b)
    return lagen.some((f, i) => i > 0 && f - lagen[i - 1] < 0.14)
  }, [marker])

  // Gehandelt wird nur an einer aktiven Position — ein geplanter Trade hat noch
  // nichts abzutragen. Weggedrückte Stufen fallen vorher heraus; `marker` selbst
  // bleibt vollständig, damit die Marken auf dem Balken stehen bleiben.
  const faellig =
    t.status === 'aktiv'
      ? nextActionableTarget(marker.filter((m) => !weggedrueckt.includes(m.price)))
      : null

  // Bezug der Anteile ist die ANFANGSposition, genau wie serverseitig in
  // `basisQuantity` — sonst ergäben 50/30/20 nach dem ersten Teilverkauf nicht
  // mehr die ganze Position.
  const basis = events?.find((e) => e.type === 'eroeffnet')?.quantity ?? t.positionSize ?? 0
  const offeneMenge = settle ? settle.openQty : (t.positionSize ?? 0)

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
            // `relative z-20`: Im Cockpit liegt ein flächiger Link über der
            // ganzen Box (Klick auf die Info öffnet den Trade). Die echten
            // Bedienelemente müssen darüber bleiben, sonst navigiert der Knopf
            // statt zu handeln. Auf der Trade-Seite gibt es kein Overlay — dort
            // ist die Angabe wirkungslos.
            className="relative z-20 h-6 gap-1 px-1.5 font-mono text-[10px] text-muted-foreground hover:text-primary"
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
            <div className="mt-3 min-w-0">
              {/* Die Stufen stehen BESCHRIFTET über dem Balken. Vorher trugen sie
                  nur einen 2px-Strich in `PLAN_COLORS.target` — und das ist
                  dasselbe Grün wie die Füllung im Gewinn, die Marke verschwand
                  also genau dort, wo man sie braucht. Jetzt: Label oben, Strich
                  mit Trennkante, damit er auf jedem Untergrund steht. */}
              <div className="relative h-3.5">
                {marker.map((m) => {
                  if (m.fraction == null) return null
                  const lage = labelPos(m.fraction)
                  return (
                    <span
                      key={`label-${m.sortOrder}`}
                      className={cn(
                        'absolute bottom-0 whitespace-nowrap font-mono text-[9px] leading-none tracking-wider',
                        m.executed && 'line-through opacity-60',
                      )}
                      style={{
                        left: `${lage.left}%`,
                        transform: lage.transform,
                        color: m.executed ? undefined : PLAN_COLORS.target,
                      }}
                    >
                      {m.isLast
                        ? 'Ziel'
                        : eng
                          ? `Z${m.sortOrder + 1}`
                          : `Z${m.sortOrder + 1} · ${pct(m.sharePct)} %`}
                    </span>
                  )
                })}
              </div>
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
                {/* Stufen-Marken. Sie stehen VOR dem Kurs-Marker, damit der
                    oben bleibt: Wo der Kurs steht, ist die wichtigere Auskunft.
                    Die letzte Stufe ist das Kursziel und damit das Balkenende —
                    sie bekommt keinen eigenen Strich, sonst stünde er auf der
                    Kante und sähe aus wie ein Rand. */}
                {marker.map((m) =>
                  m.fraction == null || m.isLast ? null : (
                    <div
                      key={`marke-${m.sortOrder}`}
                      className="absolute inset-y-[-4px] w-[3px] rounded-sm"
                      style={{
                        // Auf dem Kurswert ZENTRIERT, wie der Kurs-Marker unten
                        // auch — sonst säße das mittig gesetzte Label daneben
                        // statt darüber.
                        left: `calc(${Math.max(0, Math.min(1, m.fraction)) * 100}% - 1.5px)`,
                        backgroundColor: PLAN_COLORS.target,
                        // Trennkante: ohne sie geht die Marke in der grünen
                        // Füllung unter — dieselbe Farbe auf derselben Fläche.
                        boxShadow: '0 0 0 1px var(--background)',
                        opacity: m.executed ? 0.35 : 1,
                      }}
                      title={`Stufe ${m.sortOrder + 1}: ${m.price.toLocaleString('de-DE', { maximumFractionDigits: 4 })}${m.executed ? ' (ausgeführt)' : ''}`}
                    />
                  ),
                )}
                {/* Kurs-Marker */}
                <div
                  className="absolute inset-y-[-3px] w-1 rounded-full bg-foreground"
                  style={{ left: `calc(${priceFrac}% - 2px)` }}
                  title="Aktueller Kurs"
                />
              </div>
              <div className="mt-1 flex justify-between gap-2 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                <span>Stop</span>
                {/* Die Stufen als Legende zum Balken. Ausgeführte durchgestrichen —
                    dasselbe Bild wie in der Plan-Leiste unter dem Chart. */}
                {marker.length > 1 && (
                  <span className="flex min-w-0 flex-wrap justify-center gap-x-2 gap-y-0.5">
                    {marker.map((m) => (
                      <span
                        key={`legende-${m.sortOrder}`}
                        className={cn('tabular', m.executed && 'line-through opacity-60')}
                        style={{ color: m.executed ? undefined : PLAN_COLORS.target }}
                      >
                        {m.isLast ? 'Ziel' : `Z${m.sortOrder + 1}`}{' '}
                        {m.price.toLocaleString('de-DE', { maximumFractionDigits: 4 })}
                      </span>
                    ))}
                  </span>
                )}
                <span>Ziel</span>
              </div>
            </div>
          )}

        </>
      )}

      {/* Die nächste Handlung. Sie steht nur da, wenn eine Stufe wirklich
          berührt ist — sonst wäre sie ein Knopf, der zum Vorziehen einlädt, und
          genau das soll ein Staffelplan verhindern.

          Bewusst AUSSERHALB der Kurs-Verzweigung: Eine Stufe, die der Wecker
          einmal berührt gesehen hat, bleibt berührt. Stand die Zeile im
          Erfolgszweig, verschwand sie bei einem Ladefehler — dann wäre
          ausgerechnet der Fall, für den der Wecker existiert, der einzige ohne
          Hinweis. */}
      {faellig && (
        <div className="relative z-20 mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-positive/30 bg-positive/10 p-2">
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-foreground">
            <Check className="size-3.5 text-positive" />
            <span className="font-bold">
              {faellig.isLast ? 'Ziel' : `Stufe ${faellig.sortOrder + 1}`} erreicht
            </span>
            <span className="text-muted-foreground">
              {faellig.price.toLocaleString('de-DE', { maximumFractionDigits: 4 })}
              {basis > 0 && !faellig.isLast &&
                ` · ${Math.min(plannedQty(basis, faellig.sharePct), offeneMenge).toLocaleString('de-DE', { maximumFractionDigits: 4 })} Stück`}
            </span>
          </span>
          {/* Einmal berührt bleibt berührt — aber wenn der Kurs inzwischen
              zurückgefallen ist, wird das dazugesagt, statt es zu verschweigen. */}
          {faellig.fellBack && (
            <span className="font-mono text-[10px] text-warning">
              berührt, Kurs steht inzwischen wieder darunter
            </span>
          )}
          <Button
            size="sm"
            variant={faellig.isLast ? 'outline' : 'default'}
            onClick={() => (faellig.isLast ? setAbschlussOffen(true) : setStufeOffen(true))}
            className="ml-auto h-8 font-mono text-[11px]"
          >
            {faellig.isLast ? 'Abschließen' : `Stufe ${faellig.sortOrder + 1} ausführen`}
          </Button>
          {/* Wegdrücken für diese Sitzung — die Stufe bleibt offen, nur der
              Hinweis geht. Bewusst KEINE Datenbankspalte: Abgetragen wird eine
              Stufe ausschließlich durch Ausführen. Nach dem Neuladen steht der
              Hinweis wieder da, denn berührt war sie ja trotzdem. */}
          <button
            type="button"
            onClick={() => setWeggedrueckt((s) => [...s, faellig.price])}
            aria-label={`Hinweis zu ${faellig.isLast ? 'Ziel' : `Stufe ${faellig.sortOrder + 1}`} ausblenden`}
            title="Für diese Sitzung ausblenden"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
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

      {/* Dieselben Dialoge wie in der Teilziele-Karte. Der Kurs ist mit dem
          geplanten vorbelegt und bleibt korrigierbar — der tatsächliche Fill
          zählt, nicht der Plan. */}
      {faellig && !faellig.isLast && faellig.id != null && (
        <ExecuteTargetDialog
          trade={t}
          target={faellig}
          basis={basis}
          openQty={offeneMenge}
          open={stufeOffen}
          onOpenChange={setStufeOffen}
          onDone={() => router.refresh()}
        />
      )}

      {/* Die letzte Stufe schließt die Position und läuft deshalb über den
          Abschluss: Dort greifen Verlust-Annahme, Plan-Treue und Check-in. */}
      {faellig?.isLast && (
        <CloseDialog
          trade={t}
          open={abschlussOffen}
          onOpenChange={setAbschlussOffen}
          onDone={() => router.refresh()}
          prefillExit={faellig.price}
          targetId={faellig.id}
        />
      )}
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
