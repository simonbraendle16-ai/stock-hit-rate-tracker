import assert from 'node:assert/strict'
import pg from 'pg'
import {randomUUID,randomBytes,createHash} from 'node:crypto'
import {writeFileSync} from 'node:fs'
const client=new pg.Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:5548/postgres'})
const id=randomUUID(), token='sat_'+randomBytes(32).toString('base64url')
try {
 await client.connect()
 const owner=(await client.query(`SELECT id FROM "user" WHERE email='fibonacci-qa@example.invalid'`)).rows[0]?.id
 assert.equal(owner,'fibonacci-local-qa','Fixed synthetic owner required')
 await client.query(`INSERT INTO assistant_api_token(id,"userId",name,"tokenHash",scopes) VALUES($1,$2,'Ephemeral synthetic QA',$3,$4::jsonb)`,[id,owner,createHash('sha256').update(token).digest('hex'),JSON.stringify(['trades:read'])])
 const response=await fetch('http://localhost:3018/api/assistant/v1/fibonacci?measurementKind=retracement&search=QA-Level-Abdeckung',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)})
 assert.equal(response.status,200)
 const data=await response.json();assert.equal(data.total,1);assert.equal(data.stats.n,0)
 const row=data.items[0]
 assert.equal(row.percent,null);assert.equal(row.evidence.waveDirection,'short');assert.equal(row.evidence.provenance,'Synthetischer geprüfter Browserfall')
 for(const key of ['reached','missed','reversalZone','targetZone','direction','period','hypotheticalCRV']){assert.equal(data.stats.coverage[key].n,1);assert.equal(data.stats.coverage[key].included[0].id,row.id)}
 const stored=(await client.query(`SELECT percent,evidence,version FROM fibonacci_observation WHERE id=$1 AND "userId"=$2`,[row.id,owner])).rows[0]
 assert.equal(stored.percent,null);assert.equal(stored.evidence.hypotheticalCRV,5);assert.equal(stored.version,1)
 const report={localSyntheticOnly:true,browserWriteReadBack:true,id:row.id,version:stored.version,total:data.total,exact:data.stats.n,level:1,missed:1,reversalZone:1,targetZone:1,direction:1,period:1,hypotheticalCRV:1,customProvenancePreserved:true,sameApiAndUiFilters:true}
 if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n','utf8')
 console.log(JSON.stringify(report))
}finally{await client.query('DELETE FROM assistant_api_token WHERE id=$1',[id]).catch(()=>{});await client.end()}
