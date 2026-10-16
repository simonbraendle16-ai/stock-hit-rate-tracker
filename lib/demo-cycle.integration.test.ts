import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { AsyncLocalStorage } from 'node:async_hooks'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import * as schema from './db/schema'
import { NextRequest } from 'next/server'

const state=vi.hoisted(()=>({ database:null as any, collect:vi.fn(),failAfterBook:false,processErrors:0,receipt:true,advance:0 }))
vi.mock('@/lib/db',()=>({get db(){return state.database},inDatabaseTransaction:async(fn:()=>Promise<unknown>)=>state.database.transaction(fn),withDatabaseDeadline:async(_deadline:number,fn:()=>Promise<unknown>)=>fn()}))
vi.mock('@/lib/market-data/cached',()=>({getCachedCandles:async(symbol:string,_market:string,_interval:string,opts:any)=>{
  if(!opts.storedOnly){await state.collect(symbol,opts);vi.setSystemTime(Date.now()+state.advance);return Object.assign([],{...(state.receipt?{automaticProof:{key:`${opts.provider}|${_market}|${symbol}|5min`,completedAt:new Date().toISOString()}}:{})})}
  const {sql}=await import('drizzle-orm')
  const rows=await state.database.execute(sql`SELECT * FROM candle_cache WHERE symbol=${symbol} AND interval='5min' AND time>=${opts.since??0} ORDER BY time LIMIT ${opts.limit}`)
  return rows.rows
}}))
vi.mock('@/lib/market-data/candle-store',()=>({
  readStoredCandles:async(symbol:string,_interval:string,opts:any)=>{
    const {sql}=await import('drizzle-orm')
    const rows=await state.database.execute(sql`SELECT * FROM candle_cache WHERE symbol=${symbol} AND interval='5min' AND time<${opts.before} ORDER BY time DESC LIMIT ${opts.limit}`)
    return rows.rows.reverse()
  },pruneStoredCandles:vi.fn(async()=>0),
}))
import { runDemoCycle, readDemoCycle } from './demo-cycle'
import { runDemoFills } from './demo-run'
import { reserveAutomaticCandles, finishAutomaticCandles } from './automatic-candles'
import { GET } from '../app/api/cron/demo-cycle/route'

