import Link from 'next/link'
import { db } from '@/lib/db'
import { fibonacciObservation, stock, assessment } from '@/lib/db/schema'
import { eq, count, and } from 'drizzle-orm'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

/** Only owned aggregate counts; no observation payload or mixed performance metric. */
export async function WorkspaceOverview({userId,tradeCount,openCount,scopeLabel}:{userId:string;tradeCount:number;openCount:number;scopeLabel:string}) {
  const [waves,instruments,forecasts]=await Promise.all([
    db.select({status:fibonacciObservation.status,n:count()}).from(fibonacciObservation)
      .innerJoin(stock,and(eq(stock.id,fibonacciObservation.stockId),eq(stock.userId,userId)))
      .where(eq(fibonacciObservation.userId,userId)).groupBy(fibonacciObservation.status),
    db.select({n:count()}).from(stock).where(eq(stock.userId,userId)),
    db.select({n:count()}).from(assessment).where(eq(assessment.userId,userId)),
  ])
  const total=waves.reduce((n,r)=>n+r.n,0),completed=waves.find(r=>r.status==='abgeschlossen')?.n??0
  const areas=[
    {href:'/analysis#fibonacci',title:'Wellenstatistik',summary:completed+' abgeschlossene Beobachtungen',text:'Bestand vor Messart- und Qualitätsfiltern; keine Trefferquote. Drei Perspektiven verwenden dieselbe Auswahl.'},
    {href:'/collection?fib.basis=1',title:'Datensammlung',summary:total+' Beobachtungen · '+instruments[0].n+' Instrumente',text:'Gesamter eigener Bestand einschließlich laufender, unklarer und ungültiger Fälle. Erfassen und korrigieren.'},
    {href:'/forecasts',title:'Prognoseprüfung',summary:forecasts[0].n+' eigene Bewertungen',text:'Bewertete Prognosen, einschließlich nicht erreichter Zonen. Historische Wellenmessungen werden nicht mitgezählt.'},
    {href:'/trades',title:'Trades',summary:tradeCount+' Trades · '+openCount+' aktiv',text:'Depotansicht: '+scopeLabel+'. Keine gemeinsame Gewinnsumme mit Forschung oder Prognosen.'},
  ]
  return <section aria-label="Arbeitsbereiche im Überblick" className="mb-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    {areas.map(area=><Card key={area.title} className="gap-3"><CardHeader><CardTitle>{area.title}</CardTitle><p className="text-sm font-semibold">{area.summary}</p><CardDescription>{area.text}</CardDescription></CardHeader><CardContent><Link className="text-sm text-primary underline underline-offset-4" href={area.href}>{area.title} öffnen</Link></CardContent></Card>)}
  </section>
}
