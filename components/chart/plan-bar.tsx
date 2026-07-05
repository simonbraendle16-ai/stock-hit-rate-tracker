import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import { computeRiskReward } from '@/lib/trade-math'

/** Read-only Plan-Leiste unter dem Chart: Entry/Stop/Target/Invalidation + R:R je offenem Trade. */
export interface PlanBarTrade {
  id: number
  direction: 'long' | 'short'
  status: string
  entryPrice: number
  stopLoss: number
  takeProfit: number | null
  elliottInvalidation: number | null
  riskRewardRatio: number | null
}

function fmt(n: number): string {
  return n.toLocaleString('de-DE', { maximumFractionDigits: 6 })
}

export function PlanBar({ trades }: { trades: PlanBarTrade[] }) {
  if (trades.length === 0) return null

  return (
    <div className="glass-card mt-3 p-4">
      <p className="mb-3 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Trading-Plan im Chart
      </p>
      <div className="divide-y divide-border">
        {trades.map((t) => {
          const rr =
            t.riskRewardRatio ?? computeRiskReward(t.entryPrice, t.stopLoss, t.takeProfit)
          return (
            <Link
              key={t.id}
              href={`/trades/${t.id}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 font-mono text-xs hover:text-primary"
            >
              <span className="flex items-center gap-1 font-bold text-foreground">
                {t.direction === 'long' ? (
                  <ArrowUpRight className="size-3.5 text-positive" />
                ) : (
                  <ArrowDownRight className="size-3.5 text-destructive" />
                )}
                {t.direction === 'long' ? 'Long' : 'Short'}
                <span className="ml-1 font-normal uppercase tracking-widest text-muted-foreground">
                  {t.status}
                </span>
              </span>
              <span style={{ color: '#45a8ec' }}>Entry {fmt(t.entryPrice)}</span>
              <span style={{ color: '#D8505F' }}>Stop {fmt(t.stopLoss)}</span>
              {t.takeProfit != null && (
                <span style={{ color: '#4FBE8C' }}>Target {fmt(t.takeProfit)}</span>
              )}
              {t.elliottInvalidation != null && (
                <span style={{ color: '#D4AC4E' }}>Invalidation {fmt(t.elliottInvalidation)}</span>
              )}
              {rr != null && Number.isFinite(rr) && (
                <span className="ml-auto text-foreground">
                  R:R <span className="font-bold">{rr.toFixed(2)}</span>
                </span>
              )}
            </Link>
          )
        })}
      </div>
      <p className="mt-3 font-mono text-[10px] text-muted-foreground">
        Handle deinen Plan, nicht deine Emotion.
      </p>
    </div>
  )
}