let pg:PGlite,base:number
const scope={userId:'isolated',portfolioId:1}
beforeAll(async()=>{
  pg=new PGlite()
  await pg.exec("SET TIME ZONE 'UTC'")
  const database=drizzle(pg,{schema}),ambient=new AsyncLocalStorage<any>()
  state.database=new Proxy(database,{get(target,key){
    const active=ambient.getStore()??target
    if(key==='transaction')return (fn:any)=>active.transaction((tx:any)=>ambient.run(tx,()=>fn(tx)))
    const v=Reflect.get(active,key)
    if(key==='execute')return(q:any)=>{
      const query=new PgDialect().sqlToQuery(q)
      if(state.processErrors>0&&query.sql.includes('FROM demo_cycle_state WHERE')&&query.sql.includes('FOR SHARE')){state.processErrors--;throw new Error('isolated SQL read error before booking')}
      if(state.failAfterBook&&query.sql.includes('SET phase=')&&query.params.some((p:any)=>typeof p==='string'&&p.includes('"status":"booked"'))){state.failAfterBook=false;throw new Error('isolated crash after booking')}
      return v.call(active,q)
    }
    return typeof v==='function'?v.bind(active):v
  }})
  const dialect=new PgDialect()
  for(const table of [schema.portfolio,schema.trade,schema.stock,schema.tradeEvent,schema.tradeTarget,schema.brokerOrder,schema.cashflow,schema.userSettings,schema.candleCache,schema.candleSeries]){
    const c=getTableConfig(table)
    const columns=c.columns.map(col=>{
      const v=col.default
      const def=v===undefined?'':' DEFAULT '+(typeof v==='string'?`'${v.replaceAll("'","''")}'`:typeof v==='number'||typeof v==='boolean'?String(v):dialect.sqlToQuery(v as any).sql)
      return `"${col.name}" ${col.getSQLType()}${col.primary?' PRIMARY KEY':''}${def}`
    })
    for(const pk of c.primaryKeys)columns.push(`PRIMARY KEY (${pk.columns.map(x=>`"${x.name}"`).join(',')})`)
    await pg.exec(`CREATE TABLE "${c.name}" (${columns.join(',')})`)
  }
  await pg.exec(`INSERT INTO portfolio(id,"userId",name,kind,currency) VALUES(9,'legacy','Untouched','demo','USD');INSERT INTO trade(id,"userId","portfolioId",ticker,"entryPrice")VALUES(99,'legacy',9,'LEGACY',123.45)`)
  const migration=readFileSync(new URL('../drizzle/0055_demo_cycle.sql',import.meta.url),'utf8')
  await pg.exec(migration);await pg.exec(migration)
  expect((await pg.query(`SELECT "entryPrice" FROM trade WHERE id=99`)).rows).toEqual([{entryPrice:123.45}])
},30000)
afterAll(async()=>{await pg?.close()})
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllEnvs()})
beforeEach(async()=>{
  state.collect.mockReset().mockResolvedValue(undefined);state.advance=0;state.failAfterBook=false;state.processErrors=0;state.receipt=true
  base=Math.floor(Date.now()/300_000)*300
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime((base+300)*1000)
  await pg.exec(`TRUNCATE demo_cycle_tick,demo_cycle_state,automatic_candle_fetch,automatic_candle_budget,automatic_provider_day,portfolio,trade,stock,trade_event,trade_target,broker_order,candle_cache CASCADE;
    INSERT INTO portfolio(id,"userId",name,kind,currency)VALUES(1,'isolated','Demo','demo','USD'),(2,'other','Other','demo','USD'),(3,'isolated','Live','echtgeld','USD');
    INSERT INTO stock(id,"userId",ticker,name,market,provider,"providerSymbol","resolutionStatus","resolutionApproximate","resolvedCurrency")VALUES(1,'isolated','TEST','Test','krypto','binance','TESTUSDT','ok',false,'USD');
    INSERT INTO trade(id,"userId","portfolioId","stockId",ticker,market,"tradeKind",status,direction,"entryPrice","stopLoss","takeProfit","positionSize","quoteCurrency","accountCurrency","quoteToAccountRate","openedAt","createdAt","demoBoundaryAt")VALUES
    (1,'isolated',1,1,'TEST','krypto','schnell','aktiv','long',100,95,120,100,'USD','USD',1,to_timestamp(${base-600}),to_timestamp(${base-900}),to_timestamp(${base-600})),
    (2,'other',2,1,'OTHER','krypto','schnell','aktiv','long',100,95,120,100,'USD','USD',1,to_timestamp(${base-600}),to_timestamp(${base-900}),to_timestamp(${base-600}));
    INSERT INTO trade_event("userId","tradeId",type,at,quantity,price)VALUES('isolated',1,'eroeffnet',to_timestamp(${base-600}),100,100);
    INSERT INTO trade_target("userId","tradeId","sortOrder",price,"sharePct")VALUES('isolated',1,0,110,40),('isolated',1,1,120,60);
    INSERT INTO candle_cache(symbol,interval,time,open,high,low,close,volume)VALUES
    ('TESTUSDT','5min',${base-900},100,101,99,100,1),('TESTUSDT','5min',${base-600},100,112,99,111,1),('TESTUSDT','5min',${base-300},111,122,110,121,1),('TESTUSDT','5min',${base},121,122,120,121,1);
    INSERT INTO demo_cycle_state("portfolioId","userId",enabled)VALUES(1,'isolated',true);`)
})

