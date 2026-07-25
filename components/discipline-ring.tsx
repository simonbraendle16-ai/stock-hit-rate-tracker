import { CountUp } from '@/components/count-up'
import { cn } from '@/lib/utils'

const R = 52
const CIRC = 2 * Math.PI * R

/**
 * Der Disziplin-Score als Radial-Instrument — die eine grosse Zahl der App.
 *
 * Bewusst reines SVG statt einer Bibliothek: der Aufbau läuft über
 * `stroke-dashoffset` in CSS (`.ring-value` in `app/globals.css`), damit die
 * Komponente serverseitig rendern kann und ohne JavaScript korrekt aussteht.
 *
 * **Ruhezustand:** Ohne abgeschlossene Trades gibt es keinen Score — dann zeigt
 * der Ring weder 0 % noch Rot (das hiesse „schlechte Disziplin", obwohl schlicht
 * nichts gemessen wurde), sondern einen neutralen Strich und eine langsam
 * umlaufende Marke: das Instrument wartet auf Daten.
 *
 * Der Glow (`.svg-glow`) ist eine der wenigen Stellen, an denen dieses Projekt
 * Leuchten erlaubt — siehe CLAUDE.md.
 */
export function DisciplineRing({
  value,
  colorClass,
  hasData,
  className,
}: {
  value: number
  colorClass: string
  /** Erst ab einem abgeschlossenen Trade gibt es überhaupt einen Score. */
  hasData: boolean
  className?: string
}) {
  const v = Math.max(0, Math.min(100, value))
  const dashTo = CIRC * (1 - v / 100)
  const tone = hasData ? colorClass : 'text-muted-foreground'

  return (
    <div className={cn('relative shrink-0', className)}>
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden="true">
        {/* Skalenstriche alle 10 % — sie machen aus der Zierform ein Ablesegerät.
            Der Strich bei 80 % ist kräftiger: dort beginnt der optimale Bereich. */}
        {Array.from({ length: 10 }, (_, i) => {
          const angle = (i / 10) * 2 * Math.PI
          const isMark = i === 8
          const ro = 63
          const ri = isMark ? 56 : 59
          return (
            <line
              key={i}
              x1={60 + Math.cos(angle) * ri}
              y1={60 + Math.sin(angle) * ri}
              x2={60 + Math.cos(angle) * ro}
              y2={60 + Math.sin(angle) * ro}
              stroke="currentColor"
              className={isMark ? 'text-primary/70' : 'text-muted-foreground/35'}
              strokeWidth={isMark ? 2 : 1.25}
              strokeLinecap="round"
            />
          )
        })}

        {/* Spur */}
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          stroke="var(--border)"
          strokeWidth="9"
        />

        {hasData ? (
          <circle
            cx="60"
            cy="60"
            r={R}
            fill="none"
            stroke="currentColor"
            strokeWidth="9"
            strokeLinecap="round"
            className={cn('ring-value svg-glow', tone)}
            style={
              {
                '--dash': `${CIRC}`,
                '--dash-to': `${dashTo}`,
              } as React.CSSProperties
            }
          />
        ) : (
          /* Ruhemarke: läuft langsam um die Spur, solange nichts gemessen ist. */
          <circle
            cx="60"
            cy="60"
            r={R}
            fill="none"
            stroke="currentColor"
            strokeWidth="9"
            strokeLinecap="round"
            className="ring-idle svg-glow text-primary/45"
            style={
              {
                strokeDasharray: `${CIRC * 0.12} ${CIRC}`,
              } as React.CSSProperties
            }
          />
        )}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('metric metric-hero leading-none', tone)}>
          {hasData ? (
            <>
              <CountUp value={Math.round(v)} />%
            </>
          ) : (
            '—'
          )}
        </span>
        <span className="eyebrow mt-1.5">Disziplin</span>
      </div>
    </div>
  )
}
