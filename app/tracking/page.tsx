import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  getDisciplineStats,
  getMoneyVsPaperStats,
  getZoneStats,
  listTrades,
  type TradeRow,
} from '@/app/actions/trades'
import { CockpitHeader } from '@/components/cockpit-header'
import { DisciplineBar, CockpitStats } from '@/components/discipline-overview'
import { MoneyHitRateChart } from '@/components/money-hitrate-chart'
import { MoneyProfitChart } from '@/components/money-profit-chart'

function monthKey(t: TradeRow): string {
  const d = t.closedAt ? new Date(t.closedAt) : new Date(t.createdAt)
  return d.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' })
}

export default async function TrackingPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const [stats, trades, moneyStats, zoneStats] = await Promise.all([
    getDisciplineStats(),
    listTrades(),
    getMoneyVsPaperStats(),
    getZoneStats(),
  ])
  const completed = trades.filter((t) => t.status === 'abgeschlossen')

  // Ergebnis-Aufschlüsselung: 4 Buckets (Plan × Ergebnis)
  const buckets = {
    winPlan: completed.filter((t) => t.result === 'gewinn' && t.followedPlan).length,
    lossPlan: completed.filter((t) => t.result === 'verlust' && t.followedPlan).length,
    winDeviate: completed.filter((t) => t.result === 'gewinn' && !t.followedPlan).length,
    lossDeviate: completed.filter((t) => t.result === 'verlust' && !t.followedPlan).length,
  }
  const bucketDefs = [
    { label: 'Gewinn + Plan befolgt', value: buckets.winPlan, color: 'var(--positive)' },
    { label: 'Verlust + Plan befolgt', value: buckets.lossPlan, color: 'var(--primary)' },
    { label: 'Gewinn + abgewichen', value: buckets.winDeviate, color: 'var(--warning)' },
    { label: 'Verlust + abgewichen', value: buckets.lossDeviate, color: 'var(--destructive)' },
  ]
  const maxBucket = Math.max(1, ...bucketDefs.map((b) => b.value))

  // Monatsverlauf: Plan befolgt vs. abgewichen
  const byMonth = new Map<string, { followed: number; deviated: number }>()
  for (const t of completed) {
    const k = monthKey(t)
    const e = byMonth.get(k) ?? { followed: 0, deviated: 0 }
    if (t.followedPlan) e.followed++
    else e.deviated++
    byMonth.set(k, e)
  }
  const months = [...byMonth.entries()]
  const maxMonth = Math.max(1, ...months.map(([, v]) => v.followed + v.deviated))

  return (
    <div className="min-h-svh bg-background">
      <CockpitHeader userLabel={session.user.name || session.user.email} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <h2 className="font-heading text-xl font-bold tracking-widest text-foreground sm:text-2xl">
            AUSWERTUNG
          </h2>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            Dein statistischer Vorteil über viele Trades — wie ein Casino.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <DisciplineBar stats={stats} />
          </div>
          <div className="glass-card p-4 lg:col-span-1">
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Erwartungswert
            </p>
            <p
              className={`mt-1 font-heading text-4xl font-black ${stats.expectancy >= 0 ? 'text-positive' : 'text-destructive'}`}
            >
              {stats.expectancy >= 0 ? '+' : ''}
              {stats.expectancy.toFixed(2)}R
            </p>
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
              Durchschnittliches R-Vielfaches je entschiedenem Trade. Positiv = dein Vorteil
              setzt sich langfristig durch.
            </p>
          </div>
        </div>

        <div className="mt-4">
          <CockpitStats stats={stats} />
        </div>

        {/* Echtgeld vs. Demo — Trefferquote & Ø Gewinn */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <MoneyHitRateChart stats={moneyStats} />
          <MoneyProfitChart stats={moneyStats} />
        </div>

        {/* Zonen-Trefferquote — laufen die geplanten Zonen überhaupt an? */}
        <div className="mt-4 glass-card p-4">
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Zonen-Trefferquote
          </p>
          {zoneStats.total === 0 ? (
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              Noch keine Daten — sobald Setups/Analysen anlaufen oder als „nicht angelaufen"
              markiert werden.
            </p>
          ) : (
            <>
              <div className="mt-1 flex items-end justify-between gap-3">
                <p
                  className={`font-heading text-4xl font-black ${zoneStats.rate >= 50 ? 'text-positive' : 'text-warning'}`}
                >
                  {zoneStats.rate.toFixed(0)}%
                </p>
                <div className="flex gap-4 font-mono text-[11px]">
                  <span className="text-positive">{zoneStats.reached} angelaufen</span>
                  <span className="text-warning">{zoneStats.notReached} nicht angelaufen</span>
                </div>
              </div>
              <div className="bar-track mt-3 flex h-2 overflow-hidden">
                <div
                  className="h-full bg-positive"
                  style={{ width: `${zoneStats.rate}%` }}
                />
                <div
                  className="h-full bg-warning"
                  style={{ width: `${100 - zoneStats.rate}%` }}
                />
              </div>
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                Wie oft deine geplanten Zonen tatsächlich angelaufen wurden — über Trades und
                Analysen. Niedrige Quote = Zonen zu eng/falsch gesetzt. Zählt nicht in
                Gewinn/Verlust oder Trefferquote.
              </p>
            </>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Ergebnis-Aufschlüsselung */}
          <div className="glass-card p-4">
            <p className="mb-3 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Ergebnis-Aufschlüsselung
            </p>
            <div className="space-y-3">
              {bucketDefs.map((b) => (
                <div key={b.label}>
                  <div className="flex justify-between font-mono text-[11px]">
                    <span className="text-muted-foreground">{b.label}</span>
                    <span className="text-foreground">{b.value}</span>
                  </div>
                  <div className="bar-track mt-1 h-2">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(b.value / maxBucket) * 100}%`, background: b.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Monatsverlauf */}
          <div className="glass-card p-4">
            <p className="mb-3 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Monatsverlauf · Plan befolgt vs. abgewichen
            </p>
            {months.length === 0 ? (
              <p className="font-mono text-xs text-muted-foreground">
                Noch keine abgeschlossenen Trades.
              </p>
            ) : (
              <div className="flex h-40 items-end gap-3">
                {months.map(([k, v]) => {
                  const total = v.followed + v.deviated
                  return (
                    <div key={k} className="flex flex-1 flex-col items-center gap-1">
                      <div
                        className="flex w-full flex-col-reverse overflow-hidden rounded-md"
                        style={{ height: `${(total / maxMonth) * 100}%`, minHeight: 4 }}
                      >
                        <div
                          className="bg-positive"
                          style={{ height: `${total ? (v.followed / total) * 100 : 0}%` }}
                        />
                        <div
                          className="bg-destructive"
                          style={{ height: `${total ? (v.deviated / total) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="font-mono text-[9px] text-muted-foreground">{k}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
