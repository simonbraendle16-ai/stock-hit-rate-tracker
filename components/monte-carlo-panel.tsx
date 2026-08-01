// Wahrscheinlichkeits-Simulation (Etappe 7a) — der Auswertungsblock auf /tracking.
//
// Reine Anzeige: gerechnet wird in `lib/monte-carlo.ts` (rein, seed-fest,
// getestet). Hier steht nur die Entscheidung, was gezeigt wird — und der Kern
// dieses Blocks ist eine Douglas-Aussage, keine Prognose: Er sagt NICHT, wie der
// nächste Trade läuft. Er sagt, welche Verläufe zu den eigenen Zahlen gehören,
// damit eine Verlustserie nicht als Beweis missverstanden wird, dass „das System
// kaputt" ist. Unter der Mindestzahl an Trades erscheint deshalb bewusst keine
// einzige Wahrscheinlichkeit.

import type { MonteCarloStats } from '@/lib/monte-carlo'
import { Dices } from 'lucide-react'
import { cn } from '@/lib/utils'

const num = (v: number, digits = 1) =>
  v.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** Kleine Wahrscheinlichkeiten brauchen eine Nachkommastelle, große nicht. */
const pct = (v: number) => `${num(v, v >= 10 ? 0 : 1)} %`

const rValue = (v: number, digits = 1) =>
  `${v >= 0 ? '+' : '−'}${num(Math.abs(v), digits)} R`

