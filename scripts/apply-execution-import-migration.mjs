import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import pg from 'pg'

export async function migrateExecutionImport(client){
  await client.query('BEGIN')
  try{
    await client.query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='30s'")
    await client.query('LOCK TABLE trade IN ACCESS EXCLUSIVE MODE')
    const fingerprint=async()=>(await client.query(`SELECT count(*)::int count,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) hash FROM trade t`)).rows[0]
    const before=await fingerprint()
    await client.query(readFileSync(new URL('../drizzle/0061_execution_import.sql',import.meta.url),'utf8'))
    if(JSON.stringify(before)!==JSON.stringify(await fingerprint()))throw new Error('Existing trades changed')
    await client.query('COMMIT')
    return {migration:'0061',existingTradesUnchanged:true,count:before.count}
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv.includes('--apply'))console.log('Dry-run: execution import 0061. Explicit EXECUTION_IMPORT_DATABASE_URL and --apply required.')
  else{
    let client
    try{
      const url=new URL(process.env.EXECUTION_IMPORT_DATABASE_URL??'')
      if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname.includes('-pooler'))throw new Error('Direct connection required')
      url.searchParams.set('sslmode','verify-full')
      client=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:15000})
      await client.connect();console.log(JSON.stringify(await migrateExecutionImport(client)))
    }catch(e){console.error(`Execution import migration failed (${e.code??e.name}); secrets suppressed.`);process.exitCode=1}
    finally{await client?.end().catch(()=>{})}
  }
}
