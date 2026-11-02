'use server'
import {auth} from '@/lib/auth'
import {headers} from 'next/headers'
import {db} from '@/lib/db'
import {fibonacciObservation as o,stock,trade} from '@/lib/db/schema'
import {and,eq,desc,ilike,or,sql,asc} from 'drizzle-orm'
import {listFib} from '@/lib/fibonacci-service'
import {ApiError,uuidId} from '@/lib/assistant-api'
import type {CollectionPage} from '@/lib/collection-types'
async function owner(){const s=await auth.api.getSession({headers:await headers()});if(!s?.user)throw new ApiError(401,'Anmeldung erforderlich.');return s.user.id}
export async function collectionPage(query='',offset=0):Promise<CollectionPage>{
 const user=await owner();query=query.trim().slice(0,200);offset=Number.isSafeInteger(offset)&&offset>=0?offset:0
 const owned=and(eq(o.userId,user),eq(stock.userId,user))
 const pattern='%'+query.replace(/[\\%_]/g,'\\$&')+'%'
 const filter=and(owned,query?or(ilike(stock.ticker,pattern),ilike(stock.name,pattern),ilike(o.wave,pattern),ilike(o.note,pattern)):undefined)
 return db.transaction(async tx=>{
 const [counts]=await tx.select({total:sql<number>`count(*)::int`,retracements:sql<number>`count(*) filter(where ${o.measurementKind}='retracement')::int`,expansions:sql<number>`count(*) filter(where ${o.measurementKind}='expansion')::int`}).from(o).innerJoin(stock,eq(stock.id,o.stockId)).where(owned)
 const [match]=await tx.select({n:sql<number>`count(*)::int`}).from(o).innerJoin(stock,eq(stock.id,o.stockId)).where(filter)
 const items=await tx.select({id:o.id,version:o.version,createdAt:o.createdAt,stockId:o.stockId,ticker:stock.ticker,name:stock.name,market:stock.market,wave:o.wave,degree:o.degree,timeframe:o.timeframe,status:o.status,observedOn:o.observedOn,measurementKind:o.measurementKind,percent:o.percent}).from(o).innerJoin(stock,eq(stock.id,o.stockId)).where(filter).orderBy(desc(o.observedOn),desc(o.createdAt),desc(o.id)).limit(50).offset(offset)
 return {...counts,items,matched:match.n,offset}
 },{isolationLevel:'repeatable read',accessMode:'read only'})
}
export async function collectionInstruments(){const user=await owner();return db.select({id:stock.id,name:stock.name,ticker:stock.ticker,market:stock.market}).from(stock).where(eq(stock.userId,user)).orderBy(asc(stock.name))}
export async function collectionDetail(id:string){const user=await owner();const [row]=await listFib(user,undefined,uuidId(id));if(!row)throw new ApiError(404,'Welle nicht gefunden.');return row}
export async function collectionChoices(stockId:number){
 const user=await owner();if(!Number.isSafeInteger(stockId)||stockId<1)throw new ApiError(400,'Instrument erforderlich.')
 const [parents,trades]=await Promise.all([
 db.select({id:o.id,stockId:o.stockId,ticker:stock.ticker,wave:o.wave}).from(o).innerJoin(stock,and(eq(stock.id,o.stockId),eq(stock.userId,user))).where(and(eq(o.userId,user),eq(o.stockId,stockId))).orderBy(desc(o.observedOn)),
 db.select({id:trade.id,stockId:trade.stockId}).from(trade).where(and(eq(trade.userId,user),eq(trade.stockId,stockId)))])
 return {parents,trades}
}