describe('Persistierter eigener Demozyklus auf isoliertem PostgreSQL',()=>{
  it('unterscheidet einen verspäteten Kursrand von einer inneren Lücke ohne volle Abdeckung zu behaupten',async()=>{
    await pg.exec(`UPDATE candle_cache SET open=100,high=101,low=99,close=100;`)
    vi.setSystemTime((base+1200)*1000)
    expect(await runDemoCycle(scope)).toMatchObject({completed:true,blocked:0})
    expect((await readDemoCycle(scope))?.results['1']).toMatchObject({
      status:'awaiting-data',bookings:0,checkedAt:new Date((base+300)*1000).toISOString(),
      requiredUntil:new Date((base+1200)*1000).toISOString(),sourceFetchedAt:expect.any(String),
    })
    expect((await pg.query<any>(`SELECT "demoIssue" FROM trade WHERE id=1`)).rows[0].demoIssue).toBeNull()
    expect((await pg.query(`SELECT id FROM trade_event WHERE "tradeId"=1`)).rows).toHaveLength(1)
  })
  it('hält eine echte innere Lücke gesperrt und setzt nach Originalnachlieferung ohne Doppelbuchung fort',async()=>{
    await pg.exec(`UPDATE candle_cache SET open=100,high=101,low=99,close=100;DELETE FROM candle_cache WHERE time=${base-300};`)
    expect(await runDemoCycle(scope)).toMatchObject({completed:true,blocked:1})
    expect((await readDemoCycle(scope))?.results['1']).toMatchObject({status:'blocked',checkedAt:new Date((base-300)*1000).toISOString()})
    expect((await readDemoCycle(scope))?.results['1'].reason).toContain('Lücke')
    state.collect.mockImplementationOnce(async(_symbol,opts)=>{
      expect(opts.since).toBeLessThanOrEqual(base-300)
      await pg.exec(`INSERT INTO candle_cache(symbol,interval,time,open,high,low,close,volume)VALUES('TESTUSDT','5min',${base-300},100,101,99,100,1)`)
    })
    await pg.exec(`UPDATE demo_cycle_state SET "nextRunAt"='epoch'`)
    expect(await runDemoCycle(scope)).toMatchObject({completed:true,blocked:0})
    expect((await readDemoCycle(scope))?.results['1']).toMatchObject({status:'checked',checkedAt:new Date((base+300)*1000).toISOString()})
    expect((await pg.query<any>(`SELECT "demoIssue" FROM trade WHERE id=1`)).rows[0].demoIssue).toBeNull()
    expect(await runDemoCycle(scope)).toMatchObject({processed:false})
    expect((await pg.query(`SELECT id FROM trade_event WHERE "tradeId"=1`)).rows).toHaveLength(1)
    expect(state.collect).toHaveBeenCalledTimes(2)
  })
  it('wertet einen ungeordneten Live-Kurspunkt nicht als abgeschlossene Kerze am verzögerten Rand',async()=>{
    await pg.exec(`UPDATE candle_cache SET open=100,high=101,low=99,close=100;INSERT INTO candle_cache(symbol,interval,time,open,high,low,close,volume)VALUES('TESTUSDT','5min',${base+37},100,200,1,100,1)`)
    vi.setSystemTime((base+900)*1000)
    expect(await runDemoCycle(scope)).toMatchObject({completed:true,blocked:0})
    expect((await readDemoCycle(scope))?.results['1']).toMatchObject({status:'awaiting-data',bookings:0,checkedAt:new Date((base+300)*1000).toISOString()})
    expect((await pg.query(`SELECT id FROM trade_event WHERE "tradeId"=1`)).rows).toHaveLength(1)
  })
  it('bucht Teilziel und Abschluss einmal, mit Provenienz; fremdes Depot bleibt unverändert',async()=>{
    const report=await runDemoCycle(scope)
    expect(report,JSON.stringify(await readDemoCycle(scope))).toMatchObject({completed:true,blocked:0})
    const events=(await pg.query<any>(`SELECT * FROM trade_event WHERE "tradeId"=1 ORDER BY id`)).rows
    expect(events.map(e=>[e.type,e.quantity,e.price])).toEqual([['eroeffnet',100,100],['teilverkauf',40,110],['geschlossen',60,120]])
    expect(JSON.parse(events[1].payload)).toMatchObject({cycleId:(report as any).cycleId,kursquelle:{provider:'binance',symbol:'TESTUSDT'},tradeVersion:1})
    expect((await pg.query<any>(`SELECT status FROM trade WHERE id=2`)).rows[0].status).toBe('aktiv')
    expect(await runDemoCycle(scope)).toMatchObject({processed:false})
    expect((await pg.query(`SELECT id FROM trade_event WHERE "tradeId"=1`)).rows).toHaveLength(3)
    expect(state.collect).toHaveBeenCalledTimes(1)
    const tick=(await pg.query<any>(`SELECT report FROM demo_cycle_tick WHERE outcome='completed'`)).rows[0].report
    expect(tick.results['1']).toMatchObject({status:'booked',bookings:2})
    expect(tick.cutoff).toBe(new Date((base+300)*1000).toISOString())
  })
  it('setzt nach Laufzeitgrenze mit derselben Sammlung fort, ohne neuen Abruf',async()=>{
    state.advance=30_000
    expect(await runDemoCycle(scope)).toMatchObject({completed:false})
    expect((await readDemoCycle(scope))?.work).toHaveProperty('pending',[1])
    expect(state.collect).toHaveBeenCalledTimes(1)
    state.advance=0
    expect(await runDemoCycle(scope)).toMatchObject({completed:true})
    expect(state.collect).toHaveBeenCalledTimes(1)
  })
  it('überspringt eine aktive Lease und verarbeitet nach ihrem Ablauf sicher weiter',async()=>{
    await pg.exec(`UPDATE demo_cycle_state SET "leaseUntil"=now()+interval '90 seconds'`)
    expect(await runDemoCycle(scope)).toMatchObject({processed:false})
    expect(state.collect).not.toHaveBeenCalled()
    await pg.exec(`UPDATE demo_cycle_state SET "leaseUntil"='epoch'`)
    expect(await runDemoCycle(scope)).toMatchObject({completed:true})
  })
  it('überlappende Aufrufe verarbeiten denselben Depotzyklus nur einmal',async()=>{
    const reports=await Promise.all([runDemoCycle(scope),runDemoCycle(scope)])
    expect(reports.filter(r=>r.processed)).toHaveLength(1)
    expect(state.collect).toHaveBeenCalledTimes(1)
    expect((await pg.query(`SELECT id FROM trade_event WHERE "tradeId"=1`)).rows).toHaveLength(3)
  })
  it('kennzeichnet manuelle Wiederherstellung getrennt und erfindet keinen automatischen Aufruf',async()=>{
    await runDemoCycle(scope,'manual')
    expect((await readDemoCycle(scope))?.lastAutomaticAt).toBeNull()
    expect((await pg.query<any>(`SELECT trigger,outcome FROM demo_cycle_tick`)).rows).toEqual([{trigger:'manual',outcome:'completed'}])
  })
  it('führt nach einem Absturz zwischen Buchung und Fortschrittsmeldung kein Ziel doppelt aus',async()=>{
    // Stop after the trade transaction committed, before the cycle result saved.
    state.failAfterBook=true
    await expect(runDemoCycle(scope)).rejects.toThrow('isolated crash')
    expect(await runDemoCycle(scope)).toMatchObject({completed:true})
    expect((await pg.query(`SELECT id FROM trade_event WHERE "tradeId"=1`)).rows).toHaveLength(3)
    expect((await readDemoCycle(scope))?.results['1']).toMatchObject({status:'booked',bookings:2})
  })
  it('hält fehlgeschlagene Quellen sichtbar und lässt keine Ausführung aus alten Daten zu',async()=>{
    state.collect.mockRejectedValue(new Error('isolated provider offline'))
    expect(await runDemoCycle(scope)).toMatchObject({completed:false,blocked:1})
    expect((await pg.query(`SELECT id FROM trade_event`)).rows).toHaveLength(1)
    expect((await readDemoCycle(scope))?.results['1'].reason).toContain('offline')
    const first=(await readDemoCycle(scope))?.cycleId
    vi.setSystemTime(Date.now()+301_000);state.collect.mockResolvedValue(undefined)
    expect(await runDemoCycle(scope)).toMatchObject({completed:true,cycleId:first})
    expect(state.collect).toHaveBeenCalledTimes(2)
  })
  it('behauptet ohne Quellenbeleg keinen erfolgreichen Abruf und bucht nicht aus gespeichertem Altbestand',async()=>{
    state.receipt=false
    expect(await runDemoCycle(scope)).toMatchObject({completed:false,blocked:1})
    expect((await readDemoCycle(scope))?.results['1'].reason).toContain('Quellenbeleg')
    expect((await pg.query(`SELECT id FROM trade_event`)).rows).toHaveLength(1)
  })
  it('setzt einen Verarbeitungsfehler vor Buchung gezielt fort, ohne die Sammlung zu wiederholen',async()=>{
    state.processErrors=1
    expect(await runDemoCycle(scope)).toMatchObject({completed:false,pending:1})
    expect((await pg.query(`SELECT id FROM trade_event WHERE "tradeId"=1`)).rows).toHaveLength(1)
    expect(await runDemoCycle(scope)).toMatchObject({completed:true,blocked:0})
    expect(state.collect).toHaveBeenCalledTimes(1)
    expect((await pg.query(`SELECT id FROM trade_event WHERE "tradeId"=1`)).rows).toHaveLength(3)
  })
  it('lässt einen dauerhaften Einzelfehler nach drei Versuchen nicht den nächsten Stundenzyklus aufhalten',async()=>{
    state.processErrors=3
    expect(await runDemoCycle(scope)).toMatchObject({completed:false})
    expect(await runDemoCycle(scope)).toMatchObject({completed:false})
    expect(await runDemoCycle(scope)).toMatchObject({completed:true,blocked:1})
    expect((await readDemoCycle(scope))?.results['1'].reason).toContain('isolated SQL')
    expect(state.collect).toHaveBeenCalledTimes(1)
    expect((await pg.query(`SELECT id FROM trade_event WHERE "tradeId"=1`)).rows).toHaveLength(1)
  })
  it('verweigert falschen Besitzer, Echtgeld und nicht aktivierten Umfang',async()=>{
    await expect(runDemoCycle({userId:'other',portfolioId:1})).rejects.toThrow()
    await pg.exec(`UPDATE portfolio SET kind='echtgeld' WHERE id=1`)
    await expect(runDemoCycle(scope)).rejects.toThrow()
    expect(state.collect).not.toHaveBeenCalled()
  })
  it('verwirft einen ungedeckten Einstieg mit klarem Grund und ohne erfundenen Fill',async()=>{
    await pg.exec(`UPDATE trade SET status='geplant',contracts=1,"contractCurrency"='USD',"investedAmount"=100000 WHERE id=1;
      UPDATE portfolio SET "startCapital"=100 WHERE id=1;DELETE FROM trade_event WHERE "tradeId"=1;`)
    expect(await runDemoCycle(scope)).toMatchObject({completed:true,blocked:1})
    const result=(await readDemoCycle(scope))?.results['1']
    expect(result).toMatchObject({status:'blocked',bookings:0})
    expect(result?.reason).toMatch(/Deckung|Einschuss|Kapital/)
    const events=(await pg.query<any>(`SELECT type,quantity,payload FROM trade_event WHERE "tradeId"=1`)).rows
    expect(events).toHaveLength(1);expect(events[0].quantity).toBe(0)
    expect(JSON.parse(events[0].payload)).toMatchObject({grund:'ungedeckt',cycleId:expect.any(String)})
    expect((await pg.query<any>(`SELECT status FROM trade WHERE id=1`)).rows[0].status).toBe('abgebrochen')
  })
  it('schließt aktivierte eigene Depots im alten Zeitgeber aus',async()=>{
    const report=await runDemoFills({legacyScheduled:true})
    expect(report.tradesGeprueft).toBe(1) // only the other user's eligible trade
    expect((await pg.query(`SELECT id FROM trade_event WHERE "tradeId"=1`)).rows).toHaveLength(1)
  })
  it('verweigert falsches Geheimnis, freie Depotwahl und fehlende Konfiguration',async()=>{
    vi.stubEnv('DEMO_CYCLE_SECRET','isolated-secret');vi.stubEnv('DEMO_CYCLE_USER_ID','isolated');vi.stubEnv('DEMO_CYCLE_PORTFOLIO_ID','1')
    const request=(tail:string,secret='isolated-secret')=>new NextRequest('https://example.invalid/api/cron/demo-cycle'+tail,{headers:{authorization:'Bearer '+secret}})
    expect((await GET(request('','wrong'))).status).toBe(401)
    expect((await GET(request('?portfolioId=2'))).status).toBe(400)
    expect((await GET(request('?force=1'))).status).toBe(400)
    vi.stubEnv('DEMO_CYCLE_USER_ID','')
    expect((await GET(request(''))).status).toBe(503)
  })
})

