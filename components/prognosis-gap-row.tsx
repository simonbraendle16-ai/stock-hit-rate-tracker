// Die Lücke zwischen Analyse und Umsetzung — über ALLE Instrumente zusammen.
//
// Warum diese Zahl hier steht und nicht nur auf den einzelnen Karten: Je
// Instrument sind die Trades heute noch dünn (oft ein oder zwei), in Summe aber
// nicht. Erst über den ganzen Bestand ist die Aussage belastbar — und genau
// diese Aussage ist die Kernfrage der App:
//
//   Trifft meine Analyse und scheitert die Umsetzung? Oder umgekehrt?
//
// Die Vorzeichenlogik ist bewusst herum: Eine POSITIVE Lücke (Prognose besser
// als Umsetzung) ist die schlechte Nachricht — deshalb rot.

import type { overallGap } from '@/lib/instrument-stats'

type Gap = NonNullable<ReturnType<typeof overallGap>>

export function PrognosisGapRow({ overall }: { overall: Gap | null }) {
  if (!overall) {
    return (
      <div className="panel sheen p-4">
        <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Prognose vs. Umsetzung
        </p>
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          Noch nicht zu beantworten — dafür braucht es entschiedene Prognosen{' '}
          <em className="not-italic text-foreground">und</em> entschiedene Trades.
        </p>
      </div>
    )
  }

  const { assessmentHitRate, tradeHitRate, gap, assessmentsDecided, tradesDecided } = overall
  const kostet = gap > 0

  return (
    <div className="panel sheen p-4">
      <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Prognose vs. Umsetzung
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

        <span className="pb-6 font-mono text-lg text-muted-foreground">→</span>

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
            className={`font-heading text-3xl font-bold ${kostet ? 'text-destructive' : 'text-positive'}`}
          >
            {kostet ? '−' : '+'}
            {Math.abs(gap).toFixed(0)}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">Punkte Differenz</p>
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
            className={`h-full rounded-full ${kostet ? 'bg-warning' : 'bg-positive'}`}
            style={{ width: `${Math.max(0, Math.min(100, tradeHitRate))}%` }}
          />
        </div>
      </div>

      <p className="mt-2 font-mono text-[11px] text-muted-foreground">
        {kostet
          ? 'Deine Analyse trifft besser, als deine Trades es umsetzen. Die Differenz liegt im Verhalten — Einstieg, Ausstieg, Abweichen vom Plan —, nicht in der Prognose.'
          : 'Deine Trades halten, was die Analyse verspricht. Die Umsetzung ist nicht der Engpass.'}
      </p>
    </div>
  )
}