export function MonteCarloPanel({ stats }: { stats: MonteCarloStats }) {
  const { source, minTrades, horizon, runs } = stats

  return (
    <div className="panel sheen p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Dices className="size-4 text-primary" />
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Wahrscheinlichkeits-Simulation
          </p>
        </div>
        <p className="font-mono text-[10px] text-muted-foreground">
          {stats.enough
            ? `${runs.toLocaleString('de-DE')} Verläufe × ${horizon} Trades · aus deinen ${source.trades} abgerechneten Trades`
            : `${source.trades} von ${minTrades} abgerechneten Trades`}
        </p>
      </div>

      {stats.enough ? <Simulation stats={stats} /> : <NotYet stats={stats} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Leerzustand — zählt ehrlich mit, statt zu vertrösten
// ---------------------------------------------------------------------------

function NotYet({ stats }: { stats: MonteCarloStats }) {
  const { source, minTrades, horizon } = stats
  const share = Math.min(1, source.trades / minTrades)
  const fehlend = Math.max(0, minTrades - source.trades)

  return (
    <div className="mt-3">
      <p className="font-mono text-xs leading-relaxed text-muted-foreground">
        Noch zu wenige abgeschlossene Trades für eine Simulation
        {fehlend > 0 && (
          <>
            {' '}
            — es fehlen <strong className="text-foreground">{fehlend}</strong>
          </>
        )}
        . Aus weniger als {minTrades} Ergebnissen ließe sich zwar rechnen, aber die Verteilung
        wäre Rauschen: eine Zahl, die nach Befund aussieht und keiner ist.
      </p>

      <div className="bar-track mt-3 h-2">
        <div
          className="bar-fill h-full rounded-full bg-primary"
          style={{ width: `${share * 100}%` }}
        />
      </div>

      <p className="mt-3 border-t border-border pt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
        Sobald {minTrades} Trades entschieden und abgerechnet sind, werden hier deine eigenen
        Ergebnisse {stats.runs.toLocaleString('de-DE')} Mal über die nächsten {horizon} Trades neu
        gezogen. Dann steht hier, welche Verlustserien zu deinen Zahlen dazugehören, wie breit
        das Ergebnis streuen kann und wie tief ein Rückgang zwischendurch üblicherweise geht.
        Bis dahin bleibt der Block leer — das ist die ehrlichere Antwort.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ergebnis
// ---------------------------------------------------------------------------

function Simulation({ stats }: { stats: MonteCarloStats }) {
  const { outcome, drawdown, drawdownPct, horizon, source } = stats

  return (
    <div className="mt-4 space-y-5">
      <StreakStatement stats={stats} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Tile
          label={`Endstand nach ${horizon} Trades`}
          value={`${rValue(outcome.median, 1)}`}
          tone={outcome.median >= 0 ? 'positive' : 'destructive'}
          hint={`Median. 90 % der Verläufe liegen zwischen ${rValue(outcome.p05)} und ${rValue(outcome.p95)}.`}
          delay="rise-in-1"
        />
        <Tile
          label="im Plus nach dem Horizont"
          value={pct(outcome.probProfit)}
          tone={outcome.probProfit >= 50 ? 'positive' : 'warning'}
          hint={`Anteil der Verläufe, die über 0 R enden. Dein Erwartungswert je Trade: ${rValue(source.expectancy, 2)}.`}
          delay="rise-in-2"
        />
        {drawdownPct ? (
          <Tile
            label={`Rückgang über ${num(drawdownPct.thresholdPct, 0)} %`}
            value={pct(drawdownPct.probabilityOverThreshold)}
            // Ein seltener tiefer Rückgang ist keine Warnung — erst ab einem
            // spürbaren Anteil der Verläufe wird die Kachel laut.
            tone={
              drawdownPct.probabilityOverThreshold >= 20
                ? 'destructive'
                : drawdownPct.probabilityOverThreshold >= 5
                  ? 'warning'
                  : 'neutral'
            }
            hint={`Wahrscheinlichkeit, dass das Konto zwischendurch um mehr als ${num(drawdownPct.thresholdPct, 0)} % vom Hoch fällt — bei ${num(drawdownPct.riskPerTradePct, 1)} % Risiko je Trade.`}
            delay="rise-in-3"
          />
        ) : (
          <Tile
            label="Typischer Rückgang"
            value={`${num(drawdown.median, 1)} R`}
            tone="warning"
            hint={`Median des größten Rückgangs vom Hoch. In 5 % der Verläufe sind es über ${num(drawdown.p95, 1)} R. Ohne Echtgeld-Trades mit Stop lässt sich das nicht in Prozent des Kontos umrechnen.`}
            delay="rise-in-3"
          />
        )}
      </div>

      <OutcomeFan stats={stats} />
      <StreakTable stats={stats} />

      <p className="border-t border-border pt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
        Die Simulation zieht deine {source.trades} abgerechneten Trades zufällig neu (mit
        Zurücklegen) und spielt so {stats.runs.toLocaleString('de-DE')} mögliche Fortsetzungen
        durch. Sie sagt <strong className="text-foreground">nichts</strong> über den nächsten
        Trade — sie zeigt nur, welche Verläufe zu deiner bisherigen Verteilung gehören. Das
        unterstellt, dass deine nächsten Trades aus derselben Verteilung stammen und
        voneinander unabhängig sind. Ändert sich Markt, Setup oder Disziplin, gilt die Rechnung
        nicht mehr. Gerechnet wird mit gleichbleibendem Risiko je Trade, ohne Zinseszins
        {source.trades < 50 && (
          <> — und {source.trades} Trades sind eine schmale Grundlage, die Zahlen werden mit
          jedem weiteren Trade belastbarer</>
        )}
        .
      </p>
    </div>
  )
}

/** Die eine Aussage, wegen der der Block existiert. */
function StreakStatement({ stats }: { stats: MonteCarloStats }) {
  const { lossStreak, horizon } = stats
  const p = lossStreak.observedProbability

  // Ohne erlebte Serie: die Serie, die im Median jedes Verlaufs vorkommt.
  if (lossStreak.observed <= 0 || p == null) {
    return (
      <div className="panel-sunken rise-in p-4">
        <p className="font-heading text-lg leading-snug text-foreground sm:text-xl">
          Eine Verlustserie von{' '}
          <span className="font-bold text-warning">{lossStreak.typical} Trades</span> in Folge ist
          bei deinen Zahlen der Normalfall.
        </p>
        <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          In mindestens der Hälfte aller simulierten {horizon}-Trade-Verläufe kommt eine solche
          Serie vor. Du hast bisher keine Verlustserie erlebt — wenn die erste kommt, ist sie
          kein Beweis, dass dein System kaputt ist.
        </p>
      </div>
    )
  }

  const normal = p >= 20
  const selten = p < 5

  return (
    <div className="panel-sunken rise-in p-4">
      <p className="font-heading text-lg leading-snug text-foreground sm:text-xl">
        Eine Verlustserie von{' '}
        <span className="font-bold text-warning">{lossStreak.observed} Trades</span> — deine
        längste bisher — kommt in{' '}
        <span className={cn('font-bold', normal ? 'text-positive' : 'text-warning')}>{pct(p)}</span>{' '}
        der simulierten Verläufe vor.
      </p>
      <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
        {normal && (
          <>
            Sie gehört damit zu deiner Verteilung — kein Beweis, dass etwas kaputt ist, sondern
            der erwartbare Preis dafür, dass du deinen Vorteil über viele Trades ziehst.
          </>
        )}
        {!normal && !selten && (
          <>
            Sie ist damit ungewöhnlich, aber nicht außergewöhnlich. Ein Grund, den Plan zu
            prüfen — keiner, ihn mitten in der Serie umzuwerfen.
          </>
        )}
        {selten && (
          <>
            Das ist selten genug, um genauer hinzusehen: Entweder war es Pech, oder deine
            letzten Trades stammen nicht mehr aus derselben Verteilung wie deine früheren
            (anderes Setup, anderer Markt, andere Ausführung).
          </>
        )}{' '}
        Im Median jedes Verlaufs steckt eine Serie von {lossStreak.typical} Verlusten.
      </p>
    </div>
  )
}

/** Bandbreite des Endstands: 90 %- und 50 %-Intervall auf einer Achse. */
function OutcomeFan({ stats }: { stats: MonteCarloStats }) {
  const { outcome, horizon } = stats
  const lo = Math.min(outcome.p05, 0)
  const hi = Math.max(outcome.p95, 0)
  const span = hi - lo || 1
  const at = (v: number) => ((v - lo) / span) * 100

  const p05 = at(outcome.p05)
  const p25 = at(outcome.p25)
  const median = at(outcome.median)
  const p75 = at(outcome.p75)
  const p95 = at(outcome.p95)
  const zero = at(0)

  return (
    <div>
      <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-primary/70">
        Bandbreite nach {horizon} Trades
      </p>

      <div className="relative h-9">
        {/* 90 %-Intervall */}
        <div
          className="bar-fill absolute top-3 h-3 rounded-full bg-primary/30"
          style={{ left: `${p05}%`, width: `${Math.max(0.5, p95 - p05)}%` }}
        />
        {/* 50 %-Intervall — die Hälfte aller Verläufe liegt hier */}
        <div
          className="bar-fill absolute top-3 h-3 rounded-full bg-primary/70"
          style={{ left: `${p25}%`, width: `${Math.max(0.5, p75 - p25)}%` }}
        />
        {/* Nulllinie: Gewinn beginnt rechts davon */}
        <div
          className="absolute bottom-0 top-2 w-px bg-muted-foreground"
          style={{ left: `${zero}%` }}
        />
        <span
          className="absolute top-0 -translate-x-1/2 font-mono text-[9px] text-muted-foreground"
          style={{ left: `${zero}%` }}
        >
          0
        </span>
        {/* Median */}
        <div
          className="absolute top-2 h-5 w-0.5 rounded-full bg-foreground"
          style={{ left: `${median}%` }}
        />
      </div>

      <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
        <span className={outcome.p05 >= 0 ? 'text-positive' : 'text-destructive'}>
          {rValue(outcome.p05)}
        </span>
        <span>
          Median <span className="text-foreground">{rValue(outcome.median)}</span>
        </span>
        <span className={outcome.p95 >= 0 ? 'text-positive' : 'text-destructive'}>
          {rValue(outcome.p95)}
        </span>
      </div>
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
        Heller Balken: 90 % aller Verläufe. Kräftiger Balken: die mittleren 50 %. Senkrechter
        Strich: der Median. Die dünne Linie markiert 0 R — links davon steht ein Minus.
      </p>
    </div>
  )
}

function StreakTable({ stats }: { stats: MonteCarloStats }) {
  const { lossStreak, horizon } = stats
  if (lossStreak.odds.length === 0) {
    return (
      <p className="font-mono text-xs text-muted-foreground">
        In deiner Verteilung steckt kein einziger Verlust — es gibt daher keine Verlustserie zu
        simulieren.
      </p>
    )
  }

  return (
    <div>
      <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-primary/70">
        Verlustserien in {horizon} Trades
      </p>
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full min-w-[22rem] border-collapse font-mono text-xs">
          <thead>
            <tr className="text-[9px] uppercase tracking-widest text-muted-foreground">
              <th className="pb-1 text-left font-normal">Serie</th>
              <th className="pb-1 text-right font-normal">Wahrscheinlichkeit</th>
              <th className="w-1/2 pb-1" />
            </tr>
          </thead>
          <tbody>
            {lossStreak.odds.map((o) => {
              const mine = o.length === lossStreak.observed
              return (
                <tr key={o.length} className="border-t border-border/60">
                  <td className={cn('py-1.5 pr-2', mine ? 'text-warning' : 'text-muted-foreground')}>
                    {o.length} in Folge
                    {mine && <span className="ml-2 text-[9px] uppercase">deine längste</span>}
                  </td>
                  <td className={cn('py-1.5 text-right', mine ? 'font-bold text-warning' : 'text-foreground')}>
                    {pct(o.probability)}
                  </td>
                  <td className="py-1.5 pl-3">
                    <div className="bar-track h-1.5">
                      <div
                        className={cn('h-full rounded-full', mine ? 'bg-warning' : 'bg-primary/70')}
                        style={{ width: `${Math.min(100, o.probability)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
        Gelesen als „mindestens": Die Zeile „5 in Folge" enthält auch alle Verläufe mit sechs
        oder mehr Verlusten hintereinander. Gezählt werden entschiedene Trades mit negativem
        Ergebnis; Breakeven unterbricht eine Serie.
      </p>
    </div>
  )
}

function Tile({
  label,
  value,
  hint,
  tone,
  delay,
}: {
  label: string
  value: string
  hint: string
  tone: 'positive' | 'warning' | 'destructive' | 'neutral'
  delay: string
}) {
  const toneText: Record<typeof tone, string> = {
    positive: 'text-positive',
    warning: 'text-warning',
    destructive: 'text-destructive',
    neutral: 'text-foreground',
  }

  return (
    <div className={cn('panel-sunken rise-in p-3', delay)}>
      <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className={cn('mt-1 font-heading text-2xl font-bold', toneText[tone])}>{value}</p>
      <p className="mt-1 font-mono text-[10px] leading-relaxed text-muted-foreground">{hint}</p>
    </div>
  )
}
