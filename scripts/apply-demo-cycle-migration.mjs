import {loadEnvFile} from 'node:process'
import {readFileSync} from 'node:fs'
import pg from 'pg'

const flags=process.argv.slice(2)
if(flags.some(x=>x!=='--apply')||flags.length>1)throw Error('Aufruf: node scripts/apply-demo-cycle-migration.mjs [--apply]')
loadEnvFile(process.env.DEMO_MIGRATION_ENV_FILE??'.env.local')
const url=process.env.DATABASE_URL_UNPOOLED
if(!url||new URL(url).hostname.includes('-pooler'))throw Error('Direkte DATABASE_URL_UNPOOLED erforderlich.')
const client=new pg.Client({connectionString:url,connectionTimeoutMillis:8000,statement_timeout:15000})
try{
  await client.connect();await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='5s'")
  await client.query('LOCK TABLE trade,trade_event,trade_target,portfolio IN SHARE MODE')
  const snapshot=async()=>{
    const values=[]
    for(const table of ['trade','trade_event','trade_target','portfolio']){
      // Fixed identifiers only; personal rows never leave the database.
      const {rows}=await client.query(`SELECT count(*)::int AS count,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'')) AS digest FROM ${table} t`)
      values.push(rows[0])
    }
    return JSON.stringify(values)
  }
  const before=await snapshot(),migration=readFileSync(new URL('../drizzle/0055_demo_cycle.sql',import.meta.url),'utf8')
  await client.query(migration);await client.query(migration)
  if(await snapshot()!==before)throw Error('Bestandsvergleich fehlgeschlagen; automatische Rücknahme.')
  await client.query(flags.includes('--apply')?'COMMIT':'ROLLBACK')
  console.log(JSON.stringify({migration:'0055_demo_cycle',repeatable:true,personalDataUnchanged:true,applied:flags.includes('--apply')}))
}catch(error){await client.query('ROLLBACK').catch(()=>{});console.error('Demozyklus-Migration fehlgeschlagen:',error.message);process.exitCode=1}finally{await client.end()}
