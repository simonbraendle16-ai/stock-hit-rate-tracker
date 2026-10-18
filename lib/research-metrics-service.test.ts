import {beforeAll,afterAll,it,expect,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {drizzle} from "drizzle-orm/pglite";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {NextRequest} from "next/server";
const state=vi.hoisted(()=>({db:null as any}));
vi.mock("@/lib/db",()=>({get db(){return state.db}}));
import * as schema from "./db/schema";
import {loadTradeCoverage,loadMetricSamples} from "./research-metrics-service";
import {GET} from "@/app/api/assistant/v1/fibonacci/route";
import {getFibonacciData} from "@/app/actions/fibonacci";
import {loadInstrumentData} from "./instrument-data";
import {hashToken} from "./assistant-api";
vi.mock("@/lib/auth",()=>({auth:{api:{getSession:async()=>({user:{id:"qa-owner"}})}}}));
vi.mock("next/headers",()=>({headers:async()=>new Headers()}));
let pg:PGlite;
const token="sat_"+"z".repeat(43);
beforeAll(async()=>{
 pg=new PGlite();
 const sql=execFileSync(process.execPath,["node_modules/drizzle-kit/bin.cjs","export","--dialect","postgresql","--schema","./lib/db/schema.ts"],{encoding:"utf8"});
 await pg.exec(sql);
 for (const migration of ["0048_fibonacci_observations.sql","0049_fibonacci_research.sql","0050_fibonacci_history.sql","0051_fibonacci_two_hour.sql","0056_fibonacci_evidence.sql"])
   await pg.exec(readFileSync(`drizzle/${migration}`,"utf8"));
 state.db=drizzle(pg,{schema});
 await state.db.insert(schema.user).values([{id:"qa-owner",name:"Synthetic",email:"owner@example.invalid"},{id:"qa-other",name:"Other",email:"other@example.invalid"}]);
 await state.db.insert(schema.portfolio).values([{id:1,userId:"qa-owner",name:"Demo",kind:"demo"},{id:2,userId:"qa-owner",name:"Real",kind:"echtgeld"},{id:3,userId:"qa-other",name:"Foreign",kind:"demo"}]);
 await state.db.insert(schema.stock).values([{id:1,userId:"qa-owner",name:"Synthetic",ticker:"TEST",market:"aktien"},{id:2,userId:"qa-other",name:"Foreign",ticker:"FOREIGN",market:"aktien"}]);
 const base={userId:"qa-owner",stockId:1,ticker:"TEST",entryPrice:100,stopLoss:90,takeProfit:120,investedAmount:100,positionSize:1,direction:"long",status:"abgeschlossen",result:"gewinn",actualExitPrice:120,feeEntry:0,feeExit:0,quoteCurrency:"EUR",accountCurrency:"EUR",quoteToAccountRate:1};
 await state.db.insert(schema.trade).values([
  {...base,id:1,portfolioId:1,tradedWithMoney:true}, // stale field; depot wins
  {...base,id:2,portfolioId:2,tradedWithMoney:false,result:"verlust",actualExitPrice:90},
  {...base,id:3,portfolioId:3,tradedWithMoney:false}, // own trade pointing at foreign depot
  {...base,id:4,portfolioId:1,userId:"qa-other"}, // foreign trade pointing at own depot
  {...base,id:5,portfolioId:1,status:"geplant",result:null,actualExitPrice:null},
 ]);
 const obs={userId:"qa-owner",stockId:1,wave:"4",degree:"Minor",timeframe:"1d",observedOn:"2026-01-01",status:"laufend",percent:null,note:"Synthetic",measurementKind:"retracement"};
 const context="00000000-0000-4000-8000-000000000100";
 await state.db.insert(schema.fibonacciObservation).values([
  {...obs,id:"00000000-0000-4000-8000-000000000101",contextId:context,tradeId:1,evidence:{reachedLevels:[50],provenance:"Synthetic"}},
  {...obs,id:"00000000-0000-4000-8000-000000000102",contextId:context,measurementKind:"expansion",measurementBasis:"Synthetic measured expansion",tradeId:1,status:"abgeschlossen",hypotheticalOutcome:"gewinn",evidence:{hypotheticalCRV:5,provenance:"Synthetic"}},
  {...obs,id:"00000000-0000-4000-8000-000000000103",contextId:"00000000-0000-4000-8000-000000000103",tradeId:3},
  {...obs,id:"00000000-0000-4000-8000-000000000104",contextId:context,userId:"qa-other",stockId:2,tradeId:null},
 ]);
 await state.db.insert(schema.assistantApiToken).values({userId:"qa-owner",name:"Synthetic",tokenHash:hashToken(token),scopes:["trades:read"]});
},30000);
afterAll(async()=>{await pg?.close()});
it("derives kind from owned depots, exposes mismatches, excludes foreign links, and never repairs data",async()=>{
 const rows=await loadTradeCoverage("qa-owner"),samples=await loadMetricSamples("qa-owner");
 expect(rows.map(r=>r.id).sort()).toEqual([1,2,5]);
 expect(rows.find(r=>r.id===1)).toMatchObject({kind:"demo",kindMismatch:true});
 expect(rows.find(r=>r.id===2)).toMatchObject({kind:"money",kindMismatch:true});
 expect(samples.map(r=>[r.id,r.kind,r.net])).toEqual([[1,"demo",20],[2,"money",-10]]);
 expect((await pg.query('SELECT "tradedWithMoney" FROM trade WHERE id=1')).rows[0]).toEqual({tradedWithMoney:true});
 expect(await loadMetricSamples("qa-owner",[])).toEqual([]);
 expect(await loadMetricSamples("qa-owner",[3,4])).toEqual([]);
 const instrument=await loadInstrumentData("qa-owner");
 expect(instrument.samples).toEqual(samples);
 expect(instrument.cards.find(c=>c.stockId===1)?.research.demo.winRate.value).toBe(100);
 expect(instrument.cards.find(c=>c.stockId===1)?.research.money.winRate.value).toBe(0);
});
it("uses one read contract in API/internal loader with pagination-independent bases and safe legacy fields",async()=>{
 const response=await GET(new NextRequest("http://localhost/api/assistant/v1/fibonacci?limit=1" ,{headers:{authorization:`Bearer ${token}`}}));
 expect(response.status).toBe(200);const api=await response.json(),internal=await getFibonacciData();
 expect(api.total).toBe(3);expect(api.items).toHaveLength(1);
 for(const key of ["tradeSummaryByKind","tradeResearchCoverageByKind","simulationSummary","runningStatsByKind","linkedTradeBasis","metrics"] as const)expect(api[key]).toEqual(internal[key]);
 expect(api.tradeSummary.total).toBe(3);expect(api.tradeSummaryByKind.demo.total).toBe(2);expect(api.tradeSummaryByKind.money.total).toBe(1);
 expect(api.linkedTradeBasis.ids).toEqual([1]);expect(api.linkedTradeBasis.excluded).toHaveLength(1);
 expect(api.metrics.demo.completed).toBe(1);expect(api.simulationSummary.hypotheticalCRV.n).toBe(1);
 expect(api.runningStatsByKind.retracement.total).toBe(2);expect(api.statsByKind.retracement.coverage.total).toBe(2);expect(api.statsByKind.expansion.coverage.total).toBe(1);
 const filtered=await GET(new NextRequest("http://localhost/api/assistant/v1/fibonacci?status=abgeschlossen",{headers:{authorization:`Bearer ${token}`}}));
 const closed=await filtered.json();expect(closed.total).toBe(1);expect(closed.runningStatsByKind.retracement.total).toBe(0);expect(closed.tradeSummary.total).toBe(3);
});
it("retains the actual migrated context/measurement-kind uniqueness guard",async()=>{
 await expect(pg.query(`INSERT INTO fibonacci_observation(id,"contextId","userId","stockId",wave,degree,timeframe,"observedOn",status,note) VALUES('00000000-0000-4000-8000-000000000199','00000000-0000-4000-8000-000000000100','qa-owner',1,'4','Minor','1d','2026-01-01','laufend','Synthetic duplicate')`)).rejects.toMatchObject({code:"23505"});
});
