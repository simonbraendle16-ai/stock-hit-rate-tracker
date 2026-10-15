// Explicit operations only. No credential creation, external jobs or provider calls.
import {loadEnvFile} from 'node:process'
import pg from 'pg'
const [command,portfolioArg,anchorArg]=process.argv.slice(2)
const portfolioId=Number(portfolioArg),anchor=Number(anchorArg)
if(!['prepare','status','enable','disable'].includes(command)||!Number.isSafeInteger(portfolioId)||portfolioId<=0||!Number.isSafeInteger(anchor)||anchor<=0||process.argv.length!==5)throw Error('Aufruf: node scripts/demo-cycle-control.mjs prepare|status|enable|disable DEPOT ANKERTRADE')
loadEnvFile(process.env.DEMO_MIGRATION_ENV_FILE??'.env.local')
const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:8000,statement_timeout:8000})
try{
  await client.connect();await client.query('BEGIN')
  const owner=await client.query(`SELECT p."userId" FROM portfolio p JOIN trade t ON t."portfolioId"=p.id AND t."userId"=p."userId" WHERE p.id=$1 AND t.id=$2 AND p.kind='demo' AND p."archivedAt" IS NULL FOR UPDATE OF p`,[portfolioId,anchor])
  if(owner.rowCount!==1)throw Error('Eigenes nicht archiviertes Demodepot mit Ankertrade nicht eindeutig.')
  const userId=owner.rows[0].userId
  if(command==='prepare')await client.query(`INSERT INTO demo_cycle_state("portfolioId","userId")VALUES($1,$2)ON CONFLICT DO NOTHING`,[portfolioId,userId])
  if(command==='enable'){
    if(process.env.DEMO_CYCLE_EXTERNAL_JOB_VERIFIED!=='1')throw Error('Erst produktiven Endpunkt und gespeicherten externen Job prüfen; DEMO_CYCLE_EXTERNAL_JOB_VERIFIED=1 erforderlich.')
    await client.query(`UPDATE demo_cycle_state SET enabled=true,"nextRunAt"=now() WHERE "portfolioId"=$1 AND "userId"=$2`,[portfolioId,userId])
  }
  if(command==='disable')await client.query(`UPDATE demo_cycle_state SET enabled=false WHERE "portfolioId"=$1 AND "userId"=$2`,[portfolioId,userId])
  const result=await client.query(`SELECT "portfolioId",enabled,"nextRunAt","leaseUntil","cycleId","cycleStartedAt","completedAt","lastAutomaticAt",phase,results,error FROM demo_cycle_state WHERE "portfolioId"=$1 AND "userId"=$2`,[portfolioId,userId])
  const ticks=await client.query(`SELECT trigger,"startedAt","finishedAt",outcome,report FROM demo_cycle_tick WHERE "portfolioId"=$1 AND "userId"=$2 ORDER BY "startedAt" DESC LIMIT 30`,[portfolioId,userId])
  await client.query('COMMIT')
  console.log(JSON.stringify({at:new Date().toISOString(),operation:command,state:result.rows,ticks:ticks.rows},null,2))
}catch(error){await client.query('ROLLBACK').catch(()=>{});console.error(error.message);process.exitCode=1}finally{await client.end()}
