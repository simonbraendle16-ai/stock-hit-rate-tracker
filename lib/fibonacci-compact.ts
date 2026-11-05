import {db} from '@/lib/db';
import {fibonacciObservation as o, stock} from '@/lib/db/schema';
import {and,eq,desc,asc,sql} from 'drizzle-orm';
import {ApiError} from '@/lib/assistant-api';
import {fibQuery} from '@/lib/fibonacci-query';

// This deliberately separate contract never approximates research semantics.
// Unsupported historical/hierarchy/semantic searches must use research mode.
export function compactQuery(p:URLSearchParams){
 const allowed=['view','limit','offset','order','stockId','market','wave','degree','timeframe','measurementKind','status','contextId','sourceKey','observationId'];
 if([...p.keys()].some(k=>!allowed.includes(k)||p.getAll(k).length!==1))throw new ApiError(400,'Filter im kompakten Modus nicht unterstützt; Recherchemodus verwenden.');
 const copy=new URLSearchParams(p);copy.delete('view');
 const request=fibQuery(copy);
 if(request.order==='deepest')throw new ApiError(400,'Kompakte Sortierung: newest oder oldest.');
 return request;
}
export async function compactFib(userId:string,request:ReturnType<typeof compactQuery>){
 const {filters:f,limit,offset,order}=request;
 const predicate=and(eq(o.userId,userId),eq(stock.userId,userId),
  f.stockId?eq(o.stockId,f.stockId):undefined,
  f.market?eq(stock.market,f.market):undefined,
  f.wave?sql`upper(trim(${o.wave})) = ${f.wave.trim().toUpperCase()}`:undefined,
  f.degree?eq(o.degree,f.degree):undefined,
  f.timeframe?eq(o.timeframe,f.timeframe):undefined,
  f.measurementKind?eq(o.measurementKind,f.measurementKind):undefined,
  f.status?eq(o.status,f.status):undefined,
  f.contextId?eq(o.contextId,f.contextId):undefined,
  f.sourceKey?eq(o.sourceKey,f.sourceKey):undefined,
  f.observationId?eq(o.id,f.observationId):undefined);
 const direction=order==='oldest'?asc:desc;
 // Read-only snapshot keeps count and page consistent without fetching full rows.
 return db.transaction(async tx=>{
  const [count]=await tx.select({total:sql<number>`count(*)::int`}).from(o).innerJoin(stock,eq(stock.id,o.stockId)).where(predicate);
  const items=await tx.select({id:o.id,version:o.version,stockId:o.stockId,ticker:stock.ticker,name:stock.name,market:stock.market,
   wave:o.wave,degree:o.degree,timeframe:o.timeframe,status:o.status,observedOn:o.observedOn,measurementKind:o.measurementKind,percent:o.percent,contextId:o.contextId,sourceKey:o.sourceKey})
   .from(o).innerJoin(stock,eq(stock.id,o.stockId)).where(predicate)
   .orderBy(direction(o.observedOn),direction(o.createdAt),direction(o.id)).limit(limit).offset(offset);
  return {view:'compact' as const,items,total:count.total,nextOffset:offset+limit<count.total?offset+limit:null,basis:{filters:f,limit,offset,order}};
 },{isolationLevel:'repeatable read',accessMode:'read only'});
}
