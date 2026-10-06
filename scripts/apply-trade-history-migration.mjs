import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

export async function migrateTradeHistory(client) {
  await client.query('BEGIN')
  try {
    await client.query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='30s'")
    const tables=['portfolio','trade','trade_event','trade_target','journal_entry','insight','broker_order','broker_exit','trade_settlement_receipt']
    await client.query(`LOCK TABLE ${tables.join(',')} IN SHARE MODE`)
    async function fingerprint(){
      const report={}
      for(const table of tables){const projection=table==='trade'?"to_jsonb(t)-'reviewStatus'-'reviewDeferredUntil'-'reviewLossAccepted'":'to_jsonb(t)'
        report[table]=(await client.query(`SELECT count(*)::int AS count,md5(coalesce(string_agg((${projection})::text,'' ORDER BY id),'')) AS hash FROM ${table} t`)).rows[0]
      }return report
    }
    const before=await fingerprint()
    await client.query(readFileSync(new URL('../drizzle/0047_trade_history_and_review.sql',import.meta.url),'utf8'))
    const columns=(await client.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_name='trade' AND column_name IN ('reviewStatus','reviewDeferredUntil','reviewLossAccepted') ORDER BY column_name")).rows
    if(columns.length!==3) throw new Error('Review schema incomplete')
    const foreignKeys=(await client.query("SELECT count(*)::int AS count FROM pg_constraint WHERE contype='f' AND conrelid IN ('trade_action_request'::regclass,'trade_event_revision'::regclass)")).rows[0].count
    if(foreignKeys!==5) throw new Error('History ownership constraints incomplete')
    const after=await fingerprint()
    if(JSON.stringify(before)!==JSON.stringify(after)) throw new Error('Historical records changed')
    await client.query('COMMIT')
    return {historyUnchanged:true,fingerprint:before,columns,foreignKeys}
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
}
if(process.argv[1]&&resolve(fileURLToPath(import.meta.url))===resolve(process.argv[1])){
  if(!process.argv.includes('--apply')) console.log('Dry-run: additive migration 0047, no connection. Explicit TRADE_HISTORY_MIGRATION_DATABASE_URL and --apply required.')
  else {
    let client
    try {
      const target=new URL(process.env.TRADE_HISTORY_MIGRATION_DATABASE_URL??'')
      if(!['postgres:','postgresql:'].includes(target.protocol)||target.hostname.includes('-pooler')) throw new Error('Direct target required')
      target.searchParams.set('sslmode','verify-full')
      client=new pg.Client({connectionString:target.toString(),connectionTimeoutMillis:15000});await client.connect()
      const report=await migrateTradeHistory(client)
      console.log(JSON.stringify({migration:'0047',...report}))
    }catch(e){console.error(`Trade history migration failed (${e.code??e.name}); secrets suppressed.`);process.exitCode=1}
    finally{await client?.end().catch(()=>{})}
  }
}
