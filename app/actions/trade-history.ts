'use server'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { tradeEventRevision } from '@/lib/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { mutateTrade, reviseExecution, saveTradeReview } from '@/lib/trade-mutation-service'

async function user() {
  const session=await auth.api.getSession({headers:await headers()})
  if(!session?.user) throw new Error('Unauthorized')
  return session.user.id
}
export async function listTradeEventRevisions(id:number) {
  const userId=await user()
  return db.select().from(tradeEventRevision).where(and(eq(tradeEventRevision.userId,userId),eq(tradeEventRevision.tradeId,id)))
    .orderBy(asc(tradeEventRevision.createdAt),asc(tradeEventRevision.id))
}
export async function updateTradeReview(id:number,version:number,key:string,body:Record<string,unknown>) {
  const userId=await user()
  const saved=await mutateTrade(userId,id,version,key,'review',body,()=>saveTradeReview(userId,id,body))
  revalidatePath('/');revalidatePath('/trades');revalidatePath(`/trades/${id}`)
  return saved
}
export async function correctTradeExecution(id:number,eventId:number,version:number,key:string,body:Record<string,unknown>) {
  const userId=await user()
  const saved=await mutateTrade(userId,id,version,key,`events/${eventId}/revisions`,body,()=>reviseExecution(userId,id,eventId,body))
  revalidatePath('/');revalidatePath('/trades');revalidatePath(`/trades/${id}`)
  return saved
}
