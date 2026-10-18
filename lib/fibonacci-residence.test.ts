import { expect, it } from "vitest";
import { validateEvidence, validateFibInput, fibStats, fibCsv, filterFib, type FibObservation } from "./fibonacci";
import { residenceLabel, type TargetZoneResidence } from "./fibonacci-residence";

const residence = (v: Partial<TargetZoneResidence> = {}): TargetZoneResidence => ({kind:"unknown", touchAndGo:null, unit:"day", timeBasis:"unknown", zone:[61.8,88.7], measurementConvention:null, originalText:null, ...v});
const row = (id: string, r?: TargetZoneResidence, extra: object = {}) => ({...validateFibInput({stockId:1,wave:"B",degree:"Minor",timeframe:"2h",observedOn:"2026-01-01",status:"abgeschlossen",percent:null,anchorStart:null,anchorEnd:null,extreme:null,note:"Synthetic only",evidence:{reversalDurationDays:2, provenance:"Synthetic source", ...(r ? {targetZoneResidence:r} : {})}, ...extra}),id,version:1,ticker:"TEST",name:"Synthetic",market:"aktien"}) as FibObservation;

it("retains strict under-one-day and Touch-and-Go without a point duration or reversal conversion", () => {
  const r = residence({kind:"upper_bound",upper:1,upperInclusive:false,touchAndGo:true,originalText:"weniger als einen Tag"});
  const a = row("bound",r), s = fibStats([a]);
  expect(a.evidence?.targetZoneResidence).toEqual(r);
  expect(a.evidence?.targetZoneResidence).not.toHaveProperty("value");
  expect(s.coverage.reversalDuration.n).toBe(1);expect(s.coverage.reversalDuration.average).toBeNull();
  expect(s.coverage.duration.n).toBe(0);
  expect(s.coverage.touchAndGo.included).toEqual([{id:"bound",value:"Touch-and-Go"}]);
  expect(s.coverage.residenceComparisons.groups).toEqual([]);
  expect(residenceLabel(r)).toContain("unter 1 Tag");
});

it("keeps eight reported hours and overall wording while excluding pending conventions from averages", () => {
  const a = row("reported",residence({kind:"exact",value:8,unit:"hour",touchAndGo:true,originalText:"insgesamt acht Stunden"}));
  const s = fibStats([a]);
  expect(s.coverage.residenceKind.distribution[0].value).toContain("Exakt berichtet");
  expect(s.coverage.residenceComparisons.excluded[0].reason).toContain("offen");
  expect(a.evidence?.targetZoneResidence?.originalText).toBe("insgesamt acht Stunden");
});

it("keeps estimates, ranges, unknown duration, unknown behavior and missing legacy cases distinct", () => {
  const rows = [row("approx",residence({kind:"approximate",value:6,unit:"hour",touchAndGo:false})), row("range",residence({kind:"range",lower:2,upper:4,lowerInclusive:true,upperInclusive:false,unit:"hour"})), row("unknown",residence({touchAndGo:true})), row("missing")];
  const s = fibStats(rows).coverage;
  expect(s.targetZoneResidence.n).toBe(3);
  expect(s.residenceKind.distribution).toHaveLength(3);
  expect(s.touchAndGo.n).toBe(2);
  expect(s.touchAndGo.distribution.map(v=>v.count).sort()).toEqual([1,1]);
  expect(s.targetZoneResidence.excluded).toEqual([{id:"missing",reason:"Bestätigte strukturierte Angabe fehlt"}]);
  expect(s.residenceComparisons.groups).toEqual([]);
});

it("averages only compatible exact calendar durations and preserves group IDs and status exclusions", () => {
  const exact = (v: Partial<TargetZoneResidence> = {}) => residence({kind:"exact",value:6,unit:"hour",timeBasis:"calendar",measurementConvention:"First continuous stay",...v});
  const rows = [row("hours",exact()),row("days",exact({value:0.25,unit:"day"})),row("bound",residence({kind:"upper_bound",upper:1,upperInclusive:false})),row("open",exact(),{status:"laufend"}),row("different",exact({measurementConvention:"Sum of stays"})),row("tradingDay",exact({timeBasis:"trading",unit:"day"})),row("tradingHour",exact({timeBasis:"trading"}))];
  const s = fibStats(rows).coverage.residenceComparisons;
  const group = s.groups.find(g=>g.n === 2)!;
  expect(group).toMatchObject({n:2,average:6,median:6,unit:"hour",timeBasis:"calendar"});
  expect(group.included.map(v=>v.id)).toEqual(["days","hours"]);
  expect(s.groups).toHaveLength(4);
  expect(s.excluded.map(v=>v.id)).toEqual(["bound","open"]);
  expect(fibStats(filterFib(rows,{status:"laufend"})).coverage.targetZoneResidence.n).toBe(0);
});

it.each([
  {kind:"exact",value:0}, {kind:"exact",value:-1}, {kind:"exact",value:Infinity}, {kind:"exact",value:NaN},
  {kind:"upper_bound",upper:1}, {kind:"upper_bound",upper:1,upperInclusive:false,value:0.5},
  {kind:"range",lower:4,upper:2,lowerInclusive:true,upperInclusive:true},
  {kind:"range",lower:2,upper:2,lowerInclusive:true,upperInclusive:true},
  {kind:"unknown",value:1}, {unit:"candle"}, {touchAndGo:"yes"}, {zone:[88.7,61.8]}, {measurementConvention:""}, {newField:true},
  {kind:["exact"]}, {unit:["day"]}, {timeBasis:["calendar"]},
])("rejects contradictory or incomplete residence %#", v => {
  expect(()=>validateEvidence({provenance:"Synthetic",targetZoneResidence:residence(v as unknown as Partial<TargetZoneResidence>)})).toThrow();
});

it("exports complete evidence with the same observation ID and no invented numeric point", () => {
  const r = row("csv-id",residence({kind:"upper_bound",upper:1,upperInclusive:false,touchAndGo:true,originalText:'Unter 1 Tag; "berührt"'}));
  const csv = fibCsv([r]);
  expect(csv).toContain("csv-id");
  expect(csv).toContain('""targetZoneResidence""');
  expect(csv).toContain('""upperInclusive"":false');
  expect(csv).toContain('""originalText""');
  const firstCell = csv.split("\r\n")[1].match(/^"((?:[^"]|"")*)";/)![1].replaceAll('""','"');
  expect(JSON.parse(firstCell)).toEqual(r.evidence);
  expect(r.evidence?.targetZoneResidence).not.toHaveProperty("value");
});
