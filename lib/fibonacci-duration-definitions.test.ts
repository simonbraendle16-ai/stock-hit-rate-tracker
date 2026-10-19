import { expect, it } from "vitest";
import { validateEvidence, validateFibInput, fibStats, fibCsv, type FibObservation } from "./fibonacci";
import { ZONE_TO_PIVOT } from "./fibonacci-duration-definitions";
import type { TargetZoneReversal, TargetZoneResidence } from "./fibonacci-residence";

const pivot=(v:Partial<TargetZoneReversal>={}):TargetZoneReversal=>({kind:"exact",value:6,unit:"hour",timeBasis:"calendar",measurementConvention:ZONE_TO_PIVOT,zone:[50,61.8],originalText:null,...v});
const stay:TargetZoneResidence={kind:"exact",value:18,unit:"hour",timeBasis:"calendar",measurementConvention:"first_visit",zone:[50,61.8],originalText:null,touchAndGo:false};
const row=(id:string,evidence:object={},status="abgeschlossen")=>({...validateFibInput({stockId:1,wave:"4",degree:"Minor",timeframe:"1h",observedOn:"2026-01-01",status,percent:null,note:"Synthetic only",evidence:{provenance:"Synthetic duration test",waveDirection:"short",...evidence}}),id,version:1,ticker:"TEST",name:"Synthetic",market:"aktien"}) as FibObservation;

it("keeps time to pivot and time inside the zone independent in coverage, classes and means",()=>{
  const a=row("both",{targetZoneReversal:pivot(),targetZoneResidence:stay,reversalDurationDays:7});
  const c=fibStats([a]).coverage;
  expect(c.reversalComparisons.groups[0]).toMatchObject({n:1,average:6,median:6,convention:ZONE_TO_PIVOT,unit:"hour"});
  expect(c.residenceComparisons.groups[0]).toMatchObject({n:1,average:18,median:18,convention:"first_visit"});
  expect(c.reversalDuration.included[0].value).toBe(7);expect(c.reversalDuration.average).toBeNull();
  expect(fibStats([a]).categorical.durations.groups).toEqual(expect.arrayContaining([
    expect.objectContaining({type:"reversal",convention:ZONE_TO_PIVOT,zone:[50,61.8],n:1}),
    expect.objectContaining({type:"residence",convention:"first_visit",n:1}),
  ]));
  expect(fibCsv([a])).toContain('""targetZoneReversal""');expect(fibCsv([a])).toContain('""targetZoneResidence""');
});

it("does not relabel historical reversal fields or unqualified reversal classes",()=>{
  const old=row("old",{reversalDurationDays:2,durations:{reversal:{bucket:"d1_3",timeBasis:"trading",convention:"reversal"}}});
  const fresh=row("new",{targetZoneReversal:pivot()});
  const stats=fibStats([old,fresh]);
  expect(stats.coverage.targetZoneReversal.n).toBe(1);
  expect(stats.coverage.reversalComparisons.excluded).toEqual([{id:"old",reason:"Nicht erhoben"}]);
  expect(stats.categorical.durations.groups.filter(g=>g.type==="reversal")).toHaveLength(2);
  expect(old.evidence?.durations?.reversal?.convention).toBe("reversal");
});

it("supports explicit zero, estimates, strict upper bounds and unknown without inventing values",()=>{
  const zero=row("zero",{targetZoneReversal:pivot({value:0})});
  expect(fibStats([zero]).coverage.reversalComparisons.groups[0].average).toBe(0);
  expect(fibStats([zero]).categorical.durations.groups[0].distribution.find(d=>d.n)?.bucket).toBe("lt_1h");
  for(const duration of [pivot({kind:"unknown",value:undefined}),pivot({kind:"upper_bound",value:undefined,upper:1,upperInclusive:false,unit:"day"}),pivot({kind:"approximate",value:4})]) {
    // JSON roundtrip drops omitted point values, exactly like the API.
    const a=row("not-exact",{targetZoneReversal:JSON.parse(JSON.stringify(duration))});
    expect(fibStats([a]).coverage.reversalComparisons.groups).toEqual([]);
    expect(fibStats([a]).coverage.targetZoneReversal.n).toBe(1);
  }
});

it("groups compatible calendar units and excludes open, unclear, estimated and missing cases",()=>{
  const stats=fibStats([
    row("a",{targetZoneReversal:pivot()}),row("b",{targetZoneReversal:pivot({value:0.25,unit:"day"})}),
    row("zone",{targetZoneReversal:pivot({zone:[61.8,78.6]})}),row("open",{targetZoneReversal:pivot()},"laufend"),
    row("unclear",{targetZoneReversal:pivot(),measurementConfidence:"unklar"}),row("missing"),
  ]);
  expect(stats.coverage.reversalComparisons.groups).toHaveLength(2);
  expect(stats.coverage.reversalComparisons.groups.find(g=>g.n===2)).toMatchObject({average:6,median:6,included:[{id:"a",value:6},{id:"b",value:6}]});
  expect(stats.coverage.reversalComparisons.excluded.map(e=>e.id)).toEqual(["missing","open","unclear"]);
});

it.each([
  {timeBasis:"trading"},{timeBasis:"unknown"},{measurementConvention:"reversal"},{measurementConvention:"confirmation"},
  {touchAndGo:true},{value:-1},{value:Infinity},{zone:[61.8,50]},
  {kind:"unknown",value:1},{kind:"upper_bound",upper:1,value:undefined},{extra:true},
])("rejects invalid or semantically different pivot measurements %#",change=>{
  const duration=JSON.parse(JSON.stringify({...pivot(),...change}));
  expect(()=>validateEvidence({provenance:"Synthetic",targetZoneReversal:duration})).toThrow();
});

it("requires a zone snapshot and calendar time for the defined reversal class",()=>{
  const valid={bucket:"h4_12",timeBasis:"calendar",convention:ZONE_TO_PIVOT,zone:[50,61.8]};
  expect(()=>validateEvidence({provenance:"Synthetic",durations:{reversal:valid}})).not.toThrow();
  for(const invalid of [{...valid,zone:undefined},{...valid,timeBasis:"trading"},{...valid,timeBasis:"unknown"}])expect(()=>validateEvidence({provenance:"Synthetic",durations:{reversal:invalid}})).toThrow();
  expect(()=>validateEvidence({provenance:"Synthetic",targetContact:"not_reached",targetZoneReversal:pivot()})).toThrow();
});

it("combines a defined exact pivot measurement and the identical explicit class in one comparison group",()=>{
  const rows=[row("numeric",{targetZoneReversal:pivot()}),row("class",{durations:{reversal:{bucket:"h4_12",timeBasis:"calendar",convention:ZONE_TO_PIVOT,zone:[50,61.8]}}})];
  const groups=fibStats(rows).categorical.durations.groups.filter(g=>g.type==="reversal");
  expect(groups).toHaveLength(1);expect(groups[0].n).toBe(2);expect(groups[0].distribution.find(d=>d.n)?.n).toBe(2);
});
