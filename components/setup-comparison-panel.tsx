// Setup-Vergleich (Etappe 7b) — der Auswertungsblock auf /tracking.
//
// Reine Anzeige: gerechnet wird in `computeSetupStats` (lib/trade-stats.ts).
// Hier steht nur die Entscheidung, was gezeigt wird und was nicht — und das ist
// der Kern: unter der Mindestgröße erscheint bewusst KEINE Quote, sondern
// „zu wenige Daten". Ein Setup nach vier Trades auszusortieren wäre keine
// Erkenntnis, sondern eine teure Fehlentscheidung.

import type { SetupBucket, SetupStats } from '@/lib/trade-stats'
import { Layers } from 'lucide-react'
import { cn } from '@/lib/utils'

const pct = (v: number) => `${v.toFixed(0)} %`

const rMultiple = (v: number) =>
  `${v >= 0 ? '+' : '−'}${Math.abs(v).toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} R`

/** Haltedauer lesbar: Stunden bei kurzen Trades, sonst Tage mit einer Stelle. */
function holding(days: number | null): string {
  if (days === null) return '—'
  if (days < 1 / 24) return '< 1 h'
  if (days < 2) return `${Math.round(days * 24)} h`
  return `${days.toLocaleString('de-DE', { maximumFractionDigits: 1 })} T`
}

export function SetupComparisonPanel({ stats }: { stats: SetupStats }) {
  const { coverage, minGroupSize, maxTags } = stats

  // Maßstab der Erwartungswert-Balken: das größte belastbare |R| der Tabelle,
  // mindestens 0,5 R — sonst bläst ein Ausreißer alles andere platt.
  const scale = Math.max(
    0.5,
    ...stats.setups.filter((s) => s.enough).map((s) => Math.abs(s.expectancy)),
  )

  return (
    <div className="panel sheen p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Layers className="size-4 text-primary" />
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Setup-Vergleich
          </p>
        </div>
        <p className="font-mono text-[10px] text-muted-foreground">
          {coverage.withTags} von {coverage.decided} entschiedenen Trades mit Setup
        </p>
      </div>

      {coverage.withTags === 0 ? (
        <EmptyState stats={stats} />
      ) : (
        <div className="mt-4 space-y-4">
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse font-mono text-xs">
              <thead>
                <tr className="text-[9px] uppercase tracking-widest text-muted-foreground">
                  <th className="pb-1 text-left font-normal">Setup</th>
                  <th className="pb-1 text-right font-normal">Trades</th>
                  <th className="pb-1 text-right font-normal">Treffer</th>
                  <th className="pb-1 text-right font-normal">Ø R</th>
                  <th className="w-20 pb-1" />
                  <th className="pb-1 text-right font-normal">best / schlecht.</th>
                  <th className="pb-1 text-right font-normal">Ø Dauer</th>
                  <th className="pb-1 text-right font-normal">Plan</th>
                </tr>
              </thead>
              <tbody>
                {stats.setups.map((s) => (
                  <SetupRow key={s.key} row={s} scale={scale} minGroupSize={minGroupSize} />
                ))}
                {stats.untagged.trades > 0 && (
                  <SetupRow
                    row={stats.untagged}
                    scale={scale}
                    minGroupSize={minGroupSize}
                    muted
                  />
                )}
                <SetupRow
                  row={stats.overall}
                  scale={scale}
                  minGroupSize={minGroupSize}
                  isTotal
                />
              </tbody>
            </table>
          </div>

          {coverage.freetextOnly > 0 && (
            <p className="rounded-lg border border-border/70 bg-muted/20 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
              {coverage.freetextOnly}{' '}
              {coverage.freetextOnly === 1 ? 'entschiedener Trade trägt' : 'entschiedene Trades tragen'}{' '}
              einen Strategie-Text, aber kein Setup. Beim Öffnen des Trades lassen sich daraus
              Tags übernehmen — bis dahin {coverage.freetextOnly === 1 ? 'zählt er' : 'zählen sie'}{' '}
              in der Zeile „ohne Angabe".
            </p>
          )}

          <p className="border-t border-border pt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
            Trefferquote und Erwartungswert über <strong>entschiedene</strong> Trades
            (Gewinn/Verlust) — Breakeven, Abbrüche und „kein Handel" zählen in keiner Zeile mit.
            Unter {minGroupSize} Trades zeigt eine Zeile keine Quote: das wäre Scheinpräzision.
            Ein Trade kann bis zu {maxTags} Setups tragen und erscheint dann in mehreren Zeilen —
            die Zeilen summieren sich deshalb nicht auf die Gesamtzahl. Die Ø Haltedauer zählt
            nur Trades mit Ein- und Ausstiegszeit; Alt-Trades ohne Zeitstempel fehlen darin.
          </p>
        </div>
      )}
    </div>
  )
}

