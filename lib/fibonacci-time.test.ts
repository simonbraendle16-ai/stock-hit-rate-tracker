import { describe,it,expect } from "vitest";
import { dateEnvelope,historicalTimeError,timeMatch,timeLabel } from "./fibonacci-time";
import { hierarchyError,hierarchyIds } from "./fibonacci-hierarchy";
import { selectResearchRows,researchTimeGroups,orderResearchRows } from "./fibonacci-workspace";
import { fibCsv,validateEvidence,type FibObservation } from "./fibonacci";
import { fibQuery } from "./fibonacci-query";
import { fibonacciReadModel } from "./fibonacci-read-model";
const row = (id:string,patch:Partial<FibObservation>={}):FibObservation=>({id,version:1,stockId:1,ticker:"QA",name:"Synthetic",market:"aktien",wave:"4",degree:"Minor",timeframe:"1d",observedOn:"2026-10-18",status:"abgeschlossen",percent:50,anchorStart:null,anchorEnd:null,extreme:null,note:"Synthetic",...patch});
const t = (start:string,end:string) => ({start:{precision:start.length===4?"year" as const:start.length===7?"month" as const:"day" as const,date:start},end:{precision:end.length===4?"year" as const:end.length===7?"month" as const:"day" as const,date:end}});
describe("T3 historical time and hierarchy",()=>{
  it("finds 2008 by wave time and explicitly selects captured date",()=>{
    const r=row("old",{periodFrom:"2008-03-01",periodTo:"2008-11-30"});
    expect(selectResearchRows([r],{from:"2000",to:"2010"})).toEqual([r]);
    expect(selectResearchRows([r],{from:"2020",to:"2025"})).toEqual([]);
    expect(selectResearchRows([r],{from:"2026",timeBasis:"recorded"})).toEqual([r]);
  });
  it("preserves calendar precision, leap years and inclusive interval overlap",()=>{
    expect(dateEnvelope("2008-02")).toEqual(["2008-02-01","2008-02-29"]);
    expect(dateEnvelope("1900-02")[1]).toBe("1900-02-28");
    for(const date of ["0000","2008-13","1900-02-29","2008-02-30","08","2008-1"]) expect(()=>dateEnvelope(date)).toThrow();
    const r=row("interval",{evidence:{historicalTime:t("2008-12","2009-02")}});
    expect(timeMatch(r,{from:"2008",to:"2009"})).toBe("certain");
    expect(timeMatch(r,{from:"2008-12-15",to:"2008-12-15"})).toBe("possible");
    expect(timeMatch(r,{from:"2009-02-28",to:"2009-02-28"})).toBe("possible");
    expect(timeMatch(r,{from:"2010"})).toBe("excluded");
    expect(timeLabel(r)).toBe("2008-12 bis 2009-02");
  });
  it("never invents approximate bounds and separates unknown from possible",()=>{
    const r=row("approx",{evidence:{historicalTime:{start:{precision:"year",date:"2008",approximate:true},end:null}}});
    expect(timeMatch(r,{from:"2008",to:"2008"})).toBe("unknown");
    expect(timeLabel(r)).toContain("ca. 2008");
    const bounded=row("bounded",{evidence:{historicalTime:{start:{precision:"year",date:"2008",approximate:true,earliest:"2007-01-01",latest:"2009-12-31"},end:{precision:"day",date:"2010-01-01"}}}});
    expect(timeMatch(bounded,{from:"2008",to:"2008"})).toBe("possible");
    expect(timeMatch(bounded,{from:"2007",to:"2010"})).toBe("certain");
    expect(timeMatch(row("running",{status:"laufend",periodFrom:"2008-03-01"}),{from:"2008",to:"2008"})).toBe("certain");
    expect(timeMatch(row("running",{status:"laufend",periodFrom:"2008-03-01"}),{from:"2009",to:"2009"})).toBe("unknown");
    expect(timeMatch(row("empty"),{from:"2008"})).toBe("unknown");
  });
  it("rejects invalid precision, reversed bounds, coercion and unknown properties",()=>{
    for(const time of [t("2010","2008"),{start:{precision:"day",date:"2008"},end:null},{start:{precision:"year",date:"2008",approximate:"yes"},end:null},{start:{precision:"year",date:"2008",approximate:true,earliest:"2009-01-01"},end:null},{start:null,end:null,bad:true}]) expect(historicalTimeError(time)).not.toBeNull();
    expect(validateEvidence({historicalTime:t("2008","2009"),provenance:"Synthetic"}).historicalTime).toEqual(t("2008","2009"));
  });
  it("validates API queries including partial dates and explicit wave scope",()=>{
    expect(fibQuery(new URLSearchParams("from=2008&to=2009-02&timeBasis=historical&timeMatch=possible")).filters).toMatchObject({from:"2008",to:"2009-02"});
    for(const query of ["from=2009&to=2008","from=2008-02-30","timeBasis=no","waveScope=descendants","observationId=invalid"]) expect(()=>fibQuery(new URLSearchParams(query))).toThrow();
  });
  it("keeps distinct child IDs with shared contexts and selects revisions only by observation ID",()=>{
    const a=row("parent",{contextId:"shared",periodFrom:"2008-01-01",periodTo:"2008-12-31"});
    const b=row("child1",{contextId:"shared",evidence:{parentId:a.id},periodFrom:a.periodFrom,periodTo:a.periodTo});
    const c=row("child2",{contextId:"shared",evidence:{parentId:a.id},periodFrom:a.periodFrom,periodTo:a.periodTo});
    const rows=[a,b,c,{...b,version:2,percent:61.8}];
    expect(hierarchyError(rows,c)).toBeNull();
    expect([...hierarchyIds(rows,a.id)]).toEqual([a.id]);
    const selected=selectResearchRows(rows,{observationId:a.id,waveScope:"descendants",from:"2008",to:"2008"});
    expect(selected).toHaveLength(3);
    expect(selectResearchRows(rows,{observationId:a.id,waveScope:"descendants",hierarchyRole:"subwaves"})).toHaveLength(2);
    expect(selected.find(r=>r.id===b.id)?.percent).toBe(61.8);
    const model=fibonacciReadModel(selected,[],[]);
    expect(model.hierarchyGroups.map(g=>g.n)).toEqual([1,2]);
    expect(model.hierarchyGroups[1].statsByKind.retracement.n).toBe(2);
    expect(fibCsv(selected)).toContain('"child1"');
    expect(fibCsv(selected)).toContain('parentId');
    expect(researchTimeGroups(rows,{from:"2008"})).toEqual(researchTimeGroups(orderResearchRows(rows,"deepest"),{from:"2008"}));
  });
  it("rejects missing, foreign-instrument, self and cyclic parents",()=>{
    const a=row("a"),b=row("b",{evidence:{parentId:"a"}});
    for(const candidate of [{...a,evidence:{parentId:"a"}},{...a,evidence:{parentId:"b"}},{...b,evidence:{parentId:"missing"}},{...a,stockId:2}]) expect(hierarchyError([a,b],candidate)).not.toBeNull();
  });
  it("reports complete, disjoint time groups independently of the selected group",()=>{
    const rows=[row("certain",{evidence:{historicalTime:t("2008-01-01","2008-12-31")}}),row("possible",{evidence:{historicalTime:t("2008","2008")}}),row("unknown"),row("excluded",{periodFrom:"2010-01-01",periodTo:"2010-12-31"})];
    const filters={from:"2008-03",to:"2008-04"};
    expect(researchTimeGroups(rows,filters).groups).toEqual({certain:["certain"],possible:["possible"],unknown:["unknown"],excluded:["excluded"]});
    expect(selectResearchRows(rows,{...filters,timeMatch:"all"})).toHaveLength(3);
    expect(selectResearchRows(rows,{...filters,timeMatch:"unknown"}).map(r=>r.id)).toEqual(["unknown"]);
  });
});
