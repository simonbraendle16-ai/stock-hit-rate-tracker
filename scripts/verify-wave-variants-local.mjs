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
  await client.query(`INSERT INTO assistant_api_token(id,"userId",name,"tokenHash",scopes) VALUES($1,$2,'Ephemeral wave variant QA',$3,$4::jsonb)`,[id,owner,createHash('sha256').update(token).digest('hex'),JSON.stringify(['trades:read'])]);
  const get=async path=>{const response=await fetch('http://localhost:3018/api/assistant/v1/fibonacci'+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});assert.equal(response.status,200);return response.json();};
  const data=await get('?limit=1'),rowId='71000000-0000-4000-8000-000000000001';
  assert.equal(data.total,4);assert.equal(data.items.length,1);
  const detail=await get('/'+rowId),stored=(await client.query('SELECT evidence,version,wave FROM fibonacci_observation WHERE id=$1 AND "userId"=$2',[rowId,owner])).rows[0];
  assert.equal(stored.wave,'B');assert.equal(stored.version,2);assert.equal(stored.evidence.waveVariant,'b_undershooting');assert.deepEqual(detail.evidence,stored.evidence);
  const group=data.stats.categorical.waveVariants.find(g=>g.wave==='B');
  assert.equal(group.n,2);assert.equal(group.denominator,3);assert.equal(group.excluded.length,1);
  assert.deepEqual(group.distribution.map(d=>[d.code,d.n,d.share]),[['b_overshooting',0,0],['b_undershooting',2,100]]);
  assert.equal((await get('?waveVariant=c_truncated')).total,1);
  assert.equal((await get('?waveVariant=b_undershooting')).total,2);
  const revisions=await get('/'+rowId+'/revisions');assert.ok(revisions.items.some(r=>r.snapshot.evidence.waveVariant==='b_overshooting'));
  const report={checkedAt:new Date().toISOString(),syntheticOnly:true,browserCorrectionSaved:true,apiDatabaseMatch:true,version:2,baseWavePreserved:true,variantUpdated:true,unknownExcluded:true,statisticsBeforePagination:true,revisionRetained:true};
  if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await client.query('DELETE FROM assistant_api_token WHERE id=$1',[id]).catch(()=>{});await client.end();}
