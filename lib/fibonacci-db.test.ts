import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ database: null as any }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.database;
  },
}));
vi.mock("@/lib/research-metrics-service", () => ({loadMetricSamples: async () => [], loadTradeCoverage: async () => []}));
import * as schema from "./db/schema";
import { saveFib, listFib, getFib } from "./fibonacci-service";
import {
  saveHistory,
  getHistory,
  listHistory,
} from "./fibonacci-history-service";
import { GET as contextGET } from "@/app/api/assistant/v1/fibonacci/context/route";
import { hashToken } from "./assistant-api";
import { GET, POST } from "@/app/api/assistant/v1/fibonacci/route";
import { GET as revisionGET } from "@/app/api/assistant/v1/fibonacci/[id]/revisions/route";
import {
  GET as detailGET,
  PATCH,
} from "@/app/api/assistant/v1/fibonacci/[id]/route";
let pg: PGlite;
const input = {
  stockId: 1,
  wave: "B",
  degree: "Minor",
  timeframe: "1d",
  observedOn: "2026-01-01",
  status: "abgeschlossen",
  percent: 50,
  anchorStart: 100,
  anchorEnd: 200,
  extreme: 150,
  note: "Synthetic source",
  evidence: {waveDirection:"short",provenance:"Synthetic fixture"},
};
const tokens = {
  owner: "sat_" + "a".repeat(43),
  other: "sat_" + "b".repeat(43),
  read: "sat_" + "c".repeat(43),
};

it('persists independent subdivision with retry, filters, full-population metrics, revisions and legacy preservation',async()=>{
  const id=crypto.randomUUID(),ctx={params:Promise.resolve({id})};
  const body={...input,wave:'A',evidence:{...input.evidence,subdivision:'three_part',subdivisionConfidence:'bestaetigt'}};
  for(let i=0;i<2;i++)expect((await POST(request('',tokens.owner,'POST',body,{'Idempotency-Key':id}))).status).toBe(201);
  expect((await getFib('owner',id))).toMatchObject({version:1,wave:'A',evidence:{subdivision:'three_part',subdivisionConfidence:'bestaetigt'}});
  const listed=await (await GET(request('?subdivision=three_part&subdivisionConfidence=bestaetigt&limit=1'))).json();
  expect(listed.total).toBe(1);expect(listed.catalogue.subdivisions).toHaveLength(3);
  expect(listed.stats.categorical.subdivisions[0]).toMatchObject({n:1,distribution:[{n:1},{n:0}]});
  const old={...input,wave:'A'};
  expect((await PATCH(request('/'+id,tokens.owner,'PATCH',old,{'X-Expected-Version':'1'}),ctx)).status).toBe(200);
  expect((await getFib('owner',id)).evidence).toMatchObject({subdivision:'three_part',subdivisionConfidence:'bestaetigt'});
  expect((await PATCH(request('/'+id,tokens.owner,'PATCH',{...old,evidence:null},{'X-Expected-Version':'2'}),ctx)).status).toBe(422);
  expect((await PATCH(request('/'+id,tokens.owner,'PATCH',body,{'X-Expected-Version':'1'}),ctx)).status).toBe(409);
  const corrected={...body,evidence:{...body.evidence,subdivision:'five_part',subdivisionConfidence:'vermutet'}};
  expect((await PATCH(request('/'+id,tokens.owner,'PATCH',corrected,{'X-Expected-Version':'2'}),ctx)).status).toBe(200);
  const detail=await (await detailGET(request('/'+id),ctx)).json();
  expect(detail.evidence.subdivision).toBe('five_part');
  const revisions=await (await revisionGET(request('/'+id+'/revisions'),ctx)).json();
  expect(revisions.items.some((r:any)=>r.snapshot.evidence.subdivision==='three_part')).toBe(true);
  expect((await (await GET(request('?format=csv&subdivision=five_part'))).text())).toContain('five_part');
  expect((await detailGET(request('/'+id,tokens.other),ctx)).status).toBe(404);
  expect((await GET(request('?subdivision=invalid'))).status).toBe(400);
  expect((await PATCH(request('/'+id,tokens.owner,'PATCH',{...body,evidence:{...body.evidence,subdivision:null,subdivisionConfidence:null}},{'X-Expected-Version':'3'}),ctx)).status).toBe(200);
  expect((await getFib('owner',id)).evidence?.subdivision).toBeNull();
});

it('persists wave variants, filters and exports them, preserves old-client edits and permits explicit corrections',async()=>{
  const id=crypto.randomUUID(),ctx={params:Promise.resolve({id})};
  const body={...input,evidence:{...input.evidence,waveVariant:'b_overshooting'}};
  for(let i=0;i<2;i++) expect((await POST(request('',tokens.owner,'POST',body,{'Idempotency-Key':id}))).status).toBe(201);
  expect((await getFib('owner',id)).version).toBe(1);
  const listed=await (await GET(request('?wave=B&waveVariant=b_overshooting&waveLabelScope=self'))).json();
  expect(listed.total).toBe(1);expect(listed.catalogue.waveVariants).toHaveLength(3);
  expect(listed.stats.categorical.waveVariants[0]).toMatchObject({n:1,distribution:[{n:1},{n:0}]});
  expect((await (await GET(request('?waveVariant=b_undershooting'))).json()).total).toBe(0);
  expect((await GET(request('?wave=C&waveVariant=b_overshooting'))).status).toBe(400);
  expect((await PATCH(request('/'+id,tokens.owner,'PATCH',input,{'X-Expected-Version':'1'}),ctx)).status).toBe(200);
  expect((await getFib('owner',id)).evidence?.waveVariant).toBe('b_overshooting');
  expect((await PATCH(request('/'+id,tokens.owner,'PATCH',{...body,wave:'C'},{'X-Expected-Version':'2'}),ctx)).status).toBe(422);
  expect((await PATCH(request('/'+id,tokens.owner,'PATCH',{...body,evidence:null},{'X-Expected-Version':'2'}),ctx)).status).toBe(422);
  expect((await detailGET(request('/'+id,tokens.other),ctx)).status).toBe(404);
  const csv=await (await GET(request('?format=csv&waveVariant=b_overshooting'))).text(); expect(csv).toContain('b_overshooting');
  const corrected={...input,wave:'C',evidence:{...input.evidence,waveVariant:'c_truncated'}};
  expect((await PATCH(request('/'+id,tokens.owner,'PATCH',corrected,{'X-Expected-Version':'2'}),ctx)).status).toBe(200);
  expect((await getFib('owner',id)).evidence?.waveVariant).toBe('c_truncated');
  const revisions=await (await revisionGET(request('/'+id+'/revisions'),ctx)).json();
  expect(revisions.items.some((r:any)=>r.snapshot.evidence.waveVariant==='b_overshooting')).toBe(true);
  expect((await PATCH(request('/'+id,tokens.owner,'PATCH',{...corrected,evidence:{...input.evidence,waveVariant:null}},{'X-Expected-Version':'3'}),ctx)).status).toBe(200);
  expect((await getFib('owner',id)).evidence?.waveVariant).toBeNull();
});

