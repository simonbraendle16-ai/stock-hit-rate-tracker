import {it,expect} from "vitest";
import {fibonacciReadModel} from "./fibonacci-read-model";
import {fibStats, type FibObservation} from "./fibonacci";
import {selectResearchRows} from "./fibonacci-workspace";
import {researchMetrics, type MetricSample} from "./research-metrics";
import type {TradeResearchRow} from "./trade-research-coverage";
const wave=(id:string,extra:Partial<FibObservation>={}):FibObservation=>({id,version:1,stockId:1,wave:"4",degree:"Minor",timeframe:"1d",observedOn:"2026-01-01",status:"abgeschlossen",percent:null,anchorStart:null,anchorEnd:null,extreme:null,note:"Synthetic only",ticker:"TEST",name:"Synthetic",market:"aktien",...extra});
const trade=(id:number,extra:Partial<TradeResearchRow>={}):TradeResearchRow=>({id,stockId:1,kind:"demo",status:"abgeschlossen",result:"verlust",direction:"long",wave:null,degree:null,notes:null,planContext:null,plannedCRV:null,...extra});
const sample=(id:number,extra:Partial<MetricSample>={}):MetricSample=>({id,stockId:1,kind:"demo",currency:"EUR",net:-5,plannedCRV:null,realizedR:null,...extra});
it("keeps independent IDs in one context and chooses the latest revision before status/kind filtering",()=>{
 const rows=[wave("a",{contextId:"shared",percent:50}),wave("b",{contextId:"shared",percent:100}),wave("a",{contextId:"shared",version:2,status:"laufend",percent:61.8})];
 expect(fibStats(rows)).toMatchObject({n:1,mean:100,running:1});
 expect(fibStats(rows).zones.flatMap(z=>z.ids)).toEqual(["b"]);
 expect(fibStats(rows).coverage.levelProfile).toEqual([]);
 expect(selectResearchRows(rows,{status:"abgeschlossen"}).map(r=>r.id)).toEqual(["b"]);
 expect(fibStats([rows[0],wave("a",{version:3,measurementKind:"expansion"})]).coverage.total).toBe(0);
});
it("keeps demo, money, simulation and qualitative versus net outcomes independent",()=>{
 const m=fibonacciReadModel([wave("hyp",{hypotheticalOutcome:"gewinn",evidence:{hypotheticalCRV:9}})], [trade(1),trade(2,{kind:"money",result:"gewinn"}),trade(3,{status:"geplant",result:"gewinn"})],[]);
 expect(m.tradeSummaryByKind.demo.actualOutcome).toMatchObject({n:1,wins:0,losses:1});
 expect(m.tradeSummaryByKind.money.actualOutcome).toMatchObject({n:1,wins:1});
 expect(m.simulationSummary.hypotheticalCRV).toMatchObject({n:1,average:9});
 expect(m.metrics.demo.winRate.n).toBe(0);
});
it("counts a linked trade once using its own status even when the wave is running, and excludes illegal instrument links",()=>{
 const waves=[wave("a",{tradeId:1,status:"laufend"}),wave("b",{tradeId:1}),wave("c",{tradeId:2}),wave("d",{tradeId:9}),wave("e",{tradeId:3})];
 const m=fibonacciReadModel(waves,[trade(1),trade(2,{stockId:2}),trade(3,{status:"geplant"})],[sample(1),sample(1),sample(2,{stockId:2}),sample(3)]);
 expect(m.linkedTradeBasis.ids).toEqual([1,3]);
 expect(m.linkedTradeBasis.excluded.map(r=>r.observationId)).toEqual(["c","d"]);
 expect(m.metrics.demo.completed).toBe(1);
 expect(m.linkedTradeSummaryByKind.demo.status).toContainEqual({value:"geplant",n:1,ids:[3]});
});
it("preserves incomplete qualitative evidence and running residence without a terminal distribution",()=>{
 const evidence={waveDirection:"short" as const,reachedLevels:[50],targetZone:[38.2,61.8] as [number,number],periodLabel:"ca. 2008",targetZoneResidence:{kind:"upper_bound" as const,upper:1,upperInclusive:false,touchAndGo:null,unit:"day" as const,zone:[38.2,61.8] as [number,number],timeBasis:"calendar" as const,measurementConvention:null,originalText:"unter einem Tag"}};
 const m=fibonacciReadModel([wave("running",{status:"laufend",percent:61.8,structure:"ABC",evidence}),wave("partial",{structure:"ABC",evidence:{reachedLevels:[50],reversalZone:[38.2,50]}})],[],[]);
 expect(m.statsByKind.retracement.n).toBe(0);
 expect(m.statsByKind.retracement.coverage.reached.included.map(r=>r.id)).toEqual(["partial"]);
 expect(m.statsByKind.retracement.coverage.levelProfile[0]).toMatchObject({n:1,denominator:2,reached:["partial"],excluded:[{id:"running",reason:"Status laufend"}]});
 const r=m.runningStatsByKind.retracement;
 expect(r).toMatchObject({provisional:true,total:1,ids:["running"]});
 for(const key of ["structure","direction","period","targetZone","reached","targetZoneResidence"] as const)expect(r.coverage[key].n).toBe(1);
 expect(r.coverage.duration.n).toBe(0);expect(r.coverage.touchAndGo.n).toBe(0);
 expect(r).not.toHaveProperty("mean");expect(r).not.toHaveProperty("zones");expect(r.coverage).not.toHaveProperty("exact");
 expect(m.runningStatsByKind.expansion.total).toBe(0);
});
it("reports metric-specific IDs and missing currency without combining money sums",()=>{
 const m=researchMetrics([sample(1,{kind:"money",currency:"EUR",net:10}),sample(2,{kind:"money",currency:"USD",net:20}),sample(3,{kind:"money",currency:null,net:7,realizedR:2}),sample(1,{kind:"money",net:10})]);
 expect(m.money.completed).toBe(3);expect(m.money.winRate.ids).toEqual([1,2]);expect(m.money.averageR.ids).toEqual([]);
 expect(m.money.currencies.map(r=>[r.currency,r.net,r.ids])).toEqual([["EUR",10,[1]],["USD",20,[2]]]);
 expect(m.money.winRate.excluded[0].id).toBe(3);
});