function EmptyState({ stats }: { stats: SetupStats }) {
  const { coverage, minGroupSize } = stats

  return (
    <div className="mt-3 space-y-2">
      <p className="font-mono text-xs leading-relaxed text-muted-foreground">
        Noch kein Trade mit einem Setup. Ab dem nächsten Trade lässt sich im Formular ein kurzes
        Setup vergeben („Breakout", „Rücksetzer", …). Nach etwa {minGroupSize} Trades je Setup
        steht hier, welches davon dich trägt und welches du nur aus Gewohnheit handelst — mit
        deinen Zahlen, nicht mit einer Faustregel.
      </p>
      {coverage.freetextOnly > 0 && (
        <p className="font-mono text-xs leading-relaxed text-muted-foreground">
          {coverage.freetextOnly} deiner abgeschlossenen Trades{' '}
          {coverage.freetextOnly === 1 ? 'trägt' : 'tragen'} bereits einen Strategie-Text. Beim
          Öffnen des Trades wird daraus ein Vorschlag — übernommen wird nur, was du bestätigst.
        </p>
      )}
    </div>
  )
}

function SetupRow({
  row,
  scale,
  minGroupSize,
  isTotal = false,
  muted = false,
}: {
  row: SetupBucket
  scale: number
  minGroupSize: number
  isTotal?: boolean
  muted?: boolean
}) {
  const share = row.enough ? Math.min(1, Math.abs(row.expectancy) / scale) : 0
  const positive = row.expectancy >= 0

  return (
    <tr
      className={cn(
        'border-t border-border/60',
        isTotal && 'border-t-2 border-border text-muted-foreground',
      )}
    >
      <td
        className={cn(
          'py-1.5 pr-2',
          isTotal || muted ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        {row.label}
      </td>
      <td className="py-1.5 text-right text-foreground">{row.trades}</td>

      {row.enough ? (
        <>
          <td className="py-1.5 text-right text-foreground">{pct(row.winRate)}</td>
          <td
            className={cn(
              'py-1.5 text-right font-bold',
              positive ? 'text-positive' : 'text-destructive',
            )}
          >
            {rMultiple(row.expectancy)}
          </td>
          <td className="py-1.5 pl-3">
            {/* Divergierender Balken: Mitte = 0 R, rechts Gewinn, links Verlust. */}
            <div className="relative h-1.5 w-full rounded-full bg-border/50">
              <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
              <span
                className={cn(
                  'absolute inset-y-0 rounded-full',
                  positive ? 'left-1/2 bg-positive' : 'right-1/2 bg-destructive',
                )}
                style={{ width: `${share * 50}%` }}
              />
            </div>
          </td>
          <td className="py-1.5 text-right text-muted-foreground">
            {row.bestR === null || row.worstR === null ? (
              '—'
            ) : (
              <>
                <span className="text-positive">{rMultiple(row.bestR)}</span>
                <span className="px-1 text-border">/</span>
                <span className="text-destructive">{rMultiple(row.worstR)}</span>
              </>
            )}
          </td>
          <td className="py-1.5 text-right text-muted-foreground">
            {holding(row.avgHoldingDays)}
          </td>
          <td className="py-1.5 text-right text-muted-foreground">{pct(row.planFollowedRate)}</td>
        </>
      ) : (
        <td className="py-1.5 text-right text-muted-foreground" colSpan={6}>
          noch zu wenige Daten (ab {minGroupSize})
        </td>
      )}
    </tr>
  )
}
