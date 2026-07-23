// Zustand vs. Ergebnis (Etappe 4) — der Auswertungsblock auf /tracking.
//
// Reine Anzeige: gerechnet wird in `computeMoodStats` (lib/trade-stats.ts).
// Hier steht keine zweite Rechenlogik, nur die Entscheidung, was gezeigt wird
// und was nicht — und das ist der Kern dieses Blocks: unter der Mindestgröße
// erscheint bewusst KEINE Quote, sondern „zu wenige Daten". Eine Trefferquote
// aus drei Trades sähe aus wie ein Befund und wäre Rauschen.

import type { MoodBucket, MoodStats } from '@/lib/trade-stats'
import { Activity } from 'lucide-react'
import { cn } from '@/lib/utils'

const pct = (v: number) => `${v.toFixed(0)} %`

const rMultiple = (v: number) =>
  `${v >= 0 ? '+' : '−'}${Math.abs(v).toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} R`

const toneText: Record<string, string> = {
  ruhig: 'text-positive',
  mittel: 'text-warning',
  unruhig: 'text-destructive',
  neutral: 'text-muted-foreground',
}

export function MoodStatsPanel({ stats }: { stats: MoodStats }) {
  const { coverage, minGroupSize } = stats

  return (
    <div className="glass-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-primary" />
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Zustand &amp; Ergebnis
          </p>
        </div>
        <p className="font-mono text-[10px] text-muted-foreground">
          {coverage.withEntryMood} von {coverage.decided} entschiedenen Trades mit Check-in
        </p>
      </div>

      {coverage.withEntryMood === 0 ? (
        <p className="mt-3 font-mono text-xs leading-relaxed text-muted-foreground">
          Noch keine Zustands-Daten. Ab dem nächsten aktivierten Trade wird bei jedem
          Ein- und Ausstieg festgehalten, in welcher Verfassung du handelst. Nach etwa{' '}
          {minGroupSize} Trades je Gruppe steht hier, in welchem Zustand du verdienst und in
          welchem du zahlst — mit deinen Zahlen, nicht mit einer Binsenweisheit.
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          <BucketTable
            title="Zustand beim Einstieg"
            rows={stats.byEntryGroup}
            minGroupSize={minGroupSize}
            overall={stats.overall}
            emptyHint="Noch kein Einstiegs-Check-in erfasst."
          />

          <BucketTable
            title="Nach Tag (Mehrfachnennung möglich)"
            rows={stats.byEntryTag}
            minGroupSize={minGroupSize}
            overall={stats.overall}
            emptyHint="Noch keine Tags vergeben — die Skala allein reicht für die Gruppen oben."
          />

          {coverage.withExitMood > 0 && (
            <BucketTable
              title="Zustand beim Ausstieg"
              rows={stats.byExitGroup}
              minGroupSize={minGroupSize}
              overall={stats.overall}
              emptyHint="Noch kein Ausstiegs-Check-in erfasst."
            />
          )}

          <p className="border-t border-border pt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
            Trefferquote und Erwartungswert über <strong>entschiedene</strong> Trades
            (Gewinn/Verlust) — Breakeven, Abbrüche und „kein Handel" zählen in keiner Zeile
            mit. Unter {minGroupSize} Trades zeigt eine Zeile keine Quote: das wäre
            Scheinpräzision. Tag-Zeilen summieren sich nicht auf die Gesamtzahl, ein Trade
            kann mehrere Tags tragen. Der Zustand beim Ausstieg erklärt keine Ergebnisse —
            er zeigt, was der Trade mit dir gemacht hat.
          </p>
        </div>
      )}
    </div>
  )
}

function BucketTable({
  title,
  rows,
  minGroupSize,
  overall,
  emptyHint,
}: {
  title: string
  rows: MoodBucket[]
  minGroupSize: number
  overall: MoodBucket
  emptyHint: string
}) {
  const shown = rows.filter((r) => r.trades > 0)

  // Maßstab der Erwartungswert-Balken: das größte belastbare |R| dieser Tabelle,
  // mindestens 0,5 R — sonst bläst ein einzelner Ausreißer alles andere platt
  // oder ein winziger Wert füllt den ganzen Balken.
  const scale = Math.max(
    0.5,
    ...shown.filter((r) => r.enough).map((r) => Math.abs(r.expectancy)),
  )

  return (
    <div>
      <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-primary/70">
        {title}
      </p>

      {shown.length === 0 ? (
        <p className="font-mono text-xs text-muted-foreground">{emptyHint}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[26rem] border-collapse font-mono text-xs">
            <thead>
              <tr className="text-[9px] uppercase tracking-widest text-muted-foreground">
                <th className="pb-1 text-left font-normal">Gruppe</th>
                <th className="pb-1 text-right font-normal">Trades</th>
                <th className="pb-1 text-right font-normal">Treffer</th>
                <th className="pb-1 text-right font-normal">Ø R</th>
                <th className="w-24 pb-1" />
                <th className="pb-1 text-right font-normal">Plan</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <BucketRow key={r.key} row={r} scale={scale} minGroupSize={minGroupSize} />
              ))}
              <BucketRow row={overall} scale={scale} minGroupSize={minGroupSize} isTotal />
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function BucketRow({
  row,
  scale,
  minGroupSize,
  isTotal = false,
}: {
  row: MoodBucket
  scale: number
  minGroupSize: number
  isTotal?: boolean
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
      <td className={cn('py-1.5 pr-2', isTotal ? 'text-muted-foreground' : toneText[row.tone])}>
        {row.label}
      </td>
      <td className="py-1.5 text-right text-foreground">{row.trades}</td>

      {row.enough ? (
        <>
          <td className="py-1.5 text-right text-foreground">{pct(row.winRate)}</td>
          <td
            className={cn(
              'py-1.5 text-right font-bold',
              row.expectancy >= 0 ? 'text-positive' : 'text-destructive',
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
          <td className="py-1.5 text-right text-muted-foreground">{pct(row.planFollowedRate)}</td>
        </>
      ) : (
        <td className="py-1.5 text-right text-muted-foreground" colSpan={4}>
          noch zu wenige Daten (ab {minGroupSize})
        </td>
      )}
    </tr>
  )
}
