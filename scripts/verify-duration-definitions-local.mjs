// Local synthetic API/DB verification after the browser correction; no .env imports.
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const client=new pg.Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:5548/postgres'});
const id=randomUUID(),token='sat_'+randomBytes(32).toString('base64url');
try {
  await client.connect();
  const owner=(await client.query(`SELECT id FROM "user" WHERE email='fibonacci-qa@example.invalid'`)).rows[0]?.id;
  assert.equal(owner,'fibonacci-local-qa');
  await client.query(`INSERT INTO assistant_api_token(id,"userId",name,"tokenHash",scopes) VALUES($1,$2,'Ephemeral duration QA',$3,$4::jsonb)`,[id,owner,createHash('sha256').update(token).digest('hex'),JSON.stringify(['trades:read'])]);
  const get=async path=>{
    const response=await fetch('http://localhost:3018/api/assistant/v1/fibonacci'+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
    assert.equal(response.status,200);return response.json();
  };
  const data=await get('?limit=1'),rowId='69000000-0000-4000-8000-000000000001';
  assert.equal(data.total,2);assert.equal(data.items.length,1);
  const detail=await get('/'+rowId),stored=(await client.query('SELECT evidence,version FROM fibonacci_observation WHERE id=$1 AND "userId"=$2',[rowId,owner])).rows[0];
  assert.deepEqual(detail.evidence,stored.evidence);
  assert.equal(stored.version,2);
  assert.equal(detail.evidence.targetZoneReversal.value,8);
  assert.equal(detail.evidence.targetZoneResidence.value,20);
  assert.equal(detail.evidence.targetZoneReversal.timeBasis,'calendar');assert.equal(detail.evidence.targetZoneResidence.timeBasis,'calendar');
  assert.equal(data.stats.coverage.reversalComparisons.groups[0].average,8);
  assert.equal(data.stats.coverage.residenceComparisons.groups[0].average,20);
  const old=await get('/69000000-0000-4000-8000-000000000002');
  assert.equal(old.evidence.reversalDurationDays,2);assert.equal(old.evidence.durations.reversal.timeBasis,'trading');assert.equal(old.evidence.targetZoneReversal,undefined);
  const revisions=await get('/'+rowId+'/revisions');
  assert.ok(revisions.items.some(r=>r.snapshot.evidence.targetZoneReversal.value===6 && r.snapshot.evidence.targetZoneResidence.value===18));
  const report={checkedAt:new Date().toISOString(),syntheticOnly:true,browserSaved:true,apiAndDatabaseMatch:true,version:2,pivotHours:8,residenceHours:20,calendarOnly:true,separateMeans:true,legacyUntouched:true,revisionRetained:true,statisticsBeforePagination:true};
  if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally {
  await client.query('DELETE FROM assistant_api_token WHERE id=$1',[id]).catch(()=>{});await client.end();
}