it('separately persists defined pivot and residence duration with retry, corrections, legacy preservation, revisions and owner scope',async()=>{
  const id=crypto.randomUUID(),ctx={params:Promise.resolve({id})};
  const pivot={kind:'exact',value:6,unit:'hour',timeBasis:'calendar',measurementConvention:'first_entry_to_pivot',zone:[50,61.8],originalText:'Synthetic six hours until pivot'};
  const residence={kind:'exact',value:18,unit:'hour',timeBasis:'calendar',measurementConvention:'first_visit',zone:[50,61.8],touchAndGo:false,originalText:'Synthetic eighteen hours in zone'};
  const body={...input,evidence:{...input.evidence,targetZoneReversal:pivot,targetZoneResidence:residence,reversalDurationDays:9}};
  for(let i=0;i<2;i++)expect((await POST(request('',tokens.owner,'POST',body,{'Idempotency-Key':id}))).status).toBe(201);
  expect((await getFib('owner',id)).version).toBe(1);
  const listed=await (await GET(request('?limit=1'))).json();
  expect(listed.catalogue.durationDefinitions.reversal.convention).toBe('first_entry_to_pivot');
  expect(listed.stats.coverage.reversalComparisons.groups[0]).toMatchObject({n:1,average:6});
  expect(listed.stats.coverage.residenceComparisons.groups[0]).toMatchObject({n:1,average:18});
  const older={...input,evidence:{provenance:'Synthetic old client',waveDirection:'short',reversalDurationDays:10}};
  expect((await PATCH(request('/'+id,tokens.owner,'PATCH',older,{'X-Expected-Version':'1'}),ctx)).status).toBe(200);
  expect((await getFib('owner',id)).evidence).toMatchObject({targetZoneReversal:pivot,targetZoneResidence:residence,reversalDurationDays:10});
  const current=await getFib('owner',id);
  const correction={...current,evidence:{...current.evidence,targetZoneReversal:{...pivot,value:8},durations:{reversal:{bucket:'h4_12',timeBasis:'calendar',convention:'first_entry_to_pivot',zone:[50,61.8]}}}};
  const {id:_,version:__,createdAt:___,updatedAt:____,...patch}=correction;
  expect((await PATCH(request('/'+id,tokens.owner,'PATCH',patch,{'X-Expected-Version':'2'}),ctx)).status).toBe(200);
  expect((await (await detailGET(request('/'+id),ctx)).json()).evidence).toMatchObject({targetZoneReversal:{value:8},targetZoneResidence:residence});
  const conflict={...patch,evidence:{...patch.evidence,targetZoneReversal:{...pivot,value:24}}};
  expect((await PATCH(request('/'+id,tokens.owner,'PATCH',conflict,{'X-Expected-Version':'3'}),ctx)).status).toBe(422);
  expect((await getFib('owner',id)).version).toBe(3);
  expect((await PATCH(request('/'+id,tokens.owner,'PATCH',{...patch,evidence:null},{'X-Expected-Version':'3'}),ctx)).status).toBe(422);
  expect((await detailGET(request('/'+id,tokens.other),ctx)).status).toBe(404);
  const revisions=await (await revisionGET(request('/'+id+'/revisions'),ctx)).json();
  expect(revisions.items.map((r:any)=>r.snapshot.evidence.targetZoneReversal.value)).toEqual(expect.arrayContaining([6,8]));
  const csv=await (await GET(request('?format=csv'))).text();expect(csv).toContain('""targetZoneReversal""');expect(csv).toContain('""targetZoneResidence""');
  const cleared={...patch,evidence:{...patch.evidence,targetZoneReversal:null,durations:{reversal:null}}};
  expect((await PATCH(request('/'+id,tokens.owner,'PATCH',cleared,{'X-Expected-Version':'3'}),ctx)).status).toBe(200);
  expect((await getFib('owner',id)).evidence).toMatchObject({targetZoneReversal:null,targetZoneResidence:residence});
});

it('T6 unifies API query, full statistics, sorted pages and complete CSV while preserving owner boundaries',async()=>{
  const ids:string[]=[];
  for(let i=0;i<25;i++) {
    const id=crypto.randomUUID();ids.push(id);
    await saveFib('owner',id,{...input,percent:null,anchorStart:null,anchorEnd:null,extreme:null,evidence:{...input.evidence,catalogueVersion:1,reversalLocation:'at_level',reversalZone:[61.8,61.8]}});
  }
  const base='?levelFrom=61.8&levelMeaning=end&wave=B&waveLabelScope=self&limit=10';
  const first=await (await GET(request(base))).json();
  const next=await (await GET(request(base+'&offset=10&order=oldest'))).json();
  expect(first).toMatchObject({ready:true,total:25,nextOffset:10});
  expect(first.items).toHaveLength(10);expect(next.items).toHaveLength(10);
  expect(first.stats).toEqual(next.stats);expect(first.levelSelection).toEqual(next.levelSelection);
  expect(first.levelSelection.ids.sort()).toEqual(ids.sort());
  const exported=await GET(request(base+'&offset=10&format=csv'));
  expect(exported.headers.get('Content-Type')).toContain('text/csv');
  const csv=await exported.text();for(const id of ids)expect(csv).toContain(id);
  expect((await (await GET(request(base,tokens.other))).json()).total).toBe(0);
  const q='?query='+encodeURIComponent('TEST Welle B Endlevel 61,8')+'&resolutions='+encodeURIComponent(JSON.stringify({waveLabelScope:'self'}));
  expect((await (await GET(request(q))).json()).total).toBe(25);
  const pending=await (await GET(request('?query=Welle+4+61.8'))).json();
  expect(pending).toMatchObject({ready:false,total:null,stats:null,items:[]});
  expect(pending.statsByKind).toBeUndefined();
  expect((await GET(request('?query=Welle+4+61.8&format=csv'))).status).toBe(422);
  for(const invalid of ['?levelFrom=61.8','?order=bad','?wave=B&wave=C'])expect((await GET(request(invalid))).status).toBe(400);
});

