import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest'
import {PGlite} from '@electric-sql/pglite'
import {drizzle} from 'drizzle-orm/pglite'
import {getTableConfig,PgDialect} from 'drizzle-orm/pg-core'
import {readFileSync,writeFileSync} from 'node:fs'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {ImportedExecutionCard} from '../components/imported-execution-card'
import {NextRequest} from 'next/server'
import * as schema from './db/schema'
const state=vi.hoisted(()=>({database:null as any,tx:null as any}))
vi.mock('@/lib/db',()=>({get db(){return state.tx??state.database},inDatabaseTransaction:async(fn:()=>Promise<unknown>)=>state.database.transaction(async(tx:any)=>{state.tx=tx;try{return await fn()}finally{state.tx=null}})}))
import {importExecution} from './execution-import-service'
import {normalizeExecutionImport,type ExecutionImport} from './execution-import'
import {tradeNetPnl,tradePlannedRisk,ratedRMultiples,computeEquityStats} from './trade-stats'
import {metricSamples,researchMetrics} from './research-metrics'
import {normalizeAssistantTradeInput} from './assistant-trade-input'
import {runDemoFills} from './demo-run'
import {hashToken} from './assistant-api'
import {POST} from '../app/api/assistant/v1/trades/import/route'

let pg:PGlite
const capturedAt='2026-11-08T12:00:00Z'
const execution:ExecutionImport={broker:'match_trader',accountFingerprint:'a'.repeat(64),positionId:'synthetic-position',closingUid:'synthetic-close',volumeLots:0.01,openTime:'2026-11-05T12:00:00Z',closeTime:'2026-11-06T12:00:00Z',openPrice:100,closePrice:90,currency:'USD',gross:-10,net:-10.06,commission:-0.06,swap:0,closeReason:'STOP_LOSS',observedStop:95,observedTarget:null}
const body=(id='synthetic-position')=>({portfolioId:1,ticker:'SYNTH.c',market:'sonstiges',direction:'long',capturedAt,execution:{...execution,positionId:id}})
beforeAll(async()=>{
  pg=new PGlite();state.database=drizzle(pg,{schema});const dialect=new PgDialect()
  for(const table of [schema.portfolio,schema.trade,schema.brokerOrder,schema.assistantApiToken]){
    const c=getTableConfig(table)
    const columns=c.columns.map(col=>{
      const v=col.default,def=v===undefined?'':' DEFAULT '+(typeof v==='string'?`'${v.replaceAll("'","''")}'`:typeof v==='number'||typeof v==='boolean'?String(v):dialect.sqlToQuery(v as any).sql)
      return `"${col.name}" ${col.getSQLType()}${col.primary?' PRIMARY KEY':''}${col.notNull?' NOT NULL':''}${def}`
    })
    await pg.exec(`CREATE TABLE "${c.name}" (${columns.join(',')})`)
  }
  await pg.exec(`CREATE UNIQUE INDEX import_identity ON trade("userId","externalRequestKey");
    INSERT INTO portfolio(id,"userId",name,kind,currency)VALUES(1,'owner','Synthetic demo','demo','USD'),(2,'other','Other owner','demo','USD'),(3,'owner','Money','echtgeld','USD');
    INSERT INTO trade("userId","portfolioId",ticker,direction,"entryPrice","stopLoss","takeProfit")VALUES('owner',1,'UNCHANGED','long',100,90,120);
    ALTER TABLE trade ALTER COLUMN "stopLoss" SET NOT NULL;
    ALTER TABLE trade ALTER COLUMN "takeProfit" SET NOT NULL;`)
  const before=await pg.query('SELECT * FROM trade')
  const sql=readFileSync(new URL('../drizzle/0061_execution_import.sql',import.meta.url),'utf8')
  await pg.exec(sql);await pg.exec(sql)
  expect((await pg.query('SELECT * FROM trade')).rows).toEqual(before.rows)
},30000)
afterAll(async()=>{await pg?.close()})
describe('outcome import without inventing an original plan',()=>{
  it('imports exact net/fees/dates, keeps risk unknown and is repeatable',async()=>{
    const first=await importExecution('owner',body())
    const again=await importExecution('owner',{...body(),capturedAt:'2026-11-08T13:00:00Z'})
    expect(first.created).toBe(true);expect(again.created).toBe(false);expect(again.row.id).toBe(first.row.id)
    const t=first.row
    expect(t.stopLoss).toBeNull();expect(t.takeProfit).toBeNull();expect(t.positionSize).toBeNull()
    expect(t.followedPlan).toBeNull();expect(t.reviewStatus).toBeNull()
    expect(t.status).toBe('abgeschlossen');expect(t.openedAt?.toISOString()).toBe('2026-11-05T12:00:00.000Z')
    const html=renderToStaticMarkup(createElement(ImportedExecutionCard,{t}))
    expect(html).toContain('Netto inkl. Kosten');expect(html).not.toContain('NaN')
    if(process.env.EXECUTION_IMPORT_PREVIEW_FILE)writeFileSync(process.env.EXECUTION_IMPORT_PREVIEW_FILE,`<!doctype html><html lang="de" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ausführungsimport – synthetische Anzeigeprüfung</title><link rel="stylesheet" href="/style.css"></head><body><main style="max-width:900px;margin:40px auto;padding:20px"><h1>Synthetischer Brokerbeleg</h1>${html}</main></body></html>`)
    expect(tradeNetPnl(t)).toBe(-10.06);expect(tradePlannedRisk(t)).toBeNaN();expect(ratedRMultiples([t])).toEqual([])
    const metrics=researchMetrics(metricSamples([t],new Map()))
    expect(metrics.demo).toBeDefined()
    expect(metricSamples([t],new Map())[0]).toMatchObject({net:-10.06,realizedR:null,plannedCRV:null})
    expect(computeEquityStats([{...t,tradedWithMoney:true}],5000).points.at(-1)?.balance).toBe(4989.94)
    await expect(importExecution('owner',{...body(),execution:{...execution,net:-11}})).rejects.toThrow()
    await expect(importExecution('owner',{...body(),direction:'short'})).rejects.toThrow('anderem Beleg')
  })
  it('records an open position without realizing floating profit',async()=>{
    const raw={...body('synthetic-open'),execution:{...execution,positionId:'synthetic-open',closingUid:null,closeTime:null,closePrice:null,closeReason:null,gross:null,net:null}}
    const {row}=await importExecution('owner',raw)
    expect(row.status).toBe('aktiv');expect(row.result).toBeNull();expect(tradeNetPnl(row)).toBeNull()
    expect(row.alertsEnabled).toBe(false)
    const report=await runDemoFills({userId:'owner',portfolioId:1,tradeId:row.id,refresh:false})
    expect(report.error).toBeNull();expect(report.tradesGeprueft).toBe(0)
  })
  it('rejects wrong owner, real-money target, inconsistent receipt and unknown input',async()=>{
    await expect(importExecution('owner',{...body(),portfolioId:2})).rejects.toThrow('USD-Demodepot')
    await expect(importExecution('owner',{...body(),portfolioId:3})).rejects.toThrow('USD-Demodepot')
    expect(()=>normalizeExecutionImport({...body(),execution:{...execution,net:0}})).toThrow('widerspricht')
    expect(()=>normalizeExecutionImport({...body(),source:'invented'})).toThrow('Unbekanntes')
  })
  it('keeps normal plan validation and SQL requirements intact',async()=>{
    expect(()=>normalizeAssistantTradeInput({portfolioId:1,ticker:'NORMAL',market:'sonstiges',tradeKind:'schnell',direction:'long',entryPrice:100,stopLoss:90,source:{kind:'user_statement',confirmedByUser:true,capturedAt}})).toThrow('Kursziel')
    await expect(pg.exec(`INSERT INTO trade("userId","portfolioId",ticker,direction,"entryPrice")VALUES('owner',1,'BAD','long',100)`)).rejects.toThrow()
  })
  it('uses actual API authentication and ownership before importing',async()=>{
    const token='sat_'+'t'.repeat(43),readToken='sat_'+'r'.repeat(43)
    await state.database.insert(schema.assistantApiToken).values([
      {userId:'owner',name:'Synthetic write',tokenHash:hashToken(token),scopes:['trades:read','trades:write']},
      {userId:'owner',name:'Synthetic read',tokenHash:hashToken(readToken),scopes:['trades:read']},
    ])
    const request=(auth?:string)=>new NextRequest('http://localhost/api/assistant/v1/trades/import',{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:`Bearer ${auth}`}:{})},body:JSON.stringify(body('route-synthetic'))})
    expect((await POST(request())).status).toBe(401)
    expect((await POST(request(readToken))).status).toBe(403)
    const created=await POST(request(token));expect(created.status).toBe(201)
    const response=await created.json();expect(response.userId).toBeUndefined();expect(response.externalRequestHash).toBeUndefined()
    expect((await POST(request(token))).status).toBe(200)
  })
})
