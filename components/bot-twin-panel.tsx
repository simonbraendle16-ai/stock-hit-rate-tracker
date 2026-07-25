// Bot-Zwilling (Etappe 5) — der Auswertungsblock auf /tracking.
//
// Reine Anzeige: gerechnet wird in `lib/bot-twin.ts` (rein, getestet), geladen in
// `app/actions/bot-twin.ts`. Hier steht nur, was gezeigt wird.
//
// Der Ton ist bewusst eine Messung, kein Urteil. Die Differenz kann in beide
// Richtungen zeigen: kostet dein Eingreifen, ist das ein Befund über dein
// Verhalten — bringt es etwas, ist es ein Befund über deinen Plan. Beides steht
// hier gleichwertig, und beides ohne moralischen Zeigefinger.
//
// Was der Block NICHT tut: eine Prognose abgeben. Er rechnet ausschließlich über
// Kurse, die bereits gelaufen sind.

import {
  BUCKET_LABELS,
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

/** Ab hier gilt eine Differenz als echte Abweichung und nicht als Rauschen. */
const NOTEWORTHY = 0.05

export function BotTwinPanel({ stats }: { stats: BotTwinStats }) {
  const { compared, closed, differenceR } = stats
  const hasComparison = compared > 0

  return (
    <div className="panel sheen p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-primary" />
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Bot-Zwilling
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
              Plan gegen Wirklichkeit
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
            ? 'Sobald du den ersten Trade abschließt, rechnet der Bot denselben Plan mechanisch nach — und zeigt die Differenz.'
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
  const cost = differenceR < -NOTEWORTHY
  const better = differenceR > NOTEWORTHY

  return (
    <div className="panel-sunken rise-in p-4">
      <p className="font-heading text-lg leading-snug text-foreground sm:text-xl">
        {cost && (
          <>
            Dein Eingreifen hat dich über {compared} Trades{' '}
            <span className="font-bold text-destructive">{num(Math.abs(differenceR), 1)} R</span>{' '}
            gekostet.
          </>
        )}
        {better && (
          <>
            Du warst über {compared} Trades{' '}
            <span className="font-bold text-positive">{num(differenceR, 1)} R</span> besser als dein
            eigener Plan.
          </>
        )}
        {!cost && !better && (
          <>
            Über {compared} Trades hast du{' '}
            <span className="font-bold text-primary">deinen Plan gehandelt</span>.
          </>
        )}
      </p>
      <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
        {cost && (
          <>
            So viel liegt zwischen dem, was der Plan mechanisch ergeben hätte, und dem, was du
            daraus gemacht hast. Das ist kein Urteil über dich, sondern eine Messung: die Zahl
            sagt, was Zögern, vorzeitiges Aussteigen und verschobene Stops zusammen kosten.
          </>
        )}
        {better && (
          <>
            Das ist ein Befund über deinen <strong className="text-foreground">Plan</strong>, nicht
            über deine Disziplin: deine Ausstiege waren besser als die geplanten. Bevor du daraus
            eine Erlaubnis zum Improvisieren machst — prüfe erst, ob sich das über mehr Trades
            hält, und schreibe dann den besseren Ausstieg in den Plan.
          </>
        )}
        {!cost && !better && (
          <>
            Zwischen mechanischer Ausführung und deiner tatsächlichen liegt praktisch nichts. Genau
            das ist das Ziel: das Ergebnis entsteht aus dem Plan, nicht aus der Tagesform.
          </>
        )}
      </p>
    </div>
  )
}

/** Die drei Zahlen, um die es geht — bewusst als Abrechnung gesetzt. */
function Ledger({ stats }: { stats: BotTwinStats }) {
  const { botTotalR, realTotalR, differenceR } = stats
  const tone =
    differenceR < -NOTEWORTHY
      ? 'text-destructive'
      : differenceR > NOTEWORTHY
        ? 'text-positive'
        : 'text-muted-foreground'

  // Zwei Nachkommastellen, weil hier eine Subtraktion sichtbar dasteht: mit nur
  // einer Stelle ergäbe −1,0 und +2,0 optisch +3,0, während die echte Differenz
  // +3,1 wäre. Eine Abrechnung, die nicht aufgeht, kostet mehr Vertrauen als
  // eine Stelle mehr.
  return (
    <div className="rise-in-1 font-mono text-sm">
      <Line label="Bot (Plan mechanisch)" value={rValue(botTotalR, 2)} />
      <Line label="Du (tatsächlich)" value={rValue(realTotalR, 2)} />
      <div className="my-1 border-t border-border" />
      <Line
        label="Differenz"
        value={rValue(differenceR, 2)}
        className={cn('font-bold', tone)}
        hint={
          differenceR < -NOTEWORTHY
            ? 'der Preis deiner Eingriffe'
            : differenceR > NOTEWORTHY
              ? 'dein Vorsprung auf den Plan'
              : 'plan-konform'
        }
      />
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
        Wo die Differenz entsteht
      </p>
      <div className="space-y-2">
        {stats.buckets.map((b) => {
          const positive = b.r > NOTEWORTHY
          const negative = b.r < -NOTEWORTHY
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
                  className={cn(
                    'font-mono text-xs tabular-nums',
                    negative ? 'text-destructive' : positive ? 'text-positive' : 'text-muted-foreground',
                  )}
                >
                  {rValue(b.r)}
                </span>
              </div>
              <div className="bar-track mt-1 h-1.5">
                <div
                  className={cn(
                    'bar-fill h-full rounded-full',
                    negative ? 'bg-destructive' : positive ? 'bg-positive' : 'bg-muted-foreground/40',
                  )}
                  style={{ width: `${(Math.abs(b.r) / max) * 100}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
        Jeder Trade liegt in genau einem Feld; die Felder summieren sich auf die Differenz (die
        Anzeige ist auf eine Nachkommastelle gerundet). Ein dokumentierter Regelbruch (Stop
        verschoben) erklärt die Abweichung dabei vorrangig — er ist belegt, alles andere wäre eine
        Vermutung über den Ausstiegszeitpunkt.
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
        was aus dem Handel geworden wäre — der Eintrag zählt dann mit und bleibt als Nachtrag
        gekennzeichnet. Sobald doch Kerzen vorliegen, gilt wieder die Messung.
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
        wieder die Messung und der Nachtrag tritt zurück.
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
              ? 'Ein geplanter Trade, den du nicht eingegangen bist, hätte nach Plan '
              : `${missed.evaluated} geplante Trades, die du nicht eingegangen bist, hätten nach Plan `}
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
            Diese Zahl steht bewusst <strong className="text-foreground">außerhalb</strong> der
            Differenz oben: nicht eingegangen zu sein ist eine andere Fehlerart als falsch
            auszusteigen, und beides zu vermischen würde beide Aussagen unbrauchbar machen.
            {gain && ' Ein Plus hier heißt nicht, dass du jeden Plan hättest handeln müssen — es heißt, dass dein Zögern messbar ist.'}
            {loss && ' Ein Minus hier heißt: das Aussitzen hat dich vor Verlusten bewahrt. Auch das ist ein Befund.'}
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
          gab es nichts zu verpassen.
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
        <strong className="text-foreground">Slippage und Spread</strong> sind nicht abgebildet — der
        Bot steigt exakt am Stop und exakt am Ziel aus und ist dadurch leicht zu optimistisch.
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
            lagen Stop und Ziel in derselben Kerze — dort wurde konservativ der Stop gewertet, der
            Bot ist dadurch eher zu schlecht als zu gut.
          </>
        ) : (
          'Bei keinem Trade lagen Stop und Ziel in derselben Kerze.'
        )}
        {daily && ' Bei Tageskerzen betrifft diese Unschärfe den ganzen Handelstag.'}
      </p>
      <p>
        <strong className="text-foreground">Nur Trades mit Ziel</strong> lassen sich simulieren —
        ohne Ziel gibt es keinen mechanischen Ausstieg. Der Bot hält bewusst über deinen echten
        Ausstieg hinaus, bis Stop oder Ziel berührt sind; ohne das wäre ein vorzeitiger Ausstieg
        gar nicht messbar.
      </p>
      <p>
        <strong className="text-foreground">Begrenzte Historie:</strong> das Gratis-Tier liefert nur
        eine begrenzte Zahl Kerzen, und bei zu vielen Abrufen greift das Minutenlimit. Fehlende
        Reihen kommen beim nächsten Aufruf nach — die Auswertung füllt sich von selbst auf.
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
