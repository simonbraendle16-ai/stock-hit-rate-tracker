// Zeit-Heatmap und Haltedauer (Etappe 7d) — der Auswertungsblock auf /tracking.
//
// Reine Anzeige: gerechnet wird in `computeTimeStats` (lib/trade-stats.ts).
// Die eine Entscheidung, die hier fällt: eine Zelle unter der Mindestgröße zeigt
// ihre Anzahl, aber keine Quote und keinen Erwartungswert. „Dienstagnachmittag
// bist du schlecht" nach zwei Trades wäre keine Erkenntnis, sondern Aberglaube
// mit Zahlen daneben.

import {
  DAY_BLOCKS,
  TIME_ROWS,
  type TimeBucket,
  type TimeCell,
  type TimeStats,
} from '@/lib/trade-stats'
import { CalendarClock } from 'lucide-react'
import { cn } from '@/lib/utils'

const pct = (v: number) => `${v.toFixed(0)} %`

const rMultiple = (v: number) =>
  `${v >= 0 ? '+' : '−'}${Math.abs(v).toLocaleString('de-DE', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}`

// Feste Klassen — Tailwind erkennt keine zusammengesetzten Namen.
const TINT = {
  positiv: ['bg-positive/10', 'bg-positive/20', 'bg-positive/30'],
  negativ: ['bg-destructive/10', 'bg-destructive/20', 'bg-destructive/30'],
} as const

/** Einfärbung einer belastbaren Zelle: drei Stufen, relativ zum größten |Ø R|. */
function tintOf(expectancy: number, scale: number): string {
  const share = Math.min(1, Math.abs(expectancy) / scale)
  const step = share > 0.66 ? 2 : share > 0.33 ? 1 : 0
  return TINT[expectancy >= 0 ? 'positiv' : 'negativ'][step]
}

