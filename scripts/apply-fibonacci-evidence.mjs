import pg from 'pg'
import { readFileSync } from 'node:fs'
// No env file is loaded. An explicit reviewed target is mandatory.
if (!process.argv.includes('--apply')) console.log('Prepared migration 0056. No database access. Explicit FIBONACCI_MIGRATION_DATABASE_URL and --apply required.')
else {
 let client
 try {
  const target=new URL(process.env.FIBONACCI_MIGRATION_DATABASE_URL ?? '')
  if(!['postgres:','postgresql:'].includes(target.protocol)||target.hostname.includes('-pooler'))throw Error('Direct target required')
  if(!['localhost','127.0.0.1'].includes(target.hostname))target.searchParams.set('sslmode','verify-full')
  client=new pg.Client({connectionString:target.toString(),connectionTimeoutMillis:15000});await client.connect()
  await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='30s'")
  await client.query('LOCK TABLE fibonacci_observation IN SHARE ROW EXCLUSIVE MODE')
  const fingerprint=async()=>(await client.query(`SELECT count(*)::int n,md5(coalesce(string_agg((to_jsonb(f)-'evidence')::text,'' ORDER BY id),'')) hash FROM fibonacci_observation f`)).rows[0]
  const before=await fingerprint()
  await client.query(readFileSync(new URL('../drizzle/0056_fibonacci_evidence.sql',import.meta.url),'utf8'))
  const after=await fingerprint()
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Existing values changed')
  await client.query('COMMIT');console.log(JSON.stringify({migration:'0056',existingValuesUnchanged:true,count:after.n}))
 }catch(e){await client?.query('ROLLBACK').catch(()=>{});console.error(`Evidence migration failed (${e.code ?? e.name}); secrets suppressed.`);process.exitCode=1}
 finally{await client?.end().catch(()=>{})}
}
