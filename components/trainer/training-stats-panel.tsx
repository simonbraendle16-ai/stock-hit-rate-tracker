import { ChartHeader } from '@/components/chart-frame'
import { cn } from '@/lib/utils'
import {
  MIN_TRAINING_BUCKET,
  MIN_TRAINING_RUNS,
  type TrainingGroupRow,
  type TrainingStats,
} from '@/lib/training-stats'
import type { TrainingRating } from '@/lib/training'
import { BarChart3, Clock, Layers, Repeat, TriangleAlert } from 'lucide-react'

const RATING_CLASS: Record<TrainingRating, string> = {
  korrekt: 'bg-positive',
  teilweise: 'bg-warning',
  falsch: 'bg-destructive',
}

function pct(v: number | null): string {
  return v == null ? '—' : `${v.toFixed(0)} %`
}

function Tabelle({
  icon,
  title,
  subtitle,
  spalte,
  rows,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  subtitle: string
  spalte: string
  rows: TrainingGroupRow[]
}) {
  return (
    <section className="panel p-4">
      <ChartHeader icon={icon} title={title} subtitle={subtitle} />
      {rows.length === 0 ? (
        <p className="note">Noch keine bewertete Übung in dieser Aufschlüsselung.</p>
      ) : (
        // `min-w-0` gehört dazu: Ohne es bläht sich die Tabelle auf ihre
        // Inhaltsbreite auf und schiebt die ganze Seite (Etappe 14, mobil).
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[380px] border-collapse font-mono text-xs">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="eyebrow py-1.5 font-normal">{spalte}</th>
                <th className="eyebrow py-1.5 text-right font-normal">Übungen</th>
                <th className="eyebrow py-1.5 text-right font-normal">Korrekt</th>
                <th className="eyebrow py-1.5 text-right font-normal">Teilweise</th>
                <th className="eyebrow py-1.5 text-right font-normal">Quote</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-border/50 last:border-0">
                  <td className="py-1.5 text-foreground">{r.label}</td>
                  <td className="tabular py-1.5 text-right text-muted-foreground">
                    {r.count}
                  </td>
                  <td className="tabular py-1.5 text-right text-muted-foreground">
                    {r.korrekt}
                  </td>
                  <td className="tabular py-1.5 text-right text-muted-foreground">
                    {r.teilweise}
                  </td>
                  <td
                    className={cn(
                      'tabular py-1.5 text-right font-bold',
                      r.quote == null ? 'text-muted-foreground' : 'text-foreground',
                    )}
                  >
                    {r.quote == null ? `${r.count} von ${MIN_TRAINING_BUCKET}` : pct(r.quote)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/**
 * Phase 5 des Trainer-Plans. Bewusst eine eigene Seite und kein Block auf
 * `/tracking`: Übungsquoten neben echten Geldkennzahlen wären genau die
 * Vermischung, die eine schöne Zahl aus Papier wie ein Ergebnis aussehen
 * lässt.
 *
 * Jede Quote steht erst ab ihrer Schwelle da — darunter steht ihre Grundlage.
 * „100 %" aus einer Übung darf nicht aussehen wie aus dreißig.
 */
export function TrainingStatsPanel({ stats }: { stats: TrainingStats }) {
  const letzte = stats.timeline.slice(-40)

  return (
    <div className="space-y-4">
      <section className="panel-raised rise-in p-5">
        <ChartHeader
          icon={BarChart3}
          title="Trefferquote im Training"
          subtitle="Nur bewertete Übungen. Verworfene und offene zählen nirgends mit."
        />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="eyebrow">Trefferquote</p>
            <p className="metric mt-1">
              {stats.overall.quote == null
                ? `${stats.rated} von ${MIN_TRAINING_RUNS}`
                : pct(stats.overall.quote)}
            </p>
            {stats.overall.quote == null && (
              <p className="note mt-1">Ab {MIN_TRAINING_RUNS} bewerteten Übungen.</p>
            )}
          </div>
          <div>
            <p className="eyebrow">Teilweise korrekt</p>
            <p className="metric mt-1">{pct(stats.overall.teilQuote)}</p>
          </div>
          <div>
            <p className="eyebrow">Bewertet</p>
            <p className="metric mt-1 tabular">{stats.rated}</p>
            <p className="note mt-1">von {stats.total} Übungen</p>
          </div>
          <div>
            <p className="eyebrow">Serie</p>
            <p className="metric mt-1 tabular">{stats.streak}</p>
            <p className="note mt-1">in Folge korrekt</p>
          </div>
        </div>

        {letzte.length > 0 && (
          <div className="mt-5">
            <p className="eyebrow mb-2">Verlauf (letzte {letzte.length})</p>
            <div className="flex items-end gap-0.5">
              {letzte.map((t) => (
                <span
                  key={t.id}
                  title={t.rating}
                  className={cn(
                    'h-6 flex-1 rounded-sm',
                    RATING_CLASS[t.rating],
                    t.rating === 'teilweise' && 'h-4',
                    t.rating === 'falsch' && 'h-2',
                  )}
                />
              ))}
            </div>
            <p className="note mt-1.5">
              Hoch = korrekt · mittel = teilweise · niedrig = falsch. Links alt, rechts neu.
            </p>
          </div>
        )}
      </section>

      <section className="panel p-4">
        <ChartHeader
          icon={TriangleAlert}
          title="Häufigste Fehler"
          subtitle="Aus dem festen Katalog — nur so lässt sich zählen, was wiederkommt."
        />
        {stats.errors.length === 0 ? (
          <p className="note">Noch kein Fehler erfasst.</p>
        ) : (
          <div className="space-y-1.5">
            {stats.errors.map((e) => (
              <div key={e.id} className="flex items-center gap-3">
                <span
                  className={cn(
                    'w-56 shrink-0 truncate font-mono text-xs',
                    e.elliott ? 'text-primary' : 'text-foreground',
                  )}
                >
                  {e.label}
                </span>
                <span className="panel-sunken h-2 min-w-0 flex-1 overflow-hidden rounded-full p-0">
                  <span
                    className="block h-full rounded-full bg-primary/70"
                    style={{ width: `${Math.max(3, e.share)}%` }}
                  />
                </span>
                <span className="tabular w-20 shrink-0 text-right font-mono text-xs text-muted-foreground">
                  {e.count}× · {e.share.toFixed(0)} %
                </span>
              </div>
            ))}
            {stats.elliottErrors.length > 0 && (
              <p className="note pt-2">
                Blau hervorgehoben sind die Elliott-Fehler ·{' '}
                {stats.elliottErrors.reduce((s, e) => s + e.count, 0)} Nennungen zusammen.
              </p>
            )}
          </div>
        )}
      </section>

      <Tabelle
        icon={Clock}
        title="Trefferquote je Zeitebene"
        subtitle="Wo trägt deine Analyse — und wo ist es Rauschen?"
        spalte="Zeitebene"
        rows={stats.byTimeframe}
      />

      <Tabelle
        icon={Layers}
        title="Trefferquote je Setup"
        subtitle={
          stats.ohneSetup > 0
            ? `Frei benannt, Schreibweisen werden zusammengefasst · ${stats.ohneSetup} Übungen ohne Angabe.`
            : 'Frei benannt, Schreibweisen werden zusammengefasst.'
        }
        spalte="Setup"
        rows={stats.bySetup}
      />

      <Tabelle
        icon={Repeat}
        title="Trefferquote je Übungsart"
        subtitle="Ein Zufallschart ist härter als ein selbst gewähltes Symbol — das darf man sehen."
        spalte="Art"
        rows={stats.byMode}
      />
    </div>
  )
}
