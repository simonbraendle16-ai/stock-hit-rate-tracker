import { beforeAll,afterAll,beforeEach,describe,it,expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import {copyMarketPackages,setMarketWritable} from '../../scripts/market-migration.mjs'
let a:PGlite,b:PGlite
const file=(p:string)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8')
beforeAll(async()=>{a=new PGlite();b=new PGlite()
 for(const p of [a,b]){await p.exec(file('drizzle-market/0001_market.sql'));await p.exec(file('drizzle-market/0002_control.sql'))}
 await a.exec('CREATE TABLE personal_synthetic(id integer PRIMARY KEY,note text)')
},120000)
afterAll(async()=>{await a?.close();await b?.close()})
beforeEach(async()=>{for(const p of [a,b]){await setMarketWritable(p,true);await p.exec('TRUNCATE candle_cache,candle_series,candle_collect_run,market_migration_package RESTART IDENTITY')}
 await a.exec('TRUNCATE personal_synthetic')})
async function seed(p:PGlite,symbol='TEST',count=1201){await p.query("INSERT INTO candle_cache SELECT $1,'1h',i,1,2,0,1,10 FROM generate_series(1,$2::int)i",[symbol,count]);await p.query('INSERT INTO candle_series(symbol,interval,"executionSession","candleCount","fetchedAt") VALUES($1,$2,$3::jsonb,$4,now())',[symbol,'1h',JSON.stringify({symbol,timezone:'UTC'}),count]);await p.exec('INSERT INTO candle_collect_run("seriesDue") VALUES(1)')}
describe('two isolated PostgreSQL stores: resumable preparation and reverse copy',()=>{
 it('installs only market tables, required defaults/indexes/session and serial sequence, idempotently',async()=>{
  await b.exec(file('drizzle-market/0001_market.sql'));await b.exec(file('drizzle-market/0002_control.sql'))
  const tables=(await b.query<any>("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map(r=>r.tablename)
  expect(tables.sort()).toEqual(['candle_cache','candle_collect_run','candle_series','market_data_control','market_migration_package'])
  expect((await b.query<any>("SELECT indexname FROM pg_indexes WHERE tablename='candle_series'")).rows.map(r=>r.indexname)).toContain('candle_series_stale_idx')
  await seed(b);expect((await b.query<any>('SELECT "executionSession","failCount" FROM candle_series')).rows[0]).toMatchObject({failCount:0,executionSession:{symbol:'TEST'}})
 })
 it('rejects unfenced copy and legacy/raw writers while personal saves remain possible',async()=>{
  await expect(copyMarketPackages(a,b,'unsafe')).rejects.toThrow('gesperrt')
  await setMarketWritable(a,false)
  for(const q of ["INSERT INTO candle_collect_run DEFAULT VALUES","DELETE FROM candle_cache","UPDATE candle_series SET market='x'","TRUNCATE candle_cache"])
   await expect(a.exec(q)).rejects.toThrow('schreibgeschützt')
  await a.exec("INSERT INTO personal_synthetic VALUES(1,'synthetic saved during B outage')")
  expect((await a.query<any>('SELECT count(*)::int n FROM personal_synthetic')).rows[0].n).toBe(1)
 })
 it('copies bounded pages, resumes committed packages after interruption, repairs damaged checkpoints and preserves sequence',async()=>{
  await seed(a);await seed(a,'SECOND',3);await setMarketWritable(a,false);await setMarketWritable(b,false)
  await expect(copyMarketPackages(a,b,'resume',{afterPackage:async()=>{throw Error('synthetic interruption')}})).rejects.toThrow('interruption')
  const report=await copyMarketPackages(a,b,'resume')
  expect(report.resumed).toBe(1);expect(report.copied).toBe(2);expect(report.payloadBytes).toBeGreaterThan(0)
  expect((await b.query<any>('SELECT count(*)::int n FROM candle_cache')).rows[0].n).toBe(1204)
  expect(await copyMarketPackages(a,b,'resume')).toMatchObject({copied:0,resumed:3,payloadBytes:0})
  await b.exec("BEGIN;SET LOCAL tracker.market_migration='on';DELETE FROM candle_cache WHERE symbol='TEST' AND time=1;COMMIT")
  expect((await copyMarketPackages(a,b,'resume')).copied).toBe(1)
  await setMarketWritable(b,true)
  expect((await b.query<any>('INSERT INTO candle_collect_run DEFAULT VALUES RETURNING id')).rows[0].id).toBe(3)
 })
 it('rolls back an incomplete package transaction and retries safely',async()=>{
  await seed(a);await setMarketWritable(a,false);await setMarketWritable(b,false)
  const failing={query:async(text:string,params?:any[])=>{if(text.startsWith('INSERT INTO candle_series'))throw Error('synthetic package failure');return b.query(text,params)}}
  await expect(copyMarketPackages(a,failing,'partial')).rejects.toThrow('package failure')
  expect((await b.query<any>('SELECT count(*)::int n FROM candle_cache')).rows[0].n).toBe(0)
  expect((await copyMarketPackages(a,b,'partial')).copied).toBe(2)
 })
 it('reverse-copies new, changed AND deleted target state, metadata and collect logs after cutover simulation',async()=>{
  await seed(a);await seed(a,'DELETE',2);await setMarketWritable(a,false);await setMarketWritable(b,false)
  await copyMarketPackages(a,b,'forward');await setMarketWritable(b,true)
  await b.exec("DELETE FROM candle_cache WHERE symbol='DELETE';DELETE FROM candle_series WHERE symbol='DELETE';UPDATE candle_cache SET close=7 WHERE symbol='TEST' AND time=1;UPDATE candle_series SET \"lastError\"='synthetic later correction';INSERT INTO candle_collect_run DEFAULT VALUES")
  await seed(b,'NEW',2);await setMarketWritable(b,false)
  const report=await copyMarketPackages(b,a,'rollback');expect(report.copied).toBe(4)
  expect((await a.query<any>("SELECT close FROM candle_cache WHERE symbol='TEST' AND time=1")).rows[0].close).toBe(7)
  expect((await a.query<any>("SELECT count(*)::int n FROM candle_cache WHERE symbol='DELETE'")).rows[0].n).toBe(0)
  expect((await a.query<any>("SELECT count(*)::int n FROM candle_cache WHERE symbol='NEW'")).rows[0].n).toBe(2)
  expect((await a.query<any>('SELECT count(*)::int n FROM candle_collect_run')).rows[0].n).toBe(4)
  await expect(a.exec('INSERT INTO candle_collect_run DEFAULT VALUES')).rejects.toThrow('schreibgeschützt')
 })
 it('preserves timestamp microseconds and NULL across timezones, resume and reverse copy',async()=>{
  await seed(a,'PRECISION',1)
  await a.exec(`UPDATE candle_series SET "fetchedAt"='2026-11-03 01:02:03.123456+00';UPDATE candle_collect_run SET "startedAt"='2026-11-03 01:02:03.654321+00',"finishedAt"=NULL;SET timezone='Pacific/Honolulu'`)
  await b.exec("SET timezone='Europe/Berlin'")
  const read=async(p:PGlite)=>(await p.query<any>(`SELECT extract(epoch from "startedAt")::text AS started,extract(epoch from "finishedAt")::text AS finished FROM candle_collect_run ORDER BY id`)).rows
  try{
   const before=await read(a);await setMarketWritable(a,false);await setMarketWritable(b,false)
   await copyMarketPackages(a,b,'microseconds')
   expect(await read(b)).toEqual(before)
   const seriesQuery='SELECT extract(epoch from "fetchedAt")::text AS fetched FROM candle_series'
   expect((await b.query(seriesQuery)).rows).toEqual((await a.query(seriesQuery)).rows)
   expect((await copyMarketPackages(a,b,'microseconds')).resumed).toBe(2)
   await setMarketWritable(b,true);await b.exec(`UPDATE candle_collect_run SET "startedAt"="startedAt"+interval '1 microsecond'`);await setMarketWritable(b,false)
   await copyMarketPackages(b,a,'microseconds-reverse')
   expect(await read(a)).toEqual(await read(b));expect((await read(a))[0].started.endsWith('654322')).toBe(true)
  }finally{await a.exec("SET timezone='UTC'");await b.exec("SET timezone='UTC'")}
 })

})