it('T7 protects both duration representations through retry, correction, legacy edits and revision reads',async()=>{
  const id=crypto.randomUUID(),ctx={params:Promise.resolve({id})};
  const residence={kind:'exact',value:8,unit:'hour',timeBasis:'calendar',measurementConvention:'first_visit',touchAndGo:false,zone:[50,61.8],originalText:'Synthetic eight hours'};
  const classes={residence:{bucket:'h4_12',timeBasis:'calendar',convention:'first_visit',zone:[50,61.8]}};
  const body={...input,evidence:{...input.evidence,targetZoneResidence:residence,durations:classes}};
  for(let i=0;i<2;i++)expect((await POST(request('',tokens.owner,'POST',body,{'Idempotency-Key':id}))).status).toBe(201);
  expect((await getFib('owner',id)).version).toBe(1);
  const bad={...body,evidence:{...body.evidence,targetZoneResidence:{...residence,value:24}}};
  expect((await PATCH(request('/'+id,tokens.owner,'PATCH',bad,{'X-Expected-Version':'1'}),ctx)).status).toBe(422);
  expect((await getFib('owner',id)).version).toBe(1);
  const oldClient={...input,evidence:input.evidence};
  expect((await PATCH(request('/'+id,tokens.owner,'PATCH',oldClient,{'X-Expected-Version':'1'}),ctx)).status).toBe(200);
  expect((await getFib('owner',id)).evidence).toMatchObject({targetZoneResidence:residence,durations:classes});
  expect((await PATCH(request('/'+id,tokens.owner,'PATCH',body,{'X-Expected-Version':'1'}),ctx)).status).toBe(409);
  expect((await PATCH(request('/'+id,tokens.owner,'PATCH',{...body,evidence:null},{'X-Expected-Version':'2'}),ctx)).status).toBe(422);
  const corrected={...body,evidence:{...body.evidence,targetZoneResidence:{...residence,value:9}}};
  expect((await PATCH(request('/'+id,tokens.owner,'PATCH',corrected,{'X-Expected-Version':'2'}),ctx)).status).toBe(200);
  expect((await (await detailGET(request('/'+id),ctx)).json()).evidence.targetZoneResidence.value).toBe(9);
  const revisions=await (await revisionGET(request('/'+id+'/revisions'),ctx)).json();
  expect(revisions.items.map((r:any)=>r.snapshot.evidence.targetZoneResidence.value)).toEqual(expect.arrayContaining([8,9]));
  expect((await detailGET(request('/'+id,tokens.other),ctx)).status).toBe(404);
});

it('T7 keeps a pre-existing contradictory pair readable and allows unrelated correction before explicit repair',async()=>{
  const id=crypto.randomUUID();
  const old={kind:'exact',value:8,unit:'hour',timeBasis:'calendar',measurementConvention:'first_visit',touchAndGo:false,zone:[50,61.8],originalText:'Synthetic legacy value'};
  const durations={residence:{bucket:'h4_12',timeBasis:'calendar',convention:'first_visit',zone:[50,61.8]}};
  const body={...input,evidence:{...input.evidence,targetZoneResidence:old,durations}};
  await saveFib('owner',id,body);
  // Represent a historical database row created before this cross-contract validation existed.
  await pg.query('UPDATE fibonacci_observation SET version=version+1,evidence=$2 WHERE id=$1',[id,JSON.stringify({...body.evidence,targetZoneResidence:{...old,value:24}})]);
  const stored=await getFib('owner',id);
  expect(stored.evidence.targetZoneResidence?.value).toBe(24);
  await saveFib('owner',id,{...body,note:'Synthetic unrelated correction',evidence:stored.evidence},2);
  const stats=(await (await GET(request('?wave=B'))).json()).stats;
  expect(stats.coverage.residenceComparisons.groups).toEqual([]);
  expect(stats.coverage.residenceComparisons.excluded[0].reason).toContain('widersprechen');
  expect(stats.coverage.exact.n).toBe(1);
  await saveFib('owner',id,body,3);
  expect((await getFib('owner',id)).evidence.targetZoneResidence).toEqual(old);
});

it("roundtrips a key Fibonacci through API, retries, older edits and explicit removal", async()=>{
  const id=crypto.randomUUID(),ctx={params:Promise.resolve({id})};
  const body={...input,percent:null,anchorStart:null,anchorEnd:null,extreme:null,evidence:{catalogueVersion:1,waveDirection:"short",provenance:"Synthetic key Fibonacci QA",keyFibLevel:61.8,targetZone:[50,78.6],reversalLocation:"between_levels",reversalZone:[61.8,78.6]}};
  for(let i=0;i<2;i++) expect((await POST(request("",tokens.owner,"POST",body,{"Idempotency-Key":id}))).status).toBe(201);
  expect(await (await detailGET(request("/"+id),ctx)).json()).toMatchObject({version:1,percent:null,evidence:body.evidence});
  const stats=(await (await GET(request("?wave=B"))).json()).stats.categorical;
  expect(stats.keyFibonacci.groups[0]).toMatchObject({n:1,distribution:[{level:61.8,ids:[id]}]});
  const older={...body,evidence:{provenance:"Synthetic older client",waveDirection:"short"}};
  expect((await PATCH(request("/"+id,tokens.owner,"PATCH",older,{"X-Expected-Version":"1"}),ctx)).status).toBe(200);
  expect((await getFib("owner",id)).evidence.keyFibLevel).toBe(61.8);
  expect((await PATCH(request("/"+id,tokens.owner,"PATCH",{...older,evidence:{...older.evidence,keyFibLevel:null}},{"X-Expected-Version":"2"}),ctx)).status).toBe(200);
  expect((await getFib("owner",id)).evidence.keyFibLevel).toBeNull();
});

it("roundtrips historical reversal precision and preserves it for legacy edits, retries and revisions",async()=>{
  const id=crypto.randomUUID(),ctx={params:Promise.resolve({id})};
  const evidence={...input.evidence,reversalLocation:"at_level",reversalZone:[61.8,61.8],reversalPrecision:"approximate"};
  const body={...input,percent:null,anchorStart:null,anchorEnd:null,extreme:null,evidence};
  for(let i=0;i<2;i++)expect((await POST(request("",tokens.owner,"POST",body,{"Idempotency-Key":id}))).status).toBe(201);
  expect((await getFib("owner",id)).evidence).toEqual(evidence);
  const {reversalPrecision,...oldEvidence}=evidence;
  expect((await PATCH(request("/"+id,tokens.owner,"PATCH",{...body,evidence:oldEvidence},{"X-Expected-Version":"1"}),ctx)).status).toBe(200);
  expect((await getFib("owner",id)).evidence.reversalPrecision).toBe(reversalPrecision);
  expect((await PATCH(request("/"+id,tokens.owner,"PATCH",{...body,evidence:null},{"X-Expected-Version":"2"}),ctx)).status).toBe(422);
  const revisions=await (await revisionGET(request("/"+id+"/revisions"),ctx)).json();
  expect(JSON.stringify(revisions)).toContain('"reversalPrecision":"approximate"');
  expect((await detailGET(request("/"+id,tokens.other),ctx)).status).toBe(404);
});