describe('Gemeinsame Abrufreservation',()=>{
  it('teilt Erfolge und Budgets zwischen Aufrufern; Wiederholung und Parallelität buchen keinen zweiten Abruf',async()=>{
    const key='yahoo|aktien|TEST|5min'
    const first=await reserveAutomaticCandles(key,100)
    expect(first.reused).toBe(false)
    await expect(reserveAutomaticCandles(key,100)).rejects.toThrow('bereits gesammelt')
    await finishAutomaticCandles(key,first.token!,null)
    expect((await reserveAutomaticCandles(key,200)).reused).toBe(true)
    expect((await pg.query<any>('SELECT attempts FROM automatic_candle_budget')).rows[0].attempts).toBe(1)
    await expect(reserveAutomaticCandles(key,50)).rejects.toThrow('ältere')
  })
  it('verweigert mehr als 150 automatische Versuche pro Stunde',async()=>{
    await reserveAutomaticCandles('yahoo|aktien|FIRST|5min')
    await pg.exec('UPDATE automatic_candle_budget SET attempts=150')
    await expect(reserveAutomaticCandles('yahoo|aktien|NEXT|5min')).rejects.toThrow('Abrufbudget')
  })
  it('lässt Archivabrufe die letzten Plätze eines fälligen eigenen Zyklus nicht verbrauchen',async()=>{
    await reserveAutomaticCandles('yahoo|aktien|FIRST|1day',undefined,'archive')
    await pg.exec('UPDATE automatic_candle_budget SET attempts=140')
    await expect(reserveAutomaticCandles('yahoo|aktien|ARCHIVE|1day',undefined,'archive')).rejects.toThrow('Demozyklus')
    expect((await reserveAutomaticCandles('yahoo|aktien|LIVE|5min')).reused).toBe(false)
    await pg.exec(`UPDATE demo_cycle_state SET "nextRunAt"=now()+interval '1 hour'`)
    expect((await reserveAutomaticCandles('yahoo|aktien|ARCHIVE|1day',undefined,'archive')).reused).toBe(false)
  })
  it('begrenzt fehlgeschlagene Wiederholungen einschließlich abgebrochenem Abruf auf drei Versuche',async()=>{
    const key='yahoo|aktien|RETRY|5min'
    const first=await reserveAutomaticCandles(key)
    // A dead process never wrote completedAt/error; its reservation still counts.
    await pg.exec(`UPDATE automatic_candle_fetch SET "leaseUntil"='epoch',"attemptedAt"=now()-interval '6 minutes'`)
    const second=await reserveAutomaticCandles(key)
    expect(second.token).not.toBe(first.token)
    await finishAutomaticCandles(key,second.token!,'isolated failure')
    await pg.exec(`UPDATE automatic_candle_fetch SET "attemptedAt"=now()-interval '6 minutes'`)
    const third=await reserveAutomaticCandles(key)
    await finishAutomaticCandles(key,third.token!,'isolated failure')
    await pg.exec(`UPDATE automatic_candle_fetch SET "attemptedAt"=now()-interval '6 minutes'`)
    await expect(reserveAutomaticCandles(key)).rejects.toThrow('begrenzt')
    expect((await pg.query<any>('SELECT attempts FROM automatic_candle_budget')).rows[0].attempts).toBe(3)
  })
  it('hält das konkrete kostenlose Tageskontingent des Spezialanbieters ein',async()=>{
    await pg.exec(`INSERT INTO automatic_provider_day(provider,day,attempts)VALUES('twelvedata',current_date,800)`)
    await expect(reserveAutomaticCandles('twelvedata|rohstoffe|XAUUSD|5min')).rejects.toThrow('Quellenkontingent')
    expect((await pg.query<any>('SELECT attempts FROM automatic_candle_budget')).rows).toHaveLength(0)
  })
})
