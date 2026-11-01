import Link from 'next/link'
import {auth} from '@/lib/auth'
import {headers} from 'next/headers'
import {redirect} from 'next/navigation'
import {CockpitHeader} from '@/components/cockpit-header'
import {getOverallStats,getHitRateTimeline} from '@/app/actions/stocks'
import {StatCards} from '@/components/stat-cards'
import {HitRateTimeline} from '@/components/hitrate-timeline'
import {DistributionChart} from '@/components/distribution-chart'
import {DistributionBarChart} from '@/components/distribution-bar-chart'
export default async function ForecastsPage(){
  const session=await auth.api.getSession({headers:await headers()});if(!session?.user)redirect('/sign-in')
  const [stats,timeline]=await Promise.all([getOverallStats(),getHitRateTimeline()])
  return <div className="min-h-svh"><CockpitHeader userLabel={session.user.name||session.user.email}/><main id="cockpit-content" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8"><h1 className="mb-2 text-2xl font-semibold">Prognoseprüfung</h1><p className="mb-6 text-sm text-muted-foreground">Eigene Prognosebewertungen. Wellenmessungen, Simulationen und tatsächliche Trade-Ergebnisse bleiben getrennt. Einzelne Bewertungen und der zugehörige Verlauf sind über Watchlist und Instrumentdetails erreichbar.</p><Link href="/watchlist" className="mb-6 inline-block text-primary underline underline-offset-4">Instrumente und einzelne Prognosebewertungen öffnen</Link><StatCards stats={stats}/><div className="mt-6"><HitRateTimeline data={timeline}/></div><div className="mt-6 grid gap-6 lg:grid-cols-2"><DistributionChart correct={stats.correct} wrong={stats.wrong}/><DistributionBarChart correct={stats.correct} wrong={stats.wrong}/></div></main></div>
}