it("roundtrips a categorical C target miss without note or expansion basis and preserves new fields on older PATCH", async()=>{
  const id=crypto.randomUUID(),ctx={params:Promise.resolve({id})};
  const body={...input,wave:"C",percent:null,anchorStart:null,anchorEnd:null,extreme:null,note:"",measurementKind:"expansion",evidence:{catalogueVersion:1,waveDirection:"short",structureCode:"abc",targetZone:[123.6,138.2],entryZone:[138.2,161.8],targetContact:"not_reached",reversalLocation:"at_level",reversalZone:[100,100],expectationTiming:"retrospective",provenance:"Synthetic categorical API test"}};
  for(let i=0;i<2;i++)expect((await POST(request("",tokens.owner,"POST",body,{"Idempotency-Key":id}))).status).toBe(201);
  const first=await (await detailGET(request("/"+id),ctx)).json();
  expect(first).toMatchObject({version:1,percent:null,note:"",measurementBasis:null,evidence:body.evidence});
  const list=await (await GET(request("?measurementKind=expansion&wave=C&timeframe=1d&degree=Minor"))).json();
  expect(list.stats.categorical.targets[0]).toMatchObject({n:1,miss:[id],hit:[]});
  expect(list.stats.categorical.levels.find((v:any)=>v.level===100).reached).toEqual([id]);
  const oldClient={...body,evidence:{provenance:"Synthetic old-client edit",waveDirection:"short"}};
  expect((await PATCH(request("/"+id,tokens.owner,"PATCH",oldClient,{"X-Expected-Version":"1"}),ctx)).status).toBe(200);
  const reread=await getFib("owner",id);
  expect(reread.evidence).toMatchObject({...body.evidence,provenance:"Synthetic old-client edit"});
  expect((await PATCH(request("/"+id,tokens.owner,"PATCH",{...body,evidence:null},{"X-Expected-Version":"2"}),ctx)).status).toBe(422);
  expect((await getFib("owner",id)).version).toBe(2);
});

it("requires direction and timeframe for new API observations and permits incomplete legacy corrections",async()=>{
  for(const patch of [{timeframe:"unbekannt"},{evidence:{provenance:"Synthetic missing direction"}}]) {
    const result=await POST(request("",tokens.owner,"POST",{...input,...patch},{"Idempotency-Key":crypto.randomUUID()}));
    expect(result.status).toBe(422);
  }
  const id=crypto.randomUUID();
  await pg.query('INSERT INTO fibonacci_observation(id,"contextId","userId","stockId",wave,degree,timeframe,"observedOn",status,note,evidence) VALUES ($1,$1,\'owner\',1,\'B\',\'unbekannt\',\'unbekannt\',\'2026-01-01\',\'abgeschlossen\',\'\',\'{}\')',[id]);
  const old=await getFib("owner",id);
  const {userId:_,createdAt:__,updatedAt:___,version:____,id:_____,...body}=old as any;
  const corrected=await saveFib("owner",id,{...body,note:"Synthetic legacy correction"},1);
  expect(corrected).toMatchObject({timeframe:"unbekannt",version:2});
});

it("preserves independent duration classes and historical zone snapshots through versioned PATCH",async()=>{
  const id=crypto.randomUUID();
  const residence={bucket:"h4_12",timeBasis:"calendar",convention:"first_visit",zone:[100,138.2]};
  const body={...input,percent:null,anchorStart:null,anchorEnd:null,extreme:null,evidence:{catalogueVersion:1,waveDirection:"short",provenance:"Synthetic duration",targetZone:[100,138.2],durations:{residence,wave:{bucket:"d3_7",timeBasis:"calendar",convention:"whole_wave"}}}};
  await saveFib("owner",id,body);
  const older={...body,evidence:{waveDirection:"short",provenance:"Synthetic older duration writer",targetZone:[138.2,161.8],durations:{wave:{bucket:"d7_30",timeBasis:"calendar",convention:"whole_wave"}}}};
  await saveFib("owner",id,older,1);
  const saved=await getFib("owner",id);expect(saved.evidence.durations?.residence).toEqual(residence);
  const stats=(await (await GET(request("?measurementKind=retracement"))).json()).stats;
  expect(stats.categorical.durations.groups.find((g:any)=>g.type==="residence").zone).toEqual([100,138.2]);
});

