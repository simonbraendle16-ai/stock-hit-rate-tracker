// Bot-Zwilling (Etappe 5) — der Auswertungsblock auf /tracking.
//
// Reine Anzeige: gerechnet wird in `lib/bot-twin.ts` (rein, getestet), geladen in
// `app/actions/bot-twin.ts`. Hier steht nur, was gezeigt wird.
//
// Ergebnisvergleich ohne persönliche Fehlerdiagnose.

import {
  BUCKET_LABELS,
  BUCKET_EPS,
  SKIP_LABELS,
  intervalLabel,
  type BotTwinGap,
  type BotTwinStats,
} from '@/lib/bot-twin'
import { BotOutcomeDialog } from '@/components/bot-outcome-dialog'
import { BotTwinCurve } from '@/components/bot-twin-curve'
import { ChartEmpty } from '@/components/chart-frame'
import { Bot } from 'lucide-react'
import { cn } from '@/lib/utils'

const num = (v: number, digits = 1) =>
  v.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** R-Wert mit erzwungenem Vorzeichen — das Vorzeichen ist hier die Aussage. */
const rValue = (v: number, digits = 1) => `${v >= 0 ? '+' : '−'}${num(Math.abs(v), digits)} R`

/** Numerische Toleranz für die Ergebnisanzeige. */
const NOTEWORTHY = BUCKET_EPS