export function TimeHeatmapPanel({ stats }: { stats: TimeStats }) {
  const { coverage, minCellTrades, hasWeekend } = stats
  const rows = TIME_ROWS.filter((r) => r.key !== 'we' || hasWeekend)
  const cellAt = new Map(stats.cells.map((c) => [`${c.row}|${c.block}`, c]))

  // Maßstab der Einfärbung: das größte belastbare |Ø R| im Gitter, mindestens
  // 0,5 R — sonst färbt ein einzelner Ausreißer alles andere blass.
  const scale = Math.max(
    0.5,
    ...stats.cells.filter((c) => c.enough).map((c) => Math.abs(c.expectancy)),
  )

  return (
    <div className="panel sheen p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-primary" />
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Zeit &amp; Haltedauer
          </p>
        </div>
        <p className="font-mono text-[10px] text-muted-foreground">
          {coverage.withOpenedAt} von {coverage.decided} entschiedenen Trades mit Einstiegszeit
        </p>
      </div>

      {coverage.withOpenedAt === 0 ? (
        <EmptyState stats={stats} />
      ) : (
        <div className="mt-4 space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[26rem] border-collapse font-mono text-xs">
              <thead>
                <tr className="text-[9px] uppercase tracking-widest text-muted-foreground">
                  <th className="pb-1 pr-2 text-left font-normal">Einstieg</th>
                  {DAY_BLOCKS.map((b) => (
                    <th key={b.key} className="pb-1 text-center font-normal" title={b.label}>
                      {b.short}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="py-1 pr-2 text-muted-foreground">{r.label}</td>
                    {DAY_BLOCKS.map((b) => (
                      <td key={b.key} className="p-0.5">
                        <Cell cell={cellAt.get(`${r.key}|${b.key}`)} scale={scale} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <p className="mb-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
              Haltedauer und Ergebnis
            </p>
            <table className="w-full border-collapse font-mono text-xs">
              <thead>
                <tr className="text-[9px] uppercase tracking-widest text-muted-foreground">
                  <th className="pb-1 text-left font-normal">Gehalten</th>
                  <th className="pb-1 text-right font-normal">Trades</th>
                  <th className="pb-1 text-right font-normal">Treffer</th>
                  <th className="pb-1 text-right font-normal">Ø R</th>
                </tr>
              </thead>
              <tbody>
                {stats.holding.map((h) => (
                  <HoldingRow key={h.key} row={h} minCellTrades={minCellTrades} />
                ))}
                <HoldingRow row={stats.overall} minCellTrades={minCellTrades} isTotal />
              </tbody>
            </table>
          </div>

          <p className="border-t border-border pt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
            Maßgeblich ist die <strong>Einstiegszeit</strong> — dort fällt die Entscheidung — in
            der Zeitzone dieses Geräts, nicht in der Handelszeit der jeweiligen Börse. Gerechnet
            wird über <strong>entschiedene</strong> Trades (Gewinn/Verlust); Breakeven, Abbrüche
            und „kein Handel" zählen nirgends mit. Unter {minCellTrades} Trades zeigt eine Zelle
            nur ihre Anzahl: das wäre Scheinpräzision.
            {coverage.decided > coverage.withOpenedAt && (
              <>
                {' '}
                {coverage.decided - coverage.withOpenedAt}{' '}
                {coverage.decided - coverage.withOpenedAt === 1
                  ? 'Trade trägt keine Einstiegszeit und fehlt'
                  : 'Trades tragen keine Einstiegszeit und fehlen'}{' '}
                im Gitter.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  )
}

/** Eine Zelle: gefärbt nur, wenn sie trägt — sonst Anzahl oder Strich. */
function Cell({ cell, scale }: { cell?: TimeCell; scale: number }) {
  if (!cell || cell.trades === 0) {
    return (
      <div className="flex h-11 items-center justify-center rounded-md border border-border/40 text-border">
        —
      </div>
    )
  }

  if (!cell.enough) {
    return (
      <div className="flex h-11 flex-col items-center justify-center rounded-md border border-border/60 bg-muted/20 leading-tight text-muted-foreground">
        <span className="text-[11px]">{cell.trades}</span>
        <span className="text-[9px]">
          {cell.trades === 1 ? 'Trade' : 'Trades'}
        </span>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex h-11 flex-col items-center justify-center rounded-md border border-border/60 leading-tight',
        tintOf(cell.expectancy, scale),
      )}
      title={`${cell.trades} Trades · ${pct(cell.winRate)} Treffer · Plan ${pct(
        cell.planFollowedRate,
      )}`}
    >
      <span
        className={cn(
          'text-[11px] font-bold',
          cell.expectancy >= 0 ? 'text-positive' : 'text-destructive',
        )}
      >
        {rMultiple(cell.expectancy)} R
      </span>
      <span className="text-[9px] text-muted-foreground">{cell.trades} Trades</span>
    </div>
  )
}

function HoldingRow({
  row,
  minCellTrades,
  isTotal = false,
}: {
  row: TimeBucket
  minCellTrades: number
  isTotal?: boolean
}) {
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
          <td className="py-1.5 text-right text-foreground">{pct(row.winRate)}</td>
          <td
            className={cn(
              'py-1.5 text-right font-bold',
              row.expectancy >= 0 ? 'text-positive' : 'text-destructive',
            )}
          >
            {rMultiple(row.expectancy)} R
          </td>
        </>
      ) : (
        <td className="py-1.5 text-right text-muted-foreground" colSpan={2}>
          noch zu wenige Daten (ab {minCellTrades})
        </td>
      )}
    </tr>
  )
}

function EmptyState({ stats }: { stats: TimeStats }) {
  const { coverage, minCellTrades } = stats

  return (
    <div className="mt-3 space-y-2">
      <p className="font-mono text-xs leading-relaxed text-muted-foreground">
        Noch kein abgeschlossener Trade mit Einstiegszeit. Sobald {minCellTrades} Trades auf
        denselben Wochentag und dieselbe Tageszeit fallen, steht hier, wann du gut handelst und
        wann nicht — Ein- und Ausstiegszeit werden dafür ohnehin schon mitgeschrieben, du musst
        nichts zusätzlich eingeben.
      </p>
      {coverage.decided > 0 && (
        <p className="font-mono text-xs leading-relaxed text-muted-foreground">
          {coverage.decided} entschiedene{' '}
          {coverage.decided === 1 ? 'Trade stammt' : 'Trades stammen'} aus der Zeit vor dieser
          Aufzeichnung und {coverage.decided === 1 ? 'trägt' : 'tragen'} keinen Zeitstempel. Sie
          werden nicht nachträglich eingeordnet — eine geschätzte Uhrzeit wäre eine erfundene
          Zahl.
        </p>
      )}
    </div>
  )
}