it("applies the optional-note migration twice without changing any observation or revision",async()=>{
  const id=crypto.randomUUID();await saveFib("owner",id,input);
  const fingerprint=async()=>({observations:(await pg.query('SELECT * FROM fibonacci_observation ORDER BY id')).rows,revisions:(await pg.query('SELECT * FROM fibonacci_revision ORDER BY "observationId",version')).rows});
  const before=await fingerprint();
  for(let i=0;i<2;i++)await pg.exec(readFileSync(new URL("../drizzle/0057_fibonacci_categorical_form.sql",import.meta.url),"utf8"));
  expect(await fingerprint()).toEqual(before);
});
beforeAll(async () => {
  pg = new PGlite();
  state.database = drizzle(pg, { schema });
  await pg.exec(`CREATE TABLE "user" (id text PRIMARY KEY);INSERT INTO "user" VALUES ('owner'),('other');
 CREATE TABLE stock(id serial PRIMARY KEY,"userId" text NOT NULL,name text NOT NULL,ticker text NOT NULL,market text NOT NULL);
 INSERT INTO stock VALUES (1,'owner','Synthetic stock','TEST','aktien'),(2,'other','Foreign','FOREIGN','krypto');
 CREATE TABLE trade(id integer PRIMARY KEY,"userId" text,"stockId" integer,status text DEFAULT 'geplant',direction text DEFAULT 'long',"elliottWaveCount" text,"waveDegree" text,notes text,"planContext" text,"riskRewardRatio" double precision);
 INSERT INTO trade(id,"userId","stockId") VALUES (10,'owner',1),(20,'other',2);
 CREATE TABLE assistant_api_token(id uuid DEFAULT gen_random_uuid(),"userId" text,name text DEFAULT 'Synthetic token',"createdAt" timestamp DEFAULT now(),"tokenHash" text,scopes jsonb,"revokedAt" timestamp,"lastUsedAt" timestamp);`);
  await pg.exec(
    readFileSync(
      new URL("../drizzle/0048_fibonacci_observations.sql", import.meta.url),
      "utf8",
    ),
  );
  await pg.exec(
    readFileSync(
      new URL("../drizzle/0049_fibonacci_research.sql", import.meta.url),
      "utf8",
    ),
  );
  await pg.exec(
    readFileSync(
      new URL("../drizzle/0050_fibonacci_history.sql", import.meta.url),
      "utf8",
    ),
  );
  await pg.exec(readFileSync(new URL("../drizzle/0051_fibonacci_two_hour.sql", import.meta.url), "utf8"));
  await pg.exec(readFileSync(new URL("../drizzle/0056_fibonacci_evidence.sql", import.meta.url), "utf8"));
  await pg.exec(readFileSync(new URL("../drizzle/0057_fibonacci_categorical_form.sql", import.meta.url), "utf8"));
  await pg.exec(readFileSync(new URL("../drizzle/0058_fibonacci_hierarchy.sql", import.meta.url), "utf8"));
  for (const [key, value] of Object.entries(tokens))
    await pg.query(
      'INSERT INTO assistant_api_token ("userId","tokenHash",scopes) VALUES ($1,$2,$3)',
      [
        key === "other" ? "other" : "owner",
        hashToken(value),
        JSON.stringify(
          key === "read" ? ["trades:read"] : ["trades:read", "trades:write"],
        ),
      ],
    );
}, 120000);
afterAll(async () => {
  await pg?.close();
});
beforeEach(async () => {
  await pg.exec(
    "TRUNCATE fibonacci_revision, fibonacci_observation, fibonacci_history",
  );
});
const request = (
  path: string,
  token: string | null = tokens.owner,
  method = "GET",
  body?: object,
  extra: Record<string, string> = {},
) =>
  new NextRequest("http://localhost/api/assistant/v1/fibonacci" + path, {
    method,
    headers: {
      ...(token ? { authorization: "Bearer " + token } : {}),
      "Content-Type": "application/json",
      ...extra,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
it("persists structured evidence, retries unchanged, keeps metadata for legacy patches and protects versions", async()=>{
 const id=crypto.randomUUID(); const body={...input,percent:null,anchorStart:null,anchorEnd:null,extreme:null,evidence:{waveDirection:"short",reachedLevels:[38.2],reversalZone:[38.2,50],hypotheticalCRV:5,provenance:"Synthetic source"}};
 const first=await saveFib("owner",id,body); expect(first.evidence).toEqual(body.evidence);
 expect((await saveFib("owner",id,body)).version).toBe(1);
 const {evidence,...legacy}=body; await saveFib("owner",id,{...legacy,note:"Synthetic correction"},1);
 expect((await getFib("owner",id)).evidence).toEqual(evidence);
 await expect(saveFib("owner",id,body,1)).rejects.toMatchObject({status:409});
 const data=await (await GET(request("?stockId=1&measurementKind=retracement"))).json();
 const searched=await (await GET(request("?search=Synthetic&selection=missing&measurementKind=retracement"))).json();
 expect(searched.total).toBe(1);expect(searched.stats).toEqual(data.stats);
 expect(data.stats.n).toBe(0);expect(data.stats.coverage.reached.n).toBe(1);expect(data.stats.coverage.reached.included[0].id).toBe(id);
 for(let i=0;i<2;i++)await pg.exec(readFileSync(new URL("../drizzle/0056_fibonacci_evidence.sql",import.meta.url),"utf8"));
 expect((await getFib("owner",id)).evidence).toEqual(evidence);
});
it("roundtrips residence through HTTP, retry, revision and an older nested evidence writer", async () => {
 const id=crypto.randomUUID(), ctx={params:Promise.resolve({id})};
 const residence={kind:"upper_bound",upper:1,upperInclusive:false,touchAndGo:true,unit:"day",timeBasis:"unknown",zone:[61.8,88.7],measurementConvention:null,originalText:"weniger als einen Tag"};
 const evidence={waveDirection:"short",provenance:"Synthetic isolated residence",reversalDurationDays:2,targetZone:[61.8,88.7],targetZoneResidence:residence};
 const body={...input,percent:null,anchorStart:null,anchorEnd:null,extreme:null,evidence};
 expect((await POST(request("",tokens.owner,"POST",body,{"Idempotency-Key":id}))).status).toBe(201);
 expect((await POST(request("",tokens.owner,"POST",body,{"Idempotency-Key":id}))).status).toBe(201);
 const get=async()=> (await detailGET(request("/"+id),ctx)).json();
 expect((await get()).evidence).toEqual(evidence);
 const older={...body,evidence:{provenance:evidence.provenance,reversalDurationDays:3,targetZone:[50,61.8]}};
 expect((await PATCH(request("/"+id,tokens.owner,"PATCH",older,{"X-Expected-Version":"1"}),ctx)).status).toBe(200);
 expect((await get()).evidence.targetZoneResidence).toEqual(residence);
 const bulkClear=await PATCH(request("/"+id,tokens.owner,"PATCH",{...body,evidence:null},{"X-Expected-Version":"2"}),ctx);
 expect(bulkClear.status).toBe(422);
 expect((await get()).version).toBe(2);
 expect((await get()).evidence.targetZoneResidence).toEqual(residence);
 expect((await PATCH(request("/"+id,tokens.owner,"PATCH",body,{"X-Expected-Version":"1"}),ctx)).status).toBe(409);
 const revisions=await (await revisionGET(request("/"+id+"/revisions"),ctx)).json();
 expect(revisions.items).toHaveLength(2);
 expect(revisions.items.every((r:any)=>r.snapshot.evidence.targetZoneResidence.upperInclusive === false)).toBe(true);
 const listed=await (await GET(request("?stockId=1&measurementKind=retracement"))).json();
 expect(listed.stats.coverage.targetZoneResidence.included[0].id).toBe(id);
 expect(listed.stats.coverage.residenceComparisons.groups).toEqual([]);
 const cleared={...body,evidence:{...evidence,targetZoneResidence:null}};
 expect((await PATCH(request("/"+id,tokens.owner,"PATCH",cleared,{"X-Expected-Version":"2"}),ctx)).status).toBe(200);
 expect((await get()).evidence.targetZoneResidence).toBeNull();
 let version=3;
 for (const duration of [
   {kind:"exact",value:8,unit:"hour",touchAndGo:true,originalText:"insgesamt acht Stunden"},
   {kind:"unknown",touchAndGo:false},
   {kind:"approximate",value:6,unit:"hour"},
   {kind:"range",lower:2,upper:4,lowerInclusive:true,upperInclusive:false,unit:"hour"},
 ]) {
   const {upper:_,upperInclusive:__,...base}=residence;
   const next={...base,...duration};
   expect((await PATCH(request("/"+id,tokens.owner,"PATCH",{...body,evidence:{...evidence,targetZoneResidence:next}},{"X-Expected-Version":String(version)}),ctx)).status).toBe(200);
   version++;
   expect((await get()).evidence.targetZoneResidence).toEqual(next);
 }
});
describe("Fibonacci isolated PostgreSQL and HTTP contract", () => {
  it("still accepts a legacy evidence clear when no residence is stored", async () => {
    const id=crypto.randomUUID(),ctx={params:Promise.resolve({id})};
    const body={...input,evidence:{waveDirection:"short",provenance:"Synthetic",durationDays:2}};
    await saveFib("owner",id,body);
    const result=await PATCH(request("/"+id,tokens.owner,"PATCH",{...body,evidence:null},{"X-Expected-Version":"1"}),ctx);
    expect(result.status).toBe(200);
    expect((await getFib("owner",id)).evidence).toEqual({});
  });
  it("roundtrips a descriptive historical case through retry, correction, revisions and filtered statistics", async () => {
    const id = crypto.randomUUID(), ctx = { params: Promise.resolve({ id }) };
    const historical = {
      ...input, wave: "X", timeframe: "2h", degree: "unbekannt",
      percent: null, anchorStart: null, anchorEnd: null, extreme: null,
      periodFrom: "2026-01-01", periodTo: "2026-01-02",
      sourceKey: "isolated-historical-roundtrip", sourceRef: "Synthetic isolated source",
      stopVariants: [
        {kind: "hypothetisch", label: "Box", description: "Under box", outcome: "gewinn", resultR: null},
        {kind: "hypothetisch", label: "Wide", description: "Under wave", outcome: "verlust", resultR: null},
      ],
    };
    const headers = { "Idempotency-Key": id };
    expect((await POST(request("", tokens.owner, "POST", historical, headers))).status).toBe(201);
    const query = "?stockId=1&wave=X&timeframe=2h&from=2026-01-01&to=2026-01-02&limit=1";
    const initial = await (await GET(request(query))).json();
    expect(initial.stats).toMatchObject({ n: 0, missing: 1, mean: null });
    const context = await (await contextGET(request("/context?stockId=1&wave=X&timeframe=2h"))).json();
    expect(context.resolution).toBe("eindeutig");
    expect(context.contexts).toHaveLength(1);
    expect((await (await detailGET(request("/" + id), ctx)).json()).version).toBe(1);
    expect((await (await POST(request("", tokens.owner, "POST", historical, headers))).json()).id).toBe(id);
    expect((await PATCH(request("/" + id, tokens.owner, "PATCH", { ...historical, percent: 61.8 }, {"X-Expected-Version":"1"}), ctx)).status).toBe(200);
    const reread = await (await detailGET(request("/" + id), ctx)).json();
    expect(reread).toMatchObject({ id, contextId: id, version: 2, percent: 61.8, sourceKey: historical.sourceKey });
    const corrected = await (await GET(request(query))).json();
    expect(corrected.total).toBe(1);
    expect(corrected.stats).toMatchObject({ n: 1, missing: 0, mean: 61.8 });
    expect(corrected.stats.stopVariants).toHaveLength(2);
    const revisions = (await pg.query<{version:number}>(`SELECT version FROM fibonacci_revision WHERE "observationId"=$1 ORDER BY version`, [id])).rows;
    expect(revisions.map(r => r.version)).toEqual([1,2]);
    expect((await (await GET(request("?stockId=1&wave=B"))).json()).total).toBe(0);
  });
  it("applies additive migration twice without changing instrument rows", async () => {
    await pg.exec(
      readFileSync(
        new URL("../drizzle/0048_fibonacci_observations.sql", import.meta.url),
        "utf8",
      ),
    );
    expect(
      (await pg.query("SELECT count(*)::int AS n FROM stock")).rows,
    ).toEqual([{ n: 2 }]);
  });
  it("saves, rereads, retries safely and rejects another body on same ID", async () => {
    const id = crypto.randomUUID();
    const first = await saveFib("owner", id, input);
    expect(first.version).toBe(1);
    expect((await getFib("owner", id)).percent).toBe(50);
    await saveFib("owner", id, input);
    expect(await listFib("owner")).toHaveLength(1);
    await expect(
      saveFib("owner", id, { ...input, note: "Different" }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("enforces ownership in lists, detail, create and update", async () => {
    const id = crypto.randomUUID();
    await saveFib("owner", id, input);
    expect(await listFib("other")).toEqual([]);
    await expect(getFib("other", id)).rejects.toMatchObject({ status: 404 });
    await expect(
      saveFib("owner", crypto.randomUUID(), { ...input, stockId: 2 }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      saveFib("other", id, { ...input, stockId: 2 }, 1),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("allows one optimistic update and rejects stale versions", async () => {
    const id = crypto.randomUUID();
    await saveFib("owner", id, input);
    const changed = await saveFib(
      "owner",
      id,
      { ...input, status: "laufend" },
      1,
    );
    expect(changed.version).toBe(2);
    await expect(saveFib("owner", id, input, 1)).rejects.toMatchObject({
      status: 409,
    });
    expect((await getFib("owner", id)).status).toBe("laufend");
  });
  it("checks percent and anchor consistency at database boundary", async () => {
    for (const percent of [-1, 501, NaN])
      await expect(
        pg.query(
          "INSERT INTO fibonacci_observation(id,\"userId\",\"stockId\",wave,degree,timeframe,\"observedOn\",status,percent,note) VALUES ($1,'owner',1,'B','Minor','1d','2026-01-01','abgeschlossen',$2,'Synthetic')",
          [crypto.randomUUID(), percent],
        ),
      ).rejects.toThrow();
    await expect(
      pg.query(
        "INSERT INTO fibonacci_observation(id,\"userId\",\"stockId\",wave,degree,timeframe,\"observedOn\",status,percent,note,\"anchorStart\",\"anchorEnd\",extreme) VALUES ($1,'owner',1,'B','Minor','1d','2026-01-01','abgeschlossen',70,'Synthetic',100,200,150)",
        [crypto.randomUUID()],
      ),
    ).rejects.toThrow();
  });
  it("enforces auth, scopes, body validation and missing keys over HTTP", async () => {
    expect((await GET(request("", null))).status).toBe(401);
    expect(
      (
        await POST(
          request("", tokens.read, "POST", input, {
            "Idempotency-Key": crypto.randomUUID(),
          }),
        )
      ).status,
    ).toBe(403);
    expect((await POST(request("", tokens.owner, "POST", input))).status).toBe(
      400,
    );
    expect(
      (
        await POST(
          request(
            "",
            tokens.owner,
            "POST",
            { ...input, percent: 70 },
            { "Idempotency-Key": crypto.randomUUID() },
          ),
        )
      ).status,
    ).toBe(422);
  });
  it("creates through API and paginates without limiting summary denominator", async () => {
    for (const n of [38.2, 61.8, 100])
      await POST(
        request(
          "",
          tokens.owner,
          "POST",
          {
            ...input,
            percent: n,
            anchorStart: null,
            anchorEnd: null,
            extreme: null,
          },
          { "Idempotency-Key": crypto.randomUUID() },
        ),
      );
    const result = await GET(request("?limit=1"));
    const body = await result.json();
    expect(result.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(3);
    expect(body.stats.n).toBe(3);
    expect(body.nextOffset).toBe(1);
    expect((await GET(request("?market=krypto"))).status).toBe(200);
    expect((await (await GET(request("?market=krypto"))).json()).total).toBe(0);
    expect((await GET(request("?limit=-1"))).status).toBe(400);
    expect((await GET(request("?wave=unknown"))).status).toBe(200);
    expect((await GET(request("?wave="))).status).toBe(400);
    expect((await GET(request("?from=2026-02-02&to=2026-01-01"))).status).toBe(
      400,
    );
    expect((await GET(request("?from=2026-02-30"))).status).toBe(400);
  });
  it("GET/PATCH roundtrip protects foreign records and versions", async () => {
    const id = crypto.randomUUID(),
      ctx = { params: Promise.resolve({ id }) };
    await saveFib("owner", id, input);
    expect((await detailGET(request("/" + id, tokens.other), ctx)).status).toBe(
      404,
    );
    expect(
      (
        await PATCH(
          request("/" + id, tokens.owner, "PATCH", input, {
            "X-Expected-Version": "1",
          }),
          ctx,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await PATCH(
          request("/" + id, tokens.owner, "PATCH", input, {
            "X-Expected-Version": "1",
          }),
          ctx,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await PATCH(
          request("/" + id, tokens.read, "PATCH", input, {
            "X-Expected-Version": "2",
          }),
          ctx,
        )
      ).status,
    ).toBe(403);
  });
  it("migrates the complete research bundle repeatedly, preserving custom constraints", async () => {
    await pg.exec(
      "ALTER TABLE fibonacci_observation ADD CONSTRAINT custom_note_guard CHECK (length(note)>0)",
    );
    for (const file of [
      "0049_fibonacci_research.sql",
      "0050_fibonacci_history.sql",
      "0051_fibonacci_two_hour.sql",
      "0049_fibonacci_research.sql",
      "0050_fibonacci_history.sql",
      "0051_fibonacci_two_hour.sql",
    ])
      await pg.exec(
        readFileSync(new URL("../drizzle/" + file, import.meta.url), "utf8"),
      );
    expect(
      (
        await pg.query(
          "SELECT conname FROM pg_constraint WHERE conname='custom_note_guard'",
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("upgrades a real legacy observation preserving identity, anchors, version and revision", async () => {
    const legacy = new PGlite();
    try {
      await legacy.exec(`CREATE TABLE "user"(id text PRIMARY KEY); INSERT INTO "user" VALUES ('owner');
        CREATE TABLE stock(id integer PRIMARY KEY,"userId" text); INSERT INTO stock VALUES(1,'owner');
        CREATE TABLE trade(id integer PRIMARY KEY,"userId" text,"stockId" integer,status text DEFAULT 'geplant',direction text DEFAULT 'long',"elliottWaveCount" text,"waveDegree" text,notes text,"planContext" text,"riskRewardRatio" double precision);`);
      const migration = (name: string) => readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8');
      await legacy.exec(migration('0048_fibonacci_observations.sql'));
      const id = crypto.randomUUID();
      await legacy.query(`INSERT INTO fibonacci_observation(id,"userId","stockId",wave,degree,timeframe,"observedOn",status,percent,"anchorStart","anchorEnd",extreme,note,version) VALUES($1,'owner',1,'B','Minor','1d','2026-01-01','abgeschlossen',50,100,200,150,'Legacy source',3)`,[id]);
      const before = (await legacy.query('SELECT id,percent,"anchorStart","anchorEnd",extreme,note,version FROM fibonacci_observation')).rows;
      for (const file of ['0049_fibonacci_research.sql','0050_fibonacci_history.sql','0051_fibonacci_two_hour.sql','0049_fibonacci_research.sql','0050_fibonacci_history.sql','0051_fibonacci_two_hour.sql']) await legacy.exec(migration(file));
      expect((await legacy.query('SELECT id,percent,"anchorStart","anchorEnd",extreme,note,version FROM fibonacci_observation')).rows).toEqual(before);
      expect((await legacy.query('SELECT "contextId", "measurementKind" FROM fibonacci_observation')).rows).toEqual([{contextId:id,measurementKind:'retracement'}]);
      expect((await legacy.query('SELECT version FROM fibonacci_revision')).rows).toEqual([{version:3}]);
    } finally { await legacy.close(); }
  });
  it("reports ambiguous contexts and refuses implicit association", async () => {
    const base = {...input,periodFrom:'2025-12-01',periodTo:'2025-12-31'};
    for (let i=0;i<2;i++) await saveFib('owner',crypto.randomUUID(),{...base,contextId:crypto.randomUUID()});
    const response = await contextGET(request('?instrument=TEST&wave=B'));
    const resolved = await response.json();
    expect(resolved.resolution).toBe('mehrdeutig');
    expect(resolved.contexts).toHaveLength(2);
    await expect(saveFib('owner',crypto.randomUUID(),base)).rejects.toMatchObject({status:409});
    expect(await listFib('owner')).toHaveLength(2);
  });
  it("stores immutable user-owned history, retries content, links and protects foreign data", async () => {
    const body = {
      stockId: 1,
      interval: "1d",
      timezone: "UTC",
      currency: "EUR",
      source: "Synthetic",
      origin: "csv" as const,
      candles: [
        {
          time: 1767225600,
          open: 100,
          high: 120,
          low: 90,
          close: 110,
          volume: 0,
        },
      ],
    };
    const saved = await saveHistory("owner", crypto.randomUUID(), body);
    expect((await saveHistory("owner", crypto.randomUUID(), body)).id).toBe(
      saved.id,
    );
    expect((await getHistory("owner", saved.id)).coverage.count).toBe(1);
    expect(await listHistory("other")).toHaveLength(0);
    await expect(getHistory("other", saved.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      saveHistory("other", crypto.randomUUID(), body),
    ).rejects.toMatchObject({ status: 404 });
    const id = crypto.randomUUID();
    await saveFib("owner", id, { ...input, historyId: saved.id, tradeId: 10 });
    expect((await getFib("owner", id)).historyId).toBe(saved.id);
    await expect(
      saveFib("owner", crypto.randomUUID(), { ...input, tradeId: 20 }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (
        (await pg.query("SELECT count(*)::int n FROM fibonacci_history"))
          .rows[0] as { n: number }
      ).n,
    ).toBe(1);
  });
  it("shares a context across measurement kinds, counts one each and preserves expansion rules on legacy PATCH", async () => {
    const id = crypto.randomUUID();
    await saveFib("owner", id, input);
    const expansionId = crypto.randomUUID();
    const expansion = {
      ...input,
      anchorStart: null,
      anchorEnd: null,
      extreme: null,
      percent: 600,
      measurementKind: "expansion",
      measurementBasis: "Relative to first impulse",
      contextId: id,
    };
    await saveFib("owner", expansionId, expansion);
    const response = await (await GET(request(""))).json();
    expect(response.statsByKind.retracement.n).toBe(1);
    expect(response.statsByKind.expansion.n).toBe(1);
    await expect(
      saveFib("owner", expansionId, { ...input, percent: 50 }, 1),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      saveFib("owner", crypto.randomUUID(), {
        ...expansion,
        stockId: 1,
        wave: "C",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("resolves two kinds of one wave context as the same candidate", async () => {
    const id = crypto.randomUUID();
    await saveFib("owner", id, input);
    await saveFib("owner", crypto.randomUUID(), {
      ...input,
      anchorStart: null,
      anchorEnd: null,
      extreme: null,
      measurementKind: "expansion",
      measurementBasis: "Synthetic reference",
      contextId: id,
    });
    const resolved = await (
      await contextGET(request("?instrument=TEST&wave=B"))
    ).json();
    expect(resolved.resolution).toBe("eindeutig");
    expect(resolved.contexts).toHaveLength(1);
  });

  it("automatically associates a unique fully specified period and retries structured variants", async () => {
    const base = {
      ...input,
      periodFrom: "2025-12-01",
      periodTo: "2025-12-31",
      stopVariants: [
        {
          label: "Box",
          description: "1 % unter Box",
          kind: "hypothetisch",
          outcome: "verlust",
          resultR: -1,
        },
      ],
    };
    const first = await saveFib("owner", crypto.randomUUID(), base);
    expect((await saveFib("owner", crypto.randomUUID(), base)).id).toBe(
      first.id,
    );
    const expansion = await saveFib("owner", crypto.randomUUID(), {
      ...base,
      anchorStart: null,
      anchorEnd: null,
      extreme: null,
      measurementKind: "expansion",
      measurementBasis: "First impulse",
      percent: 161.8,
    });
    expect(expansion.contextId).toBe(first.contextId);
    expect((await listFib("owner")).length).toBe(2);
    const revisions = await pg.query(
      'SELECT version FROM fibonacci_revision WHERE "observationId"=$1',
      [first.id],
    );
    expect(revisions.rows).toHaveLength(1);
  });

  it("serializes parallel repeated writes without duplicate waves", async () => {
    const contextId = crypto.randomUUID();
    const results = await Promise.all([
      saveFib("owner", crypto.randomUUID(), { ...input, contextId }),
      saveFib("owner", crypto.randomUUID(), { ...input, contextId }),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect(await listFib("owner")).toHaveLength(1);
  });
});

it("supports two-hour observations and filters after an idempotent upgrade", async () => {
  const old = await saveFib("owner", crypto.randomUUID(), input);
  for (let i=0;i<2;i++) await pg.exec(readFileSync(new URL("../drizzle/0051_fibonacci_two_hour.sql", import.meta.url), "utf8"));
  const row = await saveFib("owner", crypto.randomUUID(), {...input, timeframe:"2h",wave:"X",percent:70.2,anchorStart:null,anchorEnd:null,extreme:null});
  expect((await getFib("owner",old.id)).timeframe).toBe(input.timeframe);
  expect(row.timeframe).toBe("2h");
  const response=await GET(request("?timeframe=2h&wave=X"));
  expect(response.status).toBe(200);
  const data=await response.json();
  expect(data.items.map((r: {id:string})=>r.id)).toEqual([row.id]);
  expect(data.stats.n).toBe(1);
  expect(data.stats.mean).toBe(70.2);
  await expect(saveFib("owner",crypto.randomUUID(),{...input,timeframe:"3h"})).rejects.toThrow();
});

it("T3 roundtrips historical precision, parents, revisions, pagination and time groups", async()=>{
 const root=crypto.randomUUID(),child1=crypto.randomUUID(),child2=crypto.randomUUID();
 const historicalTime={start:{precision:"year",date:"2008"},end:{precision:"month",date:"2009-02"},source:"Synthetic chart"};
 const rootBody={...input,evidence:{...input.evidence,historicalTime}};
 await saveFib("owner",root,rootBody);
 for(const [id,wave] of [[child1,"A"],[child2,"C"]]) {
   const body={...input,wave,evidence:{...input.evidence,parentId:root,historicalTime}};
   for(let i=0;i<2;i++)expect((await POST(request("",tokens.owner,"POST",body,{"Idempotency-Key":id}))).status).toBe(201);
 }
 const url="?from=2000&to=2010&observationId="+root+"&waveScope=descendants&limit=1";
 const data=await (await GET(request(url))).json();
 expect(data.total).toBe(3);expect(data.items).toHaveLength(1);expect(data.timeSelection.groups.certain).toHaveLength(3);
 expect(data.hierarchyGroups.map((g:any)=>g.n)).toEqual([1,2]);
 expect(data.stats.n).toBe(3);
 const second=await (await GET(request(url+"&offset=1"))).json();
 expect(second.stats).toEqual(data.stats);expect(second.items[0].id).not.toBe(data.items[0].id);
 const ctx=await (await contextGET(request(url))).json();expect(ctx.total).toBe(3);expect(ctx.timeSelection).toEqual(data.timeSelection);
 const oldClient={...input,wave:"A",evidence:{...input.evidence,reachedLevels:[50]}};
 await saveFib("owner",child1,oldClient,1);
 expect((await getFib("owner",child1)).evidence).toMatchObject({historicalTime,parentId:root});
 const revisions=await (await revisionGET(request("/"+child1+"/revisions"),{params:Promise.resolve({id:child1})})).json();
 expect(revisions.items).toHaveLength(2);expect(revisions.items.every((r:any)=>r.snapshot.evidence.parentId===root)).toBe(true);
 expect((await (await GET(request("?from=2020&to=2025"))).json()).total).toBe(0);
 expect((await (await GET(request("?from=2026&timeBasis=recorded"))).json()).total).toBe(3);
 expect((await (await GET(request("?from=2008-03&to=2008-04&timeMatch=possible"))).json()).total).toBe(3);
 expect((await GET(request("?from=2008-02-30"))).status).toBe(400);
 const before=(await pg.query('SELECT to_jsonb(o) AS value FROM fibonacci_observation o ORDER BY id')).rows;
 for(let i=0;i<2;i++) await pg.exec(readFileSync(new URL("../drizzle/0058_fibonacci_hierarchy.sql",import.meta.url),"utf8"));
 expect((await pg.query('SELECT to_jsonb(o) AS value FROM fibonacci_observation o ORDER BY id')).rows).toEqual(before);
});
it("T3 rejects invalid parents in service and database, including concurrent cycles",async()=>{
 const root=crypto.randomUUID(),child=crypto.randomUUID();
 await saveFib("owner",root,input);
 await saveFib("owner",child,{...input,wave:"A",evidence:{...input.evidence,parentId:root}});
 for(const parentId of [child,root,crypto.randomUUID()]) await expect(saveFib("owner",root,{...input,evidence:{...input.evidence,parentId}},1)).rejects.toMatchObject({status:422});
 const foreign=crypto.randomUUID();await saveFib("other",foreign,{...input,stockId:2});
 await expect(saveFib("owner",crypto.randomUUID(),{...input,evidence:{...input.evidence,parentId:foreign}})).rejects.toMatchObject({status:422});
 await expect(pg.query('UPDATE fibonacci_observation SET evidence=jsonb_set(evidence,\'{parentId}\',to_jsonb($1::text)) WHERE id=$2',[child,root])).rejects.toThrow();
 const a=crypto.randomUUID(),b=crypto.randomUUID();await saveFib("owner",a,{...input,wave:"X"});await saveFib("owner",b,{...input,wave:"Y"});
 const updates=await Promise.allSettled([saveFib("owner",a,{...input,wave:"X",evidence:{...input.evidence,parentId:b}},1),saveFib("owner",b,{...input,wave:"Y",evidence:{...input.evidence,parentId:a}},1)]);
 expect(updates.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 expect(updates.filter(r=>r.status==="rejected")).toHaveLength(1);
});