it("uses documented simulation plans on running waves without inventing a completed hypothetical outcome",()=>{
 const m=fibonacciReadModel([wave("running-plan",{status:"laufend",hypotheticalOutcome:"gewinn",evidence:{hypotheticalCRV:5,hypotheticalExitLevel:100,hypotheticalCRVBasis:"Early hypothetical exit"}}),wave("invalid-plan",{status:"ungueltig",evidence:{hypotheticalCRV:9}})],[],[]);
 expect(m.simulationSummary.hypotheticalCRV).toMatchObject({n:1,average:5,included:[{id:"running-plan",value:5}]});
 expect(m.simulationSummary.hypotheticalExitLevel.n).toBe(1);
 expect(m.simulationSummary.hypotheticalCRVBasis.n).toBe(1);
 expect(m.simulationSummary.hypotheticalOutcome.n).toBe(0);
 expect(m.statsByKind.retracement.n).toBe(0);
});

it("excludes unassigned depot kinds and inconsistent linked samples from trade metrics",()=>{
 const m=fibonacciReadModel([wave("unassigned",{tradeId:1}),wave("assigned",{tradeId:2})],[trade(1,{kind:undefined}),trade(2,{kind:"money"})],[sample(1),sample(2)]);
 expect(m.linkedTradeBasis.ids).toEqual([2]);
 expect(m.linkedTradeBasis.excluded.map(r=>r.observationId)).toEqual(["unassigned"]);
 expect(m.metrics.demo.completed).toBe(0);expect(m.metrics.money.completed).toBe(0);
 expect(m.linkedTradeBasis.samples).toEqual({denominator:1,ids:[],excluded:[{id:2,reason:"Handelsart des Trade-Samples weicht vom Depot ab"}]});
});
