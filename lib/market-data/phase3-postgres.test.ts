import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest'
import {Client,Pool} from 'pg'
import {readFileSync,writeFileSync} from 'node:fs'
import {marketLocation,MARKET_POOL_OPTIONS} from './location.mjs'
const provider=vi.hoisted(()=>vi.fn())
vi.mock('./index',async original=>({...await original<any>(),resolveProvider:()=>({getCandles:provider}),providerByName:()=>({getCandles:provider})}))
const base='postgresql://phase3_admin:Synthetic-Phase3-Only-2026%21@127.0.0.1:5583/'
describe('versioned market location contract',()=>{
 it('rejects incomplete, unknown, collocated and client-influenced mappings without exposing secrets',()=>{
  expect(marketLocation({})).toMatchObject({version:'legacy',location:'A'})
  for(const env of [{MARKET_DATA_LOCATION:'B'},{MARKET_DATA_ROUTING_VERSION:'1',MARKET_DATA_LOCATION:'B'},
   {MARKET_DATA_ROUTING_VERSION:'2'},{MARKET_DATA_LOCATION:'random'},
   {MARKET_DATA_ROUTING_VERSION:'1',MARKET_DATA_LOCATION:'B',DATABASE_URL:base+'phase3_core',MARKET_DATABASE_URL:base+'phase3_core'}])
   expect(()=>marketLocation(env)).toThrow()
  expect(marketLocation({MARKET_DATA_ROUTING_VERSION:'1',MARKET_DATA_LOCATION:'B',DATABASE_URL:base+'phase3_core',MARKET_DATABASE_URL:base+'phase3_market'})).toMatchObject({location:'B',version:'1'})
  const invalid={MARKET_DATA_ROUTING_VERSION:'1',MARKET_DATA_LOCATION:'B',DATABASE_URL:base+'phase3_core',MARKET_DATABASE_URL:'postgres://synthetic-secret@['}
  try{marketLocation(invalid);throw Error('expected rejection')}catch(e){expect(String(e)).not.toContain('synthetic-secret');expect((e as any).input).toBeUndefined()}
  expect(()=>marketLocation({MARKET_DATA_ROUTING_VERSION:'1',MARKET_DATA_LOCATION:'B',DATABASE_URL:'postgres://user@localhost/postgres',MARKET_DATABASE_URL:'postgres://other@127.0.0.1:5432/postgres'})).toThrow('getrennt')
  expect(MARKET_POOL_OPTIONS).toMatchObject({max:3,connectionTimeoutMillis:2000,statement_timeout:4000})
 })
})
describe.runIf(process.env.PHASE3_ISOLATED_POSTGRES==='1')('real local PostgreSQL: independent pools, failures, budgets and consumers',()=>{
 let admin:Client,core:Client,market:Client,database:typeof import('./database'),personal:typeof import('../db'),store:typeof import('./candle-store')
 const checks:any[]=[];const reads:{query:string,rows:number,bytes:number}[]=[];let querySpy:any
 beforeAll(async()=>{
  vi.stubEnv('DATABASE_URL',base+'phase3_core');vi.stubEnv('MARKET_DATABASE_URL',base+'phase3_market');vi.stubEnv('MARKET_DATA_ROUTING_VERSION','1');vi.stubEnv('MARKET_DATA_LOCATION','B')
  admin=new Client({connectionString:base+'postgres'});core=new Client({connectionString:base+'phase3_core'});market=new Client({connectionString:base+'phase3_market'})
  await admin.connect();await core.connect();await market.connect()
  await market.query('UPDATE candle_series SET "fetchedAt"=now()')
  const original=Pool.prototype.query
  querySpy=vi.spyOn(Pool.prototype,'query').mockImplementation(function(this:Pool,...args:any[]){
    const result=(original as any).apply(this,args)
    if(result?.then)return result.then((r:any)=>{if(r?.rows)reads.push({query:typeof args[0]==='string'?args[0]:args[0]?.text??'',rows:r.rows.length,bytes:Buffer.byteLength(JSON.stringify(r.rows))});return r})
    return result
  } as any)
  database=await import('./database');personal=await import('../db');store=await import('./candle-store')
  provider.mockResolvedValue([{time:1700363600,open:100,high:104,low:98,close:102,volume:10}])
 },120000)
 afterAll(async()=>{
  if(admin){await admin.query('ALTER DATABASE phase3_core ALLOW_CONNECTIONS true');await admin.query('ALTER DATABASE phase3_market ALLOW_CONNECTIONS true')}
  querySpy?.mockRestore();await database?.closeMarketDatabase();await personal?.pool.end();await Promise.allSettled([admin?.end(),core?.end(),market?.end()])
  writeFileSync('docs/phase3-qa/real-postgres.json',JSON.stringify({synthetic:true,checks},null,2));vi.unstubAllEnvs()
 })
 it('routes bounded warm chart/close reads to B with the Phase-2 query/row contract, with no A market tables',async()=>{
  const {getStoredCandles,getStoredCloses}=store
  const before=(await core.query("SELECT tablename FROM pg_tables WHERE tablename LIKE 'candle_%'")).rows
  expect(before).toEqual([])
  reads.length=0
  const rows=await getStoredCandles('TEST','aktien','1h',{storedOnly:true,limit:3})
  expect(rows).toHaveLength(3);const storedReads=reads.splice(0)
  expect(storedReads).toHaveLength(1);expect(storedReads[0].rows).toBe(3)
  expect(await getStoredCloses('TEST','aktien','1h',3)).toEqual(rows.map(r=>r.close))
  const closeReads=reads.splice(0);expect(closeReads).toHaveLength(2);expect(closeReads.map(r=>r.rows)).toEqual([1,3])
  expect(closeReads.every(r=>!/lastError|executionSession/.test(r.query))).toBe(true)
  expect(database.marketDatabaseStatus()).toMatchObject({location:'B',version:'1',initialized:true})
  checks.push({name:'bounded-reads',rows:rows.length,phase2StoredReadQueries:1,phase3StoredReadQueries:1,phase2WarmClosesQueries:2,phase3WarmClosesQueries:closeReads.length,storedReadRows:storedReads[0].rows,storedPayloadBytes:storedReads[0].bytes,warmCloseRows:closeReads.reduce((n,r)=>n+r.rows,0),warmClosePayloadBytes:closeReads.reduce((n,r)=>n+r.bytes,0)})
 })
 it('shares automatic budgets and completion evidence in A exactly once while data/session metadata live in B',async()=>{
  const automatic=await import('../automatic-candles')
  await core.query('TRUNCATE automatic_candle_fetch,automatic_candle_budget,automatic_provider_day')
  const attempts=await Promise.allSettled([automatic.reserveAutomaticCandles('yahoo|aktien|BUDGET|1h'),automatic.reserveAutomaticCandles('yahoo|aktien|BUDGET|1h'),automatic.reserveAutomaticCandles('yahoo|aktien|BUDGET|1h')])
  expect(attempts.filter(r=>r.status==='fulfilled')).toHaveLength(1)
  expect((await core.query('SELECT attempts FROM automatic_candle_budget')).rows[0].attempts).toBe(1)
  const first=await store.getStoredCandles('TEST','aktien','1h',{forceRefresh:true,requireFresh:true,automatic:true,provider:'yahoo',limit:1})
  const calls=provider.mock.calls.length
  // Deterministic clock-skew counterexample: completion must beat a stale lease.
  await core.query("UPDATE automatic_candle_fetch SET \"leaseUntil\"=now()+interval '1 second' WHERE \"completedAt\" IS NOT NULL")
  const second=await store.getStoredCandles('TEST','aktien','1h',{forceRefresh:true,requireFresh:true,automatic:true,provider:'yahoo',limit:1})
  expect(second).toEqual(first);expect(provider.mock.calls).toHaveLength(calls)
  expect((await market.query("SELECT tablename FROM pg_tables WHERE tablename LIKE 'automatic_%'")).rows).toEqual([])
  checks.push({name:'shared-budget-and-idempotent-fetch',providerCalls:calls})
 })
 it('exhausts only B pool and bounds its waiting time while A continues saving',async()=>{
  const {sql}=await import('drizzle-orm')
  const sleepers=Array.from({length:3},()=>database.marketDb.execute(sql`SELECT pg_sleep(3.5)`))
  const running=sleepers.map(p=>Promise.resolve(p))
  for(let i=0;i<100&&database.marketDatabaseStatus().total!==3;i++)await new Promise(r=>setTimeout(r,20))
  await new Promise(r=>setTimeout(r,100))
  const start=Date.now()
  const waiting=Promise.resolve(database.marketDb.execute(sql`SELECT 1`))
  await personal.db.execute(sql`INSERT INTO phase3_personal_probe(id,note) VALUES(1,'Synthetic during pool exhaustion') ON CONFLICT(id) DO UPDATE SET note=excluded.note`)
  await expect(waiting).rejects.toThrow()
  const elapsed=Date.now()-start;expect(elapsed).toBeLessThan(3400)
  await Promise.all(running)
  expect((await personal.db.execute(sql`SELECT count(*)::int n FROM phase3_personal_probe`)).rows[0].n).toBe(1)
  checks.push({name:'pool-exhaustion-isolation',elapsedMs:elapsed,max:3})
 })
 it('times out a real B statement, then permits an explicit retry without damaging A',async()=>{
  const {sql}=await import('drizzle-orm'),start=Date.now()
  await expect(database.marketDb.execute(sql`SELECT pg_sleep(8)`)).rejects.toThrow()
  const elapsed=Date.now()-start;expect(elapsed).toBeLessThan(6000)
  expect(await store.readStoredCandles('TEST','1h',{limit:1})).toHaveLength(1)
  await personal.db.execute(sql`UPDATE phase3_personal_probe SET note='Synthetic saved after timeout' WHERE id=1`)
  checks.push({name:'statement-timeout-retry',elapsedMs:elapsed})
 })
 it('B connection loss never falls back to A or invokes a provider; A saves and B recovers on retry',async()=>{
  const {sql}=await import('drizzle-orm'),calls=provider.mock.calls.length
  await admin.query('ALTER DATABASE phase3_market ALLOW_CONNECTIONS false')
  await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='phase3_market' AND application_name='tracker-market-v1'")
  try {
   await expect(store.getStoredCandles('TEST','aktien','1h',{limit:1,requireFresh:true})).rejects.toThrow()
   await personal.db.execute(sql`UPDATE phase3_personal_probe SET note='Synthetic saved while B unavailable' WHERE id=1`)
   expect(provider.mock.calls).toHaveLength(calls)
  }finally{await admin.query('ALTER DATABASE phase3_market ALLOW_CONNECTIONS true')}
  expect(await store.readStoredCandles('TEST','1h',{limit:1})).toHaveLength(1)
  checks.push({name:'B-loss-A-save-recovery'})
 })
 it('A connection loss cannot fabricate budgets or completion but B stored reads remain available',async()=>{
  const {sql}=await import('drizzle-orm')
  await personal.db.execute(sql`SELECT 1`)
  await admin.query('ALTER DATABASE phase3_core ALLOW_CONNECTIONS false')
  await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='phase3_core' AND application_name='tracker-core'")
  try {
   await expect(personal.db.execute(sql`SELECT 1`)).rejects.toThrow()
   expect(await store.readStoredCandles('TEST','1h',{limit:1})).toHaveLength(1)
   const automatic=await import('../automatic-candles')
   await expect(automatic.reserveAutomaticCandles('yahoo|aktien|NOCORE|1h')).rejects.toThrow()
  }finally{await admin.query('ALTER DATABASE phase3_core ALLOW_CONNECTIONS true')}
  expect((await personal.db.execute(sql`SELECT 1 n`)).rows[0].n).toBe(1)
  checks.push({name:'A-loss-B-read-no-false-budget'})
 })
 it('serves the trainer getter, bot twin and MAE/MFE from the same B series with no duplicate reload',async()=>{
  const {createCandleLoader}=await import('./candle-loader'),{simulateTrade}=await import('../bot-twin'),{computeExcursion}=await import('../excursion')
  const load=createCandleLoader(),calls=provider.mock.calls.length
  const rows=await load('TEST','aktien','1h');expect(Array.isArray(rows)).toBe(true)
  if(!Array.isArray(rows))throw Error('missing synthetic rows')
  expect(await load('TEST','aktien','1h')).toBe(rows)
  expect(provider.mock.calls).toHaveLength(calls)
  const from=rows[0].time,to=rows.at(-1)!.time
  expect(simulateTrade({id:1,ticker:'TEST',direction:'long',entryPrice:100,stopLoss:90,takeProfit:130,quantity:1,fees:0,plannedRisk:10,fromSec:from},rows).simulated).toBe(true)
  expect(computeExcursion({direction:'long',entryPrice:100,riskDistance:10,fromSec:from,toSec:to},rows).measured).toBe(true)
  expect(await store.getStoredCandles('TEST','aktien','1h',{limit:5})).toHaveLength(5)
  checks.push({name:'trainer-bot-excursion-shared-series',rows:rows.length,duplicateProviderCalls:0})
 })
 it('drains an in-flight legacy writer before fencing, blocks later writes, and leaves personal data writable',async()=>{
  const {setMarketWritable}=await import('../../scripts/market-migration.mjs')
  const writer=new Client({connectionString:base+'phase3_market'});await writer.connect();await writer.query('BEGIN');await writer.query('INSERT INTO candle_collect_run DEFAULT VALUES')
  let fenced=false;const freeze=setMarketWritable(market,false).then(()=>{fenced=true})
  await new Promise(r=>setTimeout(r,150));expect(fenced).toBe(false)
  await writer.query('COMMIT');await freeze
  await expect(writer.query('INSERT INTO candle_collect_run DEFAULT VALUES')).rejects.toThrow('schreibgeschützt')
  await core.query("UPDATE phase3_personal_probe SET note='Synthetic during fenced market' WHERE id=1")
  await setMarketWritable(market,true);await writer.end()
  checks.push({name:'real-concurrent-fence-drains-legacy-writers'})
 })
 it('simulates a complete demo exit using B candles while personal events/settlement stay atomic in A',async()=>{
  await core.query('DELETE FROM trade_event WHERE "tradeId"=900');await core.query('DELETE FROM trade WHERE id=900')
  const start=Date.parse('2026-10-02T10:00:00Z')/1000
  await core.query(`INSERT INTO trade(id,"userId","portfolioId","stockId",ticker,market,status,direction,"entryPrice","stopLoss","takeProfit","positionSize","openedAt","createdAt","quoteCurrency","accountCurrency","quoteToAccountRate","feeEntry","feeExit")
   VALUES(900,'phase3-synthetic',1,1,'FIBQA-S','aktien','aktiv','long',100,95,120,100,$1,$1,'USD','USD',1,0,0) ON CONFLICT(id) DO NOTHING`,[new Date(start*1000).toISOString()])
  await core.query(`INSERT INTO trade_event("tradeId","userId",type,at,quantity,price,fee) VALUES(900,'phase3-synthetic','eroeffnet',$1,100,100,0)`,[new Date(start*1000).toISOString()])
  await market.query(`INSERT INTO candle_cache(symbol,interval,time,open,high,low,close,volume) VALUES
   ('TEST','5min',$1,105,106,104,105,1),('TEST','5min',$2,105,106,104,105,1),('TEST','5min',$3,105,122,104,121,1)
   ON CONFLICT(symbol,interval,time) DO NOTHING`,[start-300,start,start+300])
  await market.query(`INSERT INTO candle_series(symbol,interval,"fetchedAt","executionSession") VALUES('TEST','5min',now(),NULL) ON CONFLICT(symbol,interval) DO UPDATE SET "fetchedAt"=now()`)
  const {runDemoFills}=await import('../demo-run')
  const opts={userId:'phase3-synthetic',portfolioId:1,tradeId:900,refresh:false,maxMs:12000,asOf:(start+900)*1000}
  const dry=await runDemoFills({...opts,trocken:true})
  expect(dry.error).toBeNull();expect(dry.abschluesse,JSON.stringify(dry)).toBe(1)
  expect((await core.query('SELECT status FROM trade WHERE id=900')).rows[0].status).toBe('aktiv')
  const result=await runDemoFills(opts)
  expect(result.error).toBeNull();expect(result.abschluesse).toBe(1)
  expect((await core.query('SELECT status,result FROM trade WHERE id=900')).rows[0]).toMatchObject({status:'abgeschlossen',result:'gewinn'})
  const events=(await core.query('SELECT count(*)::int n FROM trade_event WHERE "tradeId"=900')).rows[0].n
  expect((await runDemoFills(opts)).abschluesse).toBe(0)
  expect((await core.query('SELECT count(*)::int n FROM trade_event WHERE "tradeId"=900')).rows[0].n).toBe(events)
  expect((await market.query("SELECT tablename FROM pg_tables WHERE tablename IN ('trade','trade_event','portfolio')")).rows).toEqual([])
  checks.push({name:'synthetic-demo-close-idempotent-A-events-B-evidence',events,noBrokerCalls:true})
 })

 it('serializes real migration sessions, holds fences throughout verification and preserves sequence gaps',async()=>{
  for(const name of ['phase3_migration_a','phase3_migration_b']){
   if(!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rows.length)await admin.query('CREATE DATABASE '+name)
  }
  const a=new Client({connectionString:base+'phase3_migration_a'}),b=new Client({connectionString:base+'phase3_migration_b'})
  const otherA=new Client({connectionString:base+'phase3_migration_a'}),otherB=new Client({connectionString:base+'phase3_migration_b'})
  const {setMarketWritable,copyMarketPackages}=await import('../../scripts/market-migration.mjs')
  await Promise.all([a.connect(),b.connect(),otherA.connect(),otherB.connect()])
  try {
   for(const client of [a,b]){
    for(const f of ['0001_market.sql','0002_control.sql'])await client.query(readFileSync('drizzle-market/'+f,'utf8'))
    await setMarketWritable(client,true);await client.query('TRUNCATE candle_cache,candle_series,candle_collect_run,market_migration_package RESTART IDENTITY')
   }
   await a.query("INSERT INTO candle_cache SELECT 'REALCOPY','1h',i,1,2,0,1,1 FROM generate_series(1,1001)i")
   await a.query("INSERT INTO candle_series(symbol,interval,\"candleCount\") VALUES('REALCOPY','1h',1001)")
   await a.query("INSERT INTO candle_collect_run DEFAULT VALUES;SELECT setval('candle_collect_run_id_seq',50,true)")
   await setMarketWritable(a,false);await setMarketWritable(b,false)
   let entered!:()=>void,release!:()=>void,unfrozen=false
   const enteredPromise=new Promise<void>(r=>entered=r),releasePromise=new Promise<void>(r=>release=r)
   const copy=copyMarketPackages(a,b,'real-lock',{afterPackage:async(n:number)=>{if(n===1){entered();await releasePromise}}})
   await enteredPromise
   await expect(copyMarketPackages(otherB,otherA,'competing-reverse')).rejects.toThrow('aktiv')
   const unfreeze=setMarketWritable(otherB,true).then(()=>{unfrozen=true})
   await new Promise(r=>setTimeout(r,100));expect(unfrozen).toBe(false)
   release();const result=await copy;await unfreeze
   expect(result.copied).toBe(2);expect(result.rows).toBe(1003)
   expect((await b.query('INSERT INTO candle_collect_run DEFAULT VALUES RETURNING id')).rows[0].id).toBe(51)
   checks.push({name:'real-migration-exclusive-session-resume-safety',...result,sequenceNextId:51})
  }finally{await Promise.allSettled([a.end(),b.end(),otherA.end(),otherB.end()])}
 })

})
