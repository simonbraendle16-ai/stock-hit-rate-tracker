// Local synthetic QA only. No environment files or cloud services are used.
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const client=new pg.Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:5561/postgres'});
const tokenId=randomUUID(),token='sat_'+randomBytes(32).toString('base64url'),owner='fibonacci-local-qa';
const base='http://localhost:3041/api/assistant/v1/fibonacci';
let checks=0;
try {
 await client.connect();
 assert.equal((await client.query('SELECT id FROM "user" WHERE email=$1',['fibonacci-qa@example.invalid'])).rows[0]?.id,owner);
 await client.query(`INSERT INTO stock(id,"userId",name,ticker,market) VALUES(1,$1,'Synthetic subdivision QA','SUBDIV-QA','aktien') ON CONFLICT DO NOTHING`,[owner]);
 await client.query(`INSERT INTO assistant_api_token(id,"userId",name,"tokenHash",scopes) VALUES($1,$2,'Ephemeral subdivision QA',$3,$4::jsonb)`,[tokenId,owner,createHash('sha256').update(token).digest('hex'),JSON.stringify(['trades:read','trades:write'])]);
 const call=async(path='',method='GET',body,headers={})=>{
   const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});
   const text=await r.text();assert.ok(r.ok,`${method} ${path}: ${r.status} ${text}`);checks++;return text.startsWith('{')?JSON.parse(text):text;
 };
 const input={stockId:1,wave:'A',degree:'Minor',timeframe:'1d',observedOn:'2026-10-20',status:'abgeschlossen',percent:null,note:'Synthetic local QA only',evidence:{catalogueVersion:1,waveDirection:'short',provenance:'Synthetic subdivision QA'}};
 const ids=[];
 const add=async(wave,evidence,extra={})=>{
   const id=randomUUID();ids.push(id);
   const body={...input,wave,...extra,sourceKey:'subdivision-local-'+id,evidence:{...input.evidence,...evidence}};
   await call('','POST',body,{'Idempotency-Key':id});
   return {id,body};
 };
 const parent=await add('4',{structureCode:'flat_expanded',structureConfidence:'bestaetigt'});
 const a=await add('A',{subdivision:'three_part',subdivisionConfidence:'bestaetigt',parentId:parent.id,reachedLevels:[50],missedLevels:[61.8]});
 await call('','POST',a.body,{'Idempotency-Key':a.id});
 await add('A',{subdivision:'five_part',subdivisionConfidence:'bestaetigt'});
 await add('A',{subdivision:'three_part',subdivisionConfidence:'vermutet'});
 await add('A',{subdivision:'three_part',subdivisionConfidence:'bestaetigt'},{status:'laufend'});
 await add('B',{structureCode:'abc_flat',structureConfidence:'bestaetigt',subdivision:'three_part',subdivisionConfidence:'bestaetigt'});
 const child=await add('B',{parentId:parent.id,subdivision:'three_part',subdivisionConfidence:'bestaetigt'});
 const all=await call('?limit=1');assert.equal(all.total,7);assert.equal(all.items.length,1);assert.equal(all.catalogue.subdivisions.length,3);
 const selected=await call('?wave=A&waveLabelScope=self&subdivision=three_part&subdivisionConfidence=bestaetigt&limit=1');
 assert.equal(selected.total,2);assert.equal(selected.stats.n,0);assert.equal(selected.stats.coverage.reached.n,1);
 assert.equal(selected.stats.categorical.subdivisions[0].n,1);
 assert.equal((await call('?wave=B&waveLabelScope=self&structure=family:abc_flat')).total,1);
 assert.equal((await call('/'+child.id)).evidence.structureCode,undefined);
 const old={...a.body,evidence:input.evidence};
 await call('/'+a.id,'PATCH',old,{'X-Expected-Version':'1'});
 assert.equal((await call('/'+a.id)).evidence.subdivision,'three_part');
 const corrected={...a.body,evidence:{...a.body.evidence,subdivision:'five_part'}};
 await call('/'+a.id,'PATCH',corrected,{'X-Expected-Version':'2'});
 const detail=await call('/'+a.id),stored=(await client.query('SELECT evidence,version FROM fibonacci_observation WHERE id=$1 AND "userId"=$2',[a.id,owner])).rows[0];
 assert.deepEqual(detail.evidence,stored.evidence);assert.equal(detail.version,3);
 assert.ok((await call('/'+a.id+'/revisions')).items.some(r=>r.snapshot.evidence.subdivision==='three_part'));
 const csv=await call('?format=csv&subdivision=five_part');assert.ok(csv.includes(a.id));assert.ok(csv.includes('five_part'));
 const report={checkedAt:new Date().toISOString(),syntheticOnly:true,httpChecks:checks,observations:7,retryPreservedVersion:true,legacyPreservation:true,apiDatabaseMatch:true,revisionRetained:true,ownAndParentPatternsSeparate:true,noInventedPercent:true,statisticsBeforePagination:true,editableId:a.id};
 if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
} finally {await client.query('DELETE FROM assistant_api_token WHERE id=$1',[tokenId]).catch(()=>{});await client.end();}
