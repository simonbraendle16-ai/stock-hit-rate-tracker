import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import { eq } from 'drizzle-orm'
import * as schema from './db/schema'

const state=vi.hoisted(()=>({database:null as any,tx:null as any}))
vi.mock('@/lib/db',()=>({get db(){return state.tx??state.database},inDatabaseTransaction:async(fn:()=>Promise<unknown>)=>{
  if(state.tx) return fn()
  return state.database.transaction(async(tx:any)=>{state.tx=tx;try{return await fn()}finally{state.tx=null}})
}}))
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}))
vi.mock('@/lib/plan-alert-service',()=>({createPlanAlertsForUser:vi.fn(async()=>({created:0}))}))
import { mutateTrade,performTradeAction,reviseExecution,saveTradeReview,patchPlannedTrade } from './trade-mutation-service'
import { pendingReview } from './trade-review-state'
import { settlePosition } from './trade-events'
import { planningSnapshot } from './plan-context'

let pg:PGlite,tradeId:number,version:number,base:number,source:Record<string,unknown>
const dialect=new PgDialect()
beforeAll(async()=>{
  pg=new PGlite();state.database=drizzle(pg,{schema})
  // Full column shape, so services exercise real SQL and transaction rollback.
  for(const table of [schema.user,schema.portfolio,schema.trade,schema.tradeEvent,schema.tradeTarget,schema.tradeActionRequest,schema.tradeEventRevision,schema.tradeSettlementReceipt,schema.priceAlert,schema.userSettings]){
    const config=getTableConfig(table)
    const columns=config.columns.map(c=>{
      let d=''
      if(c.default!==undefined){const v=c.default
        d=' DEFAULT '+(typeof v==='string'?`'${v.replaceAll("'","''")}'`:typeof v==='number'||typeof v==='boolean'?String(v):dialect.sqlToQuery(v as any).sql)
      }
      return `"${c.name}" ${c.getSQLType()}${c.primary?' PRIMARY KEY':''}${d}`
    })
    await pg.exec(`CREATE TABLE "${config.name}" (${columns.join(',')})`)
  }
  await pg.exec(`CREATE UNIQUE INDEX action_key ON trade_action_request ("userId","requestKey");
    CREATE UNIQUE INDEX event_version ON trade_event_revision ("eventId",version);
    CREATE FUNCTION bump_trade_version() RETURNS trigger AS $$ BEGIN NEW.version := OLD.version + 1; RETURN NEW; END $$ LANGUAGE plpgsql;
    CREATE TRIGGER trade_version_update BEFORE UPDATE ON trade FOR EACH ROW EXECUTE FUNCTION bump_trade_version();`)
  await state.database.insert(schema.user).values({id:'isolated',name:'Isolated test',email:'isolated@example.invalid'})
  await state.database.insert(schema.portfolio).values({id:1,userId:'isolated',name:'Isolated',kind:'echtgeld',currency:'EUR',startCapital:10000})
},30000)
afterAll(async()=>{await pg?.close()})
beforeEach(async()=>{
  await pg.exec('TRUNCATE trade,trade_event,trade_target,trade_event_revision,trade_action_request,trade_settlement_receipt RESTART IDENTITY')
  base=Date.now()-3600000;source={kind:'user_statement',capturedAt:new Date().toISOString(),confirmedByUser:true}
  const [row]=await state.database.insert(schema.trade).values({userId:'isolated',portfolioId:1,ticker:'ISOLATED',market:'aktien',direction:'long',tradeKind:'schnell',status:'geplant',
    entryPrice:100,stopLoss:90,takeProfit:120,positionSize:10,tradedWithMoney:true,quoteCurrency:'EUR',accountCurrency:'EUR',quoteToAccountRate:1,feeEntry:0,feeExit:0,alertsEnabled:false}).returning()
  tradeId=row.id;version=row.version
})
async function action(action:string,extra:Record<string,unknown>={},offset=0,key=crypto.randomUUID()){
  const body={action,source,at:new Date(base+offset).toISOString(),...extra}
  const result:any=await mutateTrade('isolated',tradeId,version,key,'actions',body,row=>performTradeAction('isolated',tradeId,row,body))
  version=result.version;return result
}
async function events(){return state.database.select().from(schema.tradeEvent).where(eq(schema.tradeEvent.tradeId,tradeId))}
async function revision(eventId:number,patch:Record<string,unknown>){const body={source,reason:'Confirmed correction',patch};const result:any=await mutateTrade('isolated',tradeId,version,crypto.randomUUID(),'correction',body,()=>reviseExecution('isolated',tradeId,eventId,body));version=result.version;return result}
async function review(extra:Record<string,unknown>){const body={source,...extra};const result:any=await mutateTrade('isolated',tradeId,version,crypto.randomUUID(),'review',body,()=>saveTradeReview('isolated',tradeId,body));version=result.version;return result}

