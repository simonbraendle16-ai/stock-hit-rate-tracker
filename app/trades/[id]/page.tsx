import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getTrade } from '@/app/actions/trades'
import { getStockChartUrl } from '@/app/actions/stocks'
import { CockpitHeader } from '@/components/cockpit-header'
import { TradeCard } from '@/components/trade-card'
import { ArrowLeft, LineChart, Lock } from 'lucide-react'

export default async function TradeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const { id } = await params
  const t = await getTrade(Number(id))
  if (!t) notFound()

  const chartUrl = t.stockId != null ? await getStockChartUrl(t.stockId) : null
  const locked = t.status === 'aktiv' || t.status === 'abgeschlossen'
  const violations: string[] = t.ruleViolations ? JSON.parse(t.ruleViolations) : []

  return (
    <div className="min-h-svh bg-background">
      <CockpitHeader userLabel={session.user.name || session.user.email} />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <Link
          href="/trades"
          className="mb-4 inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> Zurück
        </Link>

        <div className="grid grid-cols-1 gap-4">
          <TradeCard t={t} />

          {chartUrl && (
            <a
              href={chartUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="glass-card flex items-center gap-2 p-3 font-mono text-[11px] text-primary hover:underline"
            >
              <LineChart className="size-4" /> Chart dieses Instruments öffnen
            </a>
          )}

          {locked && (
            <div className="glass-card flex items-center gap-2 p-3">
              <Lock className="size-4 text-primary" />
              <p className="font-mono text-[11px] text-muted-foreground">
                Plan-Lock aktiv: Einstieg, Stop und Invalidation sind festgeschrieben. Der Stop
                wird nicht verschoben (Douglas).
              </p>
            </div>
          )}

          {violations.length > 0 && (
            <div className="glass-card border-destructive/30 p-4">
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-destructive">
                Regelbrüche
              </p>
              <ul className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
                {violations.map((v) => (
                  <li key={v}>
                    ✗{' '}
                    {v === 'stop_moved'
                      ? 'Stop-Loss verschoben'
                      : v === 'invalidation_ignored'
                        ? 'Invalidation geändert'
                        : v === 'revenge'
                          ? 'Revenge-Trade (kurz nach Verlust eröffnet)'
                          : v}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {t.strategy && (
            <Panel title="Strategie / Setup">{t.strategy}</Panel>
          )}
          {t.notes && <Panel title="Notizen">{t.notes}</Panel>}
          {t.elliottInvalidation != null && (
            <Panel title="Elliott-Invalidation">
              Analyse ungültig ab {t.elliottInvalidation}
            </Panel>
          )}
        </div>
      </main>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass-card p-4">
      <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-primary/70">
        {title}
      </p>
      <p className="mt-2 whitespace-pre-wrap font-mono text-sm text-foreground">{children}</p>
    </div>
  )
}
