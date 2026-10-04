import type { overallGap } from '@/lib/instrument-stats'

type Gap = NonNullable<ReturnType<typeof overallGap>>

export function PrognosisGapRow({ overall }: { overall: Gap | null }) {
  if (!overall) {
    return (
      <div className="panel sheen p-4">
        <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Prognose- und Trade-Quoten
        </p>
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          Noch kein Vergleich möglich — dafür braucht es entschiedene Prognosen{' '}
          <em className="not-italic text-foreground">und</em> entschiedene Trades.
        </p>
      </div>
    )
  }

  const { assessmentHitRate, tradeHitRate, gap, assessmentsDecided, tradesDecided } = overall

  return (
    <div className="panel sheen p-4">
      <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Prognose- und Trade-Quoten
      </p>

      <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <p className="font-heading text-3xl font-bold text-foreground">
            {assessmentHitRate.toFixed(0)}%
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            Prognosen · {assessmentsDecided} entschieden
          </p>
        </div>

        <span className="pb-6 font-mono text-lg text-muted-foreground">/</span>

        <div>
          <p className="font-heading text-3xl font-bold text-foreground">
            {tradeHitRate.toFixed(0)}%
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            Trades · {tradesDecided} entschieden
          </p>
        </div>

        <div className="ml-auto text-right">
          <p
            className="font-heading text-3xl font-bold text-foreground"
          >
            {gap > 0 ? '+' : gap < 0 ? '−' : ''}
            {Math.abs(gap).toFixed(0)}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">Prozentpunkte · Prognosen minus Trades</p>
        </div>
      </div>

      {/* Zwei Balken übereinander, gleiche Skala — die Lücke ist so als Länge zu
          sehen und nicht nur als Zahl zu lesen. */}
      <div className="mt-3 flex flex-col gap-1.5">
        <div className="bar-track h-2">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.max(0, Math.min(100, assessmentHitRate))}%` }}
          />
        </div>
        <div className="bar-track h-2">
          <div
            className="h-full rounded-full bg-muted-foreground"
            style={{ width: `${Math.max(0, Math.min(100, tradeHitRate))}%` }}
          />
        </div>
      </div>

      <p className="mt-2 font-mono text-[11px] text-muted-foreground">
        Unterschiedliche, ungepaarte Gruppen und Erfolgsdefinitionen. Auswahl und Zeiträume können
        abweichen. Die Differenz erlaubt keine Aussage über Verhalten oder Planbefolgung; kleine
        Fallzahlen begrenzen die Aussagekraft.
      </p>
    </div>
  )
}
