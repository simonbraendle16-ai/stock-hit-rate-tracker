// MAE / MFE (Etappe 7c) — der Auswertungsblock auf /tracking.
//
// Reine Anzeige: gemessen wird in `lib/excursion.ts`, geladen im selben
// Kerzen-Durchlauf wie der Bot-Zwilling. Die Entscheidung, die hier fällt: der
// Block stellt fest, er ordnet nichts an. „Deine Gewinner liefen im Schnitt bis
// +2,3 R, ausgestiegen bist du bei +1,4 R" ist eine Beobachtung — „zieh deine
// Ziele weiter" wäre eine Anweisung, und genau die gehört dem Trader, nicht
// seinem Journal (Douglas: der Plan entsteht vor dem Trade, nicht aus einer
// Statistik nach fünf Trades).

import { SKIP_LABELS } from '@/lib/bot-twin'
import type { ExcursionBucket, ExcursionStats } from '@/lib/excursion'
import { Ruler } from 'lucide-react'
import { cn } from '@/lib/utils'

const rMultiple = (v: number) =>
  `${v >= 0 ? '+' : '−'}${Math.abs(v).toLocaleString('de-DE', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} R`

export function ExcursionPanel({ stats }: { stats: ExcursionStats }) {
  const { coverage, minGroupSize } = stats

  return (
    <div className="panel sheen p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Ruler className="size-4 text-primary" />
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Gegenlauf &amp; Mitlauf (MAE / MFE)
          </p>
        </div>
        <p className="font-mono text-[10px] text-muted-foreground">
          {coverage.measured} von {coverage.decided} entschiedenen Trades gemessen
        </p>
      </div>

      {coverage.measured === 0 ? (
        <EmptyState stats={stats} />
      ) : (
        <div className="mt-4 space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] border-collapse font-mono text-xs">
              <thead>
                <tr className="text-[9px] uppercase tracking-widest text-muted-foreground">
                  <th className="pb-1 text-left font-normal">Gruppe</th>
                  <th className="pb-1 text-right font-normal">Trades</th>
                  <th className="pb-1 text-right font-normal" title="Maximum Adverse Excursion">
                    Ø gegen dich
                  </th>
                  <th className="pb-1 text-right font-normal" title="Maximum Favourable Excursion">
                    Ø für dich
                  </th>
                  <th className="pb-1 text-right font-normal">Ø Ausstieg</th>
                  <th className="pb-1 text-right font-normal">tiefster Gegenlauf</th>
                </tr>
              </thead>
              <tbody>
                {stats.buckets.map((b) => (
                  <Row key={b.key} row={b} minGroupSize={minGroupSize} />
                ))}
              </tbody>
            </table>
          </div>

          {stats.observations.length > 0 && (
            <div className="space-y-1 rounded-lg border border-border/70 bg-muted/20 p-2">
              {stats.observations.map((o) => (
                <p
                  key={o.kind}
                  className="font-mono text-[11px] leading-relaxed text-foreground"
                >
                  {o.kind === 'ziele' ? (
                    <>
                      Deine Gewinner liefen im Schnitt{' '}
                      <strong className="text-positive">
                        {o.gapR.toLocaleString('de-DE', { maximumFractionDigits: 1 })} R
                      </strong>{' '}
                      weiter, als du sie gehalten hast.
                    </>
                  ) : (
                    <>
                      Auch deine Gewinner liefen im Schnitt erst{' '}
                      <strong className="text-destructive">
                        {o.gapR.toLocaleString('de-DE', { maximumFractionDigits: 1 })} R
                      </strong>{' '}
                      gegen dich, bevor sie drehten.
                    </>
                  )}
                </p>
              ))}
              <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
                Eine Beobachtung, keine Anweisung: ob daraus eine Planänderung wird, entscheidest
                du vor dem nächsten Trade — nicht diese Tabelle.
              </p>
            </div>
          )}

          <p className="border-t border-border pt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
            Gemessen wird aus Hoch und Tief der Kerzen, die zwischen Einstieg und Ausstieg liegen
            — die angebrochene Einstiegskerze bleibt draußen, die Ausstiegskerze zählt mit. 1 R
            ist die geplante Stopdistanz.
            {stats.resolutions.length > 0 && <> Verwendet: {stats.resolutions.join(', ')}.</>}
            {coverage.coarse > 0 && (
              <>
                {' '}
                <strong>{coverage.coarse}</strong>{' '}
                {coverage.coarse === 1 ? 'Trade ist' : 'Trades sind'} nur grob gemessen (die
                Kerze ist länger als die Haltedauer) — dort lässt sich am Trade der echte
                Extremkurs nachtragen.
              </>
            )}
            {coverage.manual > 0 && (
              <>
                {' '}
                {coverage.manual} von Hand nachgetragen.
              </>
            )}
            {coverage.gaps.length > 0 && (
              <>
                {' '}
                Nicht messbar:{' '}
                {coverage.gaps.map((g) => `${g.count}× ${SKIP_LABELS[g.reason]}`).join(', ')}.
              </>
            )}{' '}
            Unter {minGroupSize} Trades zeigt eine Zeile keine Zahlen: das wäre Scheinpräzision.
          </p>
        </div>
      )}
    </div>
  )
}