describe('shared position actions, history and review on PostgreSQL',()=>{
  it('changes a foreign-currency plan atomically while retaining exact quantity, frozen FX and prior text',async()=>{
    await state.database.update(schema.trade).set({entryPrice:39.41,stopLoss:36,takeProfit:48.5,positionSize:20,investedAmount:883.09928,leverage:1,
      quoteCurrency:'EUR',accountCurrency:'USD',quoteToAccountRate:1.1204,fxRateAt:new Date(base),notes:'Historical entry 39.41',
      planContext:{version:1,expectedMove:'Synthetic move',entryTrigger:'39.41',stopManagement:'Synthetic stop',targetManagement:'Synthetic target',riskConfirmed:true}}).where(eq(schema.trade.id,tradeId))
    version=(await state.database.select().from(schema.trade))[0].version
    const body={entryPrice:39,positionSize:20,investedAmount:873.912,notes:'Current entry 39; previous zone is historical',
      planContext:{version:1,expectedMove:'Synthetic move',entryTrigger:'39',stopManagement:'Synthetic stop',targetManagement:'Synthetic target',riskConfirmed:true},source}
    const key=crypto.randomUUID()
    const saved:any=await mutateTrade('isolated',tradeId,version,key,'plan',body,row=>patchPlannedTrade('isolated',tradeId,row,body))
    expect(saved).toMatchObject({entryPrice:39,positionSize:20,investedAmount:873.912,quoteToAccountRate:1.1204})
    const history=JSON.parse((await events())[0].payload)
    expect(history.before).toMatchObject({entryPrice:39.41,investedAmount:883.09928,notes:'Historical entry 39.41'})
    expect(history.after).toMatchObject({entryPrice:39,positionSize:20,notes:body.notes})
    await mutateTrade('isolated',tradeId,version,key,'plan',body,row=>patchPlannedTrade('isolated',tradeId,row,body))
    expect(await events()).toHaveLength(1)
    await expect(mutateTrade('isolated',tradeId,saved.version,crypto.randomUUID(),'plan',{...body,investedAmount:883.09928},row=>patchPlannedTrade('isolated',tradeId,row,{...body,investedAmount:883.09928}))).rejects.toThrow('widersprechen')
    expect((await state.database.select().from(schema.trade))[0].version).toBe(saved.version)
    expect(await events()).toHaveLength(1)
  })
  it('preserves legacy metadata PATCH, provenance and history without duplicate replay',async()=>{
    const body={notes:'Corrected note',strategy:'Confirmed strategy'},key=crypto.randomUUID()
    const saved:any=await mutateTrade('isolated',tradeId,version,key,'plan',body,row=>patchPlannedTrade('isolated',tradeId,row,body))
    expect(saved.notes).toBe(body.notes);expect(saved.strategy).toBe(body.strategy)
    const payload=JSON.parse((await events())[0].payload)
    expect(payload.before.notes).toBeNull();expect(payload.after.notes).toBe(body.notes)
    expect(payload.source).toEqual({kind:'assistant_interpretation'})
    await mutateTrade('isolated',tradeId,version,key,'plan',body,row=>patchPlannedTrade('isolated',tradeId,row,body))
    expect(await events()).toHaveLength(1)
    await expect(mutateTrade('isolated',tradeId,version,crypto.randomUUID(),'plan',body,row=>patchPlannedTrade('isolated',tradeId,row,body))).rejects.toThrow('inzwischen geändert')
  })
  it('still requires confirmation for structured plan changes and rejects metadata updates on active trades',async()=>{
    const body={notes:'New note',positionSize:20}
    await expect(mutateTrade('isolated',tradeId,version,crypto.randomUUID(),'plan',body,row=>patchPlannedTrade('isolated',tradeId,row,body))).rejects.toThrow('Nutzeraussage')
    expect(await events()).toHaveLength(0)
    await action('activate',{price:100,quantity:10})
    const metadata={notes:'After activation'}
    await expect(mutateTrade('isolated',tradeId,version,crypto.randomUUID(),'plan',metadata,row=>patchPlannedTrade('isolated',tradeId,row,metadata))).rejects.toThrow('Nur geplante Trades')
  })
  it('records actual activation, add, partial and close; derives result and reminds without invented review',async()=>{
    const opened=await action('activate',{price:101,quantity:10})
    expect(opened.entryPrice).toBe(101)
    const snap=JSON.parse((await events())[0].payload).planningSnapshot
    expect(snap.entryPrice).toBe(100);expect(snap.version).toBe(2)
    await action('add',{price:110,quantity:2},1000)
    await action('partialClose',{price:120,quantity:3},2000)
    const closed=await action('close',{price:115,quantity:9},3000)
    expect(closed.result).toBe('gewinn');expect(closed.followedPlan).toBeNull();expect(pendingReview(closed)).toBe(true)
    expect(settlePosition(closed,await events()).openQty).toBe(0)
    const rated=await review({status:'completed',followedPlan:false})
    expect(rated.followedPlan).toBe(false);expect(pendingReview(rated)).toBe(false)
  })
  it('rejects stale versions and replays the same operation without duplicate events',async()=>{
    const key=crypto.randomUUID(),body={action:'activate',source,at:new Date(base).toISOString(),price:100,quantity:10}
    const first=await mutateTrade('isolated',tradeId,version,key,'actions',body,row=>performTradeAction('isolated',tradeId,row,body))
    const again=await mutateTrade('isolated',tradeId,version,key,'actions',body,async()=>{throw Error('must not execute')})
    expect(again).toEqual(JSON.parse(JSON.stringify(first)));expect((await events()).length).toBe(1)
    await expect(mutateTrade('isolated',tradeId,version,crypto.randomUUID(),'actions',body,async()=>null)).rejects.toThrow('inzwischen geändert')
    await expect(mutateTrade('isolated',tradeId,version,key,'actions',{...body,price:102},async()=>null)).rejects.toThrow('anderen Angaben')
    await expect(mutateTrade('other',tradeId,version,crypto.randomUUID(),'actions',body,async()=>null)).rejects.toThrow('nicht gefunden')
  })
  it('accepts consistent late entries, recalculates later averages and rolls back impossible histories',async()=>{
    await action('activate',{price:100,quantity:10})
    await action('partialClose',{price:120,quantity:8},3000)
    await action('add',{price:110,quantity:2},1000)
    const list=await events(),opening=list.find((e:any)=>e.type==='eroeffnet')
    const before=version
    await expect(revision(opening.id,{quantity:4})).rejects.toThrow('negativen Bestand')
    expect((await events()).find((e:any)=>e.id===opening.id).quantity).toBe(10)
    const [row]=await state.database.select().from(schema.trade).where(eq(schema.trade.id,tradeId))
    expect(row.version).toBe(before)
    expect(await state.database.select().from(schema.tradeEventRevision)).toHaveLength(0)
  })
  it('keeps the original and every corrected execution; updates linked target facts',async()=>{
    await action('activate',{price:100,quantity:10})
    await state.database.insert(schema.tradeTarget).values({tradeId,userId:'isolated',sortOrder:0,price:110,sharePct:50})
    const target=(await state.database.select().from(schema.tradeTarget))[0]
    await action('executeTarget',{targetId:target.id,price:111,quantity:4},1000)
    const exit=(await events()).find((e:any)=>e.type==='teilverkauf')
    await revision(exit.id,{price:112,quantity:3})
    await revision(exit.id,{price:113})
    const revisions=await state.database.select().from(schema.tradeEventRevision)
    expect(revisions.map((r:any)=>r.version)).toEqual([1,2]);expect(revisions[0].before.price).toBe(111)
    expect((await state.database.select().from(schema.tradeTarget))[0].executedQty).toBe(3)
  })
  it('keeps target ids and complete before/after ladders when revising management',async()=>{
    await action('activate',{price:100,quantity:10})
    await state.database.insert(schema.tradeTarget).values([{tradeId,userId:'isolated',sortOrder:0,price:110,sharePct:50},{tradeId,userId:'isolated',sortOrder:1,price:120,sharePct:50}])
    const ids=(await state.database.select().from(schema.tradeTarget)).map((t:any)=>t.id)
    await action('management',{patch:{targets:[{price:110,sharePct:40}],takeProfit:120,stopLoss:95},reason:'Confirmed trailing',assessment:{assessment:'plan',reason:'Allowed in plan',source:'user_statement'}},1000)
    expect((await state.database.select().from(schema.tradeTarget)).map((t:any)=>t.id)).toEqual(ids)
    const revision=(await events()).find((e:any)=>e.type==='notiz')
    expect(JSON.parse(revision.payload).before.targets[0].sharePct).toBe(50)
    expect(JSON.parse(revision.payload).after.targets[0].sharePct).toBe(40)
    const t=(await state.database.select().from(schema.trade))[0]
    expect(JSON.parse(t.ruleViolations)).not.toContain('stop_moved')
  })
  it('does not overwrite broker or receipt evidence',async()=>{
    await action('activate',{price:100,quantity:10})
    const opening=(await events())[0]
    await state.database.update(schema.tradeEvent).set({payload:JSON.stringify({source:'broker',brokerOrderId:1})}).where(eq(schema.tradeEvent.id,opening.id))
    await expect(revision(opening.id,{price:102})).rejects.toThrow('Belegkorrektur')
    const brokerTime=(await events())[0].at
    await state.database.insert(schema.tradeEvent).values({userId:'isolated',tradeId,type:'teilverkauf',at:new Date(brokerTime.getTime()+1000),price:110,quantity:2,fee:0,payload:JSON.stringify({source:'broker'})})
    const body={action:'partialClose',price:110,quantity:2,at:new Date(brokerTime.getTime()+1000).toISOString(),source}
    await expect(mutateTrade('isolated',tradeId,version,crypto.randomUUID(),'actions',body,row=>performTradeAction('isolated',tradeId,row,body))).rejects.toThrow('Doppelbuchung')
  })
  it('defers, skips and reopens reviews without discarding facts; honest loss reflection may be false',async()=>{
    await action('activate',{price:100,quantity:10});await action('close',{price:90,quantity:10},1000)
    const deferred=await review({status:'deferred',deferredUntil:new Date(Date.now()+86400000).toISOString()})
    expect(pendingReview(deferred)).toBe(false);expect(pendingReview(deferred,new Date(Date.now()+172800000))).toBe(true)
    const skipped=await review({status:'skipped',reason:'Do not want this review'})
    expect(pendingReview(skipped)).toBe(false);expect(skipped.followedPlan).toBeNull()
    await review({status:'pending'})
    await expect(review({status:'completed',followedPlan:true})).rejects.toThrow('Verlustreflexion')
    expect((await review({status:'completed',followedPlan:false,lossAccepted:false})).reviewStatus).toBe('completed')
  })
  it('captures original risk and signals unknown historical ladder data',()=>{
    const snap=planningSnapshot({direction:'long',entryPrice:100,stopLoss:90,takeProfit:120,positionSize:10})
    expect(snap.targets).toBeNull();expect(snap.gaps).toContain('Zielstaffel nicht geladen')
  })
})
