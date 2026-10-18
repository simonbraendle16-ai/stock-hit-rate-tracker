// Fixed local synthetic account only; never loads environment files or production data.
import assert from 'node:assert/strict'
import pg from 'pg'
import {randomUUID,randomBytes,createHash} from 'node:crypto'
import {writeFileSync} from 'node:fs'
const client = new pg.Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:5548/postgres'})
const id=randomUUID(),token='sat_'+randomBytes(32).toString('base64url')
try {
  await client.connect()
  const owner=(await client.query(`SELECT id FROM "user" WHERE email='fibonacci-qa@example.invalid'`)).rows[0]?.id
  assert.equal(owner,'fibonacci-local-qa')
  await client.query(`INSERT INTO assistant_api_token(id,"userId",name,"tokenHash",scopes) VALUES($1,$2,'Ephemeral residence QA',$3,$4::jsonb)`,[id,owner,createHash('sha256').update(token).digest('hex'),JSON.stringify(['trades:read'])])
  const get=async path=>{
    const response=await fetch('http://localhost:3018/api/assistant/v1/fibonacci'+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)})
    assert.equal(response.status,200)
    return response.json()
  }
  const data=await get('?measurementKind=retracement&limit=100')
  const row=data.items.find(r=>r.evidence?.targetZoneResidence?.originalText?.includes('Synthetischer Prüffall: Touch-and-Go'))
  assert.ok(row,'Save the synthetic browser residence case first')
  const detail=await get('/'+row.id),r=detail.evidence.targetZoneResidence
  assert.equal(r.touchAndGo,true);assert.equal(r.kind,'upper_bound');assert.equal(r.upper,1);assert.equal(r.upperInclusive,false);assert.equal(r.unit,'day');assert.ok(!('value' in r));assert.deepEqual(r.zone,[61.8,88.7])
  const c=data.stats.coverage
  for(const key of ['targetZoneResidence','residenceKind','touchAndGo'])assert.ok(c[key].included.some(v=>v.id===row.id))
  assert.ok(c.residenceComparisons.excluded.some(v=>v.id===row.id))
  assert.ok(c.residenceComparisons.groups.every(g=>g.included.every(v=>v.id!==row.id)))
  const revisions=(await get('/'+row.id+'/revisions')).items
  assert.ok(revisions.some(v=>v.snapshot.evidence?.targetZoneResidence?.kind==='exact' && v.snapshot.evidence.targetZoneResidence.value===8 && v.snapshot.evidence.targetZoneResidence.touchAndGo===false))
  const stored=(await client.query(`SELECT evidence,version FROM fibonacci_observation WHERE id=$1 AND "userId"=$2`,[row.id,owner])).rows[0]
  assert.deepEqual(stored.evidence,detail.evidence)
  const unknown=data.items.find(r=>r.note?.startsWith('QA-Unknown-residence'))
  assert.ok(unknown,'Create the unknown-duration browser case first')
  const unknownDetail=await get('/'+unknown.id)
  assert.equal(unknownDetail.evidence.targetZoneResidence.kind,'unknown')
  assert.equal(unknownDetail.evidence.targetZoneResidence.touchAndGo,null)
  for(const key of ['value','lower','upper'])assert.ok(!(key in unknownDetail.evidence.targetZoneResidence))
  const report={localSyntheticOnly:true,browserWriteApiReadDatabaseMatch:true,id:row.id,version:stored.version,strictUpperBound:r,touchCoverageConfirmed:true,excludedFromExactAverage:true,longerStayEightHoursInRevision:true,revisionCount:revisions.length,unknownBrowserCreateGetConfirmed:true,unknownId:unknown.id}
  if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n','utf8')
  console.log(JSON.stringify(report))
} finally {
  await client.query('DELETE FROM assistant_api_token WHERE id=$1',[id]).catch(()=>{})
  await client.end()
}
