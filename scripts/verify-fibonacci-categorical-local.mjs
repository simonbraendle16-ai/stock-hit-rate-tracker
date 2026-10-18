// Fixed local synthetic QA only. No env files, cloud targets or personal data.
import assert from 'node:assert/strict'
import pg from 'pg'
import {createHash,randomBytes,randomUUID} from 'node:crypto'
import {writeFileSync} from 'node:fs'
const db=new pg.Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:5549/postgres'});
const root='http://localhost:3026/api/assistant/v1/fibonacci';
const token='sat_'+randomBytes(32).toString('base64url'),tokenId=randomUUID();
await db.connect();
try {
  const owner=(await db.query(`SELECT id FROM "user" WHERE email='fibonacci-qa@example.invalid'`)).rows[0]?.id;
  assert.equal(owner,'fibonacci-local-qa');
  await db.query('INSERT INTO assistant_api_token(id,"userId",name,"tokenHash",scopes) VALUES($1,$2,\'Ephemeral categorical QA\',$3,$4::jsonb)',[tokenId,owner,createHash('sha256').update(token).digest('hex'),JSON.stringify(['trades:read','trades:write'])]);
  const call=async(method,path,body,extra={})=>{
    const response=await fetch(root+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...extra},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
    const data=await response.json();
    return {status:response.status,data};
  };
  const input={stockId:1,wave:'C',degree:'Minor',timeframe:'30m',observedOn:'2026-01-01',status:'abgeschlossen',percent:null,measurementKind:'expansion',note:'',evidence:{catalogueVersion:1,provenance:'Synthetic local categorical QA',waveDirection:'short',structureCode:'abc',targetZone:[123.6,138.2],targetContact:'not_reached',reversalLocation:'at_level',reversalZone:[100,100]}};
  const id=randomUUID();
  for(let retry=0;retry<2;retry++)assert.equal((await call('POST','',input,{'Idempotency-Key':id})).status,201);
  const detail=await call('GET','/'+id);assert.equal(detail.status,200);assert.equal(detail.data.version,1);assert.equal(detail.data.note,'');assert.equal(detail.data.measurementBasis,null);assert.equal(detail.data.percent,null);
  const filtered=await call('GET','?measurementKind=expansion&wave=C&degree=Minor&timeframe=30m');assert.equal(filtered.status,200);
  assert.ok(filtered.data.stats.categorical.targets.some(g=>g.miss.includes(id)));
  assert.ok(filtered.data.stats.categorical.reversals.groups.some(g=>g.distribution.some(d=>d.ids.includes(id))));
  assert.ok(filtered.data.stats.categorical.levels.find(l=>l.level===100).reached.includes(id));
  assert.ok(!filtered.data.catalogue.levels.includes(127.2));assert.ok(filtered.data.catalogue.levels.includes(361.8));
  const ids=[];
  for(const [degree,timeframe,bucket] of [['Zyklus','1w','d90_180'],['Minor','30m','h4_12']]){
    const durationId=randomUUID();ids.push(durationId);
    const body={...input,wave:'B',degree,timeframe,evidence:{catalogueVersion:1,provenance:'Synthetic local duration QA',waveDirection:'short',targetZone:[123.6,138.2],durations:{residence:{bucket,timeBasis:'calendar',convention:'first_visit',zone:[123.6,138.2]}}}};
    assert.equal((await call('POST','',body,{'Idempotency-Key':durationId})).status,201);
  }
  const durations=(await call('GET','?measurementKind=expansion&wave=B')).data.stats.categorical.durations.groups;
  const groups=durations.filter(g=>g.included.some(v=>ids.includes(v.id)));
  assert.equal(groups.length,2);assert.ok(groups.every(g=>g.n===1&&!('average' in g)));
  const before=(await db.query('SELECT * FROM fibonacci_observation WHERE id=$1',[id])).rows[0];
  assert.deepEqual(before.evidence,detail.data.evidence);
  const invalid=await call('POST','',{...input,timeframe:'unbekannt'},{'Idempotency-Key':randomUUID()});assert.equal(invalid.status,422);
  const report={localSyntheticOnly:true,actualNextHttpAndPostgres:true,noteAndExpansionBasisOptional:true,levelSelectionWithoutExactMaximum:true,cTargetMissConfirmed:true,reversalDistributionConfirmed:true,stableRetryVersion:1,requiredTimeframeRejection:true,separateDurationGroups:groups.map(g=>({degree:g.degree,timeframe:g.timeframe,n:g.n,buckets:g.distribution.filter(d=>d.n).map(d=>d.bucket)})),apiDatabaseReadbackEqual:true,catalogueLevels:filtered.data.catalogue.levels.length};
  if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n','utf8');
  console.log(JSON.stringify(report));
}finally{
  await db.query('DELETE FROM assistant_api_token WHERE id=$1',[tokenId]).catch(()=>{});await db.end();
}