export function BotTwinPanel({ stats }: { stats: BotTwinStats }) {
  const { compared, closed, differenceR } = stats
  const hasComparison = compared > 0

  return (
    <div className="panel sheen p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-primary" />
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Vereinfachtes Vergleichsszenario
          </p>
        </div>
        <p className="font-mono text-[10px] text-muted-foreground">
          {hasComparison
            ? `${compared} von ${closed} abgeschlossenen Trades verglichen`
            : `${closed} abgeschlossene Trades`}
        </p>
      </div>

      {hasComparison ? (
        <div className="mt-4 space-y-5">
          <Statement compared={compared} differenceR={differenceR} />
          <Ledger stats={stats} />
          <div>
            <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-primary/70">
              Szenario und tatsächliches Ergebnis
            </p>
            <BotTwinCurve points={stats.points} />
          </div>
          <Breakdown stats={stats} />
        </div>
      ) : (
        <Empty stats={stats} />
      )}

      <Gaps gaps={stats.gaps} />
      <Manual stats={stats} />
      <Missed stats={stats} />
      <Limits stats={stats} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Leerzustand
// ---------------------------------------------------------------------------

function Empty({ stats }: { stats: BotTwinStats }) {
  const nothingClosed = stats.closed === 0

  return (
    <div className="mt-3">
      <ChartEmpty
        icon={Bot}
        className="h-[220px]"
        title={nothingClosed ? 'Noch kein abgeschlossener Trade' : 'Noch kein Vergleich möglich'}
        hint={
          nothingClosed
            ? 'Nach dem ersten abgeschlossenen Trade wird ein Szenario mit festem Stop und Ziel berechnet.'
            : 'Deine abgeschlossenen Trades lassen sich noch nicht nachrechnen. Die Gründe stehen unten; du kannst dort auch von Hand nachtragen.'
        }
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Die eine Aussage
// ---------------------------------------------------------------------------

function Statement({ compared, differenceR }: { compared: number; differenceR: number }) {
  const bucket = Math.abs(differenceR) < NOTEWORTHY
    ? 'annaehernd_gleich'
    : differenceR > 0 ? 'ueber_szenario' : 'unter_szenario'
  return (
    <div className="panel-sunken rise-in p-4">
      <p className="font-heading text-lg leading-snug text-foreground sm:text-xl">
        {BUCKET_LABELS[bucket]} · {compared} {compared === 1 ? 'Trade' : 'Trades'}: <strong>{rValue(differenceR, 2)}</strong>
      </p>
      <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
        Die Differenz beschreibt Ergebnisse. Sie belegt weder eine Regelabweichung noch
        Planbefolgung oder einen emotionalen Auslöser. Für eine Bewertung braucht es den damaligen
        Plan und die tatsächliche Handlung.
      </p>
    </div>
  )
}

function Ledger({ stats }: { stats: BotTwinStats }) {
  return (
    <div className="rise-in-1 font-mono text-sm">
      <Line label="Szenario (fester Stop und Ziel)" value={rValue(stats.botTotalR, 2)} />
      <Line label="Tatsächliches Ergebnis" value={rValue(stats.realTotalR, 2)} />
      <div className="my-1 border-t border-border" />
      <Line label="Tatsächlich minus Szenario" value={rValue(stats.differenceR, 2)} className="font-bold" />
    </div>
  )
}

function Line({
  label,
  value,
  className,
  hint,
}: {
  label: string
  value: string
  className?: string
  hint?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-2">
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
        <span className={cn('tabular-nums', className)}>{value}</span>
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Aufschlüsselung
// ---------------------------------------------------------------------------

function Breakdown({ stats }: { stats: BotTwinStats }) {
  if (stats.buckets.length === 0) return null
  const max = Math.max(...stats.buckets.map((b) => Math.abs(b.r)), 0.0001)

  return (
    <div>
      <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-primary/70">
        Ergebnisgruppen
      </p>
      <div className="space-y-2">
        {stats.buckets.map((b) => {
          return (
            <div key={b.bucket}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-xs text-foreground">
                  {BUCKET_LABELS[b.bucket]}
                  <span className="ml-2 text-[10px] text-muted-foreground">
                    {b.trades} {b.trades === 1 ? 'Trade' : 'Trades'}
                  </span>
                </span>
                <span
                  className="font-mono text-xs tabular-nums text-muted-foreground"
                >
                  {rValue(b.r)}
                </span>
              </div>
              <div className="bar-track mt-1 h-1.5">
                <div
                  className="bar-fill h-full rounded-full bg-muted-foreground/40"
                  style={{ width: `${(Math.abs(b.r) / max) * 100}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
        Die Gruppen beschreiben ausschließlich die Ergebnisdifferenz; ihre Summen ergeben die
        Gesamtdifferenz. Gleiche Ergebnisse beweisen keine gleiche Handlung. Die Anzeige ist gerundet.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Lücken — sichtbar, mit der Möglichkeit, sie selbst zu schließen
// ---------------------------------------------------------------------------

function Gaps({ gaps }: { gaps: BotTwinGap[] }) {
  if (gaps.length === 0) return null

  return (
    <div className="mt-5 border-t border-border pt-4">
      <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-widest text-warning/80">
        Nicht simulierbar · {gaps.length}
      </p>
      <p className="mb-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
        Diese Trades stehen in keiner Summe oben. Wo Kursdaten fehlen, kannst du selbst nachtragen,
        welchen Ausgang das Szenario gehabt hätte — der Eintrag zählt dann mit und bleibt als Nachtrag
        gekennzeichnet. Sobald doch Kerzen vorliegen, gilt wieder das kursbasierte Szenario.
      </p>
      <ul className="space-y-1.5">
        {gaps.map((g) => (
          <li
            key={g.tradeId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/20 px-2.5 py-1.5"
          >
            <span className="font-mono text-xs text-foreground">
              {g.ticker}
              <span className="ml-2 text-[10px] text-muted-foreground">{g.label}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">
                {SKIP_LABELS[g.reason]}
              </span>
              <BotOutcomeDialog
                tradeId={g.tradeId}
                ticker={g.ticker}
                hasTarget={g.hasTarget}
                existing={g.manual}
              />
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Nachgetragene Ergebnisse — bleiben sichtbar und änderbar
// ---------------------------------------------------------------------------

/**
 * Ein Nachtrag zählt in die Auswertung und verschwindet damit aus der
 * Lückenliste. Ohne diesen Block wäre er danach weder zu erkennen noch zu
 * korrigieren — eine Handeingabe, die man nicht mehr zurücknehmen kann, wäre
 * schlimmer als gar keine.
 */
function Manual({ stats }: { stats: BotTwinStats }) {
  const rows = [
    ...stats.rows.filter((r) => r.source === 'nachgetragen'),
    ...stats.missed.rows.filter((r) => r.source === 'nachgetragen'),
  ]
  if (rows.length === 0) return null

  return (
    <div className="mt-5 border-t border-border pt-4">
      <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-widest text-warning/80">
        Von Hand nachgetragen · {rows.length}
      </p>
      <p className="mb-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
        Diese Ergebnisse zählen oben mit, stammen aber aus deiner Eingabe und nicht aus Kursdaten.
        Sie bleiben hier änderbar — und sobald für einen dieser Trades doch Kerzen vorliegen, gilt
        wieder das kursbasierte Szenario und der Nachtrag tritt zurück.
      </p>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li
            key={r.tradeId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-warning/5 px-2.5 py-1.5"
          >
            <span className="font-mono text-xs text-foreground">
              {r.ticker}
              <span className="ml-2 text-[10px] text-muted-foreground">{r.label}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">
                {r.outcome === 'ziel' ? 'Ziel' : r.outcome === 'stop' ? 'Stop' : 'weder noch'}
              </span>
              <span
                className={cn(
                  'font-mono text-[11px] tabular-nums',
                  r.botR >= 0 ? 'text-positive' : 'text-destructive',
                )}
              >
                {rValue(r.botR)}
              </span>
              <BotOutcomeDialog
                tradeId={r.tradeId}
                ticker={r.ticker}
                hasTarget={r.hasTarget}
                existing={r.manual}
              />
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Nicht eingegangene Trades — streng getrennt von der Hauptdifferenz
// ---------------------------------------------------------------------------

function Missed({ stats }: { stats: BotTwinStats }) {
  const { missed } = stats
  if (missed.evaluated === 0 && missed.gaps.length === 0) return null

  const gain = missed.totalR > NOTEWORTHY
  const loss = missed.totalR < -NOTEWORTHY

  return (
    <div className="mt-5 border-t border-border pt-4">
      <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-widest text-primary/70">
        Nicht eingegangen · getrennt gerechnet
      </p>

      {missed.evaluated > 0 ? (
        <>
          <p className="font-mono text-xs leading-relaxed text-foreground">
            {missed.evaluated === 1
              ? 'Ein geplanter Trade, den du nicht eingegangen bist, hätte im vereinfachten Szenario '
              : `${missed.evaluated} geplante Trades, die du nicht eingegangen bist, hätten im vereinfachten Szenario `}
            <span
              className={cn(
                'font-bold tabular-nums',
                gain ? 'text-positive' : loss ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {rValue(missed.totalR)}
            </span>{' '}
            ergeben.
          </p>
          <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
            Diese hypothetischen Ergebnisse stehen getrennt vom Vergleich abgeschlossener Trades.
            Ob ein Einstieg damals vorgesehen, möglich oder regelkonform war, lässt sich daraus
            nicht ableiten. Auch der Grund für den unterlassenen Einstieg bleibt offen.
          </p>

          <ul className="mt-2 space-y-1">
            {missed.rows.map((r) => (
              <li key={r.tradeId} className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {r.ticker}
                  <span className="ml-2 text-[10px]">{r.label}</span>
                  {r.source === 'nachgetragen' && (
                    <span className="ml-2 text-[10px] text-warning/80">nachgetragen</span>
                  )}
                </span>
                <span
                  className={cn(
                    'font-mono text-[11px] tabular-nums',
                    r.botR >= 0 ? 'text-positive' : 'text-destructive',
                  )}
                >
                  {rValue(r.botR)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="font-mono text-xs leading-relaxed text-muted-foreground">
          Für die nicht eingegangenen Trades liegen keine auswertbaren Kursdaten vor.
        </p>
      )}

      {missed.neverTriggered > 0 && (
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
          Bei {missed.neverTriggered}{' '}
          {missed.neverTriggered === 1 ? 'Plan' : 'Plänen'} wurde der Einstieg nie erreicht — dort
          wird kein ausgelöster Einstieg simuliert.
        </p>
      )}

      {missed.gaps.filter((g) => g.reason !== 'nicht_ausgeloest').length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {missed.gaps
            .filter((g) => g.reason !== 'nicht_ausgeloest')
            .map((g) => (
              <li
                key={g.tradeId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/20 px-2.5 py-1.5"
              >
                <span className="font-mono text-xs text-foreground">
                  {g.ticker}
                  <span className="ml-2 text-[10px] text-muted-foreground">{g.label}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {SKIP_LABELS[g.reason]}
                  </span>
                  <BotOutcomeDialog
                    tradeId={g.tradeId}
                    ticker={g.ticker}
                    hasTarget={g.hasTarget}
                    existing={g.manual}
                  />
                </span>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ehrlichkeitsgrenzen — ein Vergleich, der seine Grenzen verschweigt, ist manipulativ
// ---------------------------------------------------------------------------

function Limits({ stats }: { stats: BotTwinStats }) {
  const { resolutions, ambiguousCount, manualCount, compared } = stats
  const daily = resolutions.includes('1day')

  return (
    <div className="mt-5 space-y-1.5 border-t border-border pt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
      <p>
        <strong className="text-foreground">Vereinfachtes Szenario:</strong> gerechnet wird mit
        einem festen Stop und Ziel aus den aktuell gespeicherten Werten. Diese können nachträglich
        geändert worden sein und sind kein gesicherter ursprünglicher Plan. Teilverkäufe und
        erlaubtes Trailing werden nicht simuliert. Eine Bewertung der Planbefolgung ist damit
        nicht möglich.
      </p>
      <p>
        <strong className="text-foreground">Slippage und Spread</strong> sind nicht abgebildet — das
        Szenario verwendet den exakten Stop- oder Zielkurs.
        Gerechnet wird mit denselben eingefrorenen Gebühren wie beim echten Trade.
      </p>
      <p>
        <strong className="text-foreground">Kerzen-Auflösung:</strong>{' '}
        {resolutions.length > 0
          ? `verwendet werden ${resolutions.map(intervalLabel).join(' und ')} (je nach Haltedauer).`
          : 'noch keine Kursdaten verwendet.'}{' '}
        Innerhalb einer Kerze ist die Reihenfolge unbekannt.{' '}
        {ambiguousCount > 0 ? (
          <>
            Bei <strong className="text-foreground">{ambiguousCount}</strong> von {compared} Trades
            lagen Stop und Ziel in derselben Kerze — als Szenarioannahme wurde der Stop zuerst gewertet. Die tatsächliche Reihenfolge bleibt unbekannt.
          </>
        ) : (
          'Bei keinem Trade lagen Stop und Ziel in derselben Kerze.'
        )}
        {daily && ' Bei Tageskerzen betrifft diese Unschärfe den ganzen Handelstag.'}
      </p>
      <p>
        <strong className="text-foreground">Nur Trades mit Ziel</strong> lassen sich simulieren —
        ohne Ziel gibt es keinen mechanischen Ausstieg. Das Szenario kann über den tatsächlichen
        Ausstieg hinauslaufen, bis Stop oder Ziel berührt sind.
      </p>
      <p>
        <strong className="text-foreground">Begrenzte Historie:</strong> das Gratis-Tier liefert nur
        eine begrenzte Zahl Kerzen, und bei zu vielen Abrufen greift das Minutenlimit. Fehlende
        Reihen werden bei späteren Aufrufen erneut angefragt; ihre Verfügbarkeit ist nicht garantiert.
        {manualCount > 0 && (
          <>
            {' '}
            <strong className="text-foreground">{manualCount}</strong> der verglichenen Ergebnisse{' '}
            {manualCount === 1 ? 'ist' : 'sind'} von Hand nachgetragen und damit keine Messung.
          </>
        )}
      </p>
    </div>
  )
}
