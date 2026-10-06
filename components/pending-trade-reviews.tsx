import Link from 'next/link'
import { and, desc, eq, lte, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { trade } from '@/lib/db/schema'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

export async function PendingTradeReviews({userId}:{userId:string}) {
  const rows=await db.select({id:trade.id,ticker:trade.ticker}).from(trade).where(and(eq(trade.userId,userId),eq(trade.status,'abgeschlossen'),
    or(eq(trade.reviewStatus,'pending'),and(eq(trade.reviewStatus,'deferred'),lte(trade.reviewDeferredUntil,new Date())))))
    .orderBy(desc(trade.closedAt),desc(trade.id))
  if(!rows.length) return null
  return <Card className="mb-4"><CardHeader><CardTitle>Abschlussbewertung offen · {rows.length}</CardTitle>
    <CardDescription>Die Ausführungen sind gespeichert. Deine persönliche Bewertung fehlt noch.
      <div className="mt-2 flex flex-wrap gap-3">{rows.map(t=><Link key={t.id} href={`/trades/${t.id}#bewertung`} className="text-primary underline">{t.ticker} · Trade {t.id}</Link>)}</div>
    </CardDescription></CardHeader></Card>
}