function Row({ row, minGroupSize }: { row: ExcursionBucket; minGroupSize: number }) {
  const isTotal = row.key === 'gesamt'

  return (
    <tr
      className={cn(
        'border-t border-border/60',
        isTotal && 'border-t-2 border-border text-muted-foreground',
      )}
    >
      <td className={cn('py-1.5 pr-2', isTotal ? 'text-muted-foreground' : 'text-foreground')}>
        {row.label}
      </td>
      <td className="py-1.5 text-right text-foreground">{row.trades}</td>
      {row.enough ? (
        <>
          <td className="py-1.5 text-right font-bold text-destructive">{rMultiple(row.avgMae)}</td>
          <td className="py-1.5 text-right font-bold text-positive">{rMultiple(row.avgMfe)}</td>
          <td
            className={cn(
              'py-1.5 text-right',
              row.avgExitR >= 0 ? 'text-positive' : 'text-destructive',
            )}
          >
            {rMultiple(row.avgExitR)}
          </td>
          <td className="py-1.5 text-right text-muted-foreground">{rMultiple(row.worstMae)}</td>
        </>
      ) : (
        <td className="py-1.5 text-right text-muted-foreground" colSpan={4}>
          noch zu wenige Daten (ab {minGroupSize})
        </td>
      )}
    </tr>
  )
}

function EmptyState({ stats }: { stats: ExcursionStats }) {
  const { coverage, minGroupSize } = stats

  return (
    <div className="mt-3 space-y-2">
      <p className="font-mono text-xs leading-relaxed text-muted-foreground">
        Noch kein gemessener Trade. Sobald {minGroupSize} entschiedene Trades mit Kursdaten
        vorliegen, steht hier, wie weit der Kurs während deiner Haltedauer gegen dich lief (MAE)
        und wie weit für dich (MFE) — beides in R, beides aus denselben Kerzen wie der
        Bot-Zwilling, ohne dass du etwas zusätzlich eingibst.
      </p>
      {coverage.gaps.length > 0 && (
        <p className="font-mono text-xs leading-relaxed text-muted-foreground">
          Aktuell nicht messbar:{' '}
          {coverage.gaps.map((g) => `${g.count}× ${SKIP_LABELS[g.reason]}`).join(', ')}. Beim
          Minutenlimit füllt sich die Auswertung beim nächsten Aufruf von selbst auf; für
          dauerhafte Lücken lässt sich der Extremkurs am Trade nachtragen.
        </p>
      )}
    </div>
  )
}
