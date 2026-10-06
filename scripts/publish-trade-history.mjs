// Explicit release runner: verify the deployed database, retain a backup branch,
// then apply only the previously tested additive migration 0047.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { parseEnv } from 'node:util'
import pg from 'pg'
import { migrateTradeHistory } from './apply-trade-history-migration.mjs'

const stateFile=join(tmpdir(),'trading-history-release-2026-10-06.json')
async function main() {
  const local=parseEnv(readFileSync('C:/Users/sabin/Documents/Codex/Projects/Apps/stock-hit-rate-tracker/.env.local','utf8'))
  const deployed=parseEnv(readFileSync(join(tmpdir(),'trading-history-production-2026-10-06.env'),'utf8'))
  const url=new URL(deployed.DATABASE_URL_UNPOOLED??deployed.DATABASE_URL)
  const localUrl=new URL(local.DATABASE_URL_UNPOOLED??local.DATABASE_URL)
  const host=u=>u.hostname.replace('-pooler','')
  if(host(url)!==host(localUrl)||url.pathname!==localUrl.pathname)throw new Error('Production configuration mismatch')
  url.hostname=host(url);url.searchParams.set('sslmode','verify-full')
  const credentials=JSON.parse(readFileSync(join(homedir(),'.config/neon/credentials.json'),'utf8'))
  const api=async(path,method='GET',body)=>{
    const response=await fetch(`https://console.neon.tech/api/v2${path}`,{method,headers:{Authorization:`Bearer ${credentials.access_token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)})
    if(!response.ok)throw new Error(`Neon HTTP ${response.status}`)
    return response.json()
  }
  const projectId=local.NEON_PROJECT_ID
  if(!projectId)throw new Error('Existing project required')
  const {endpoints}=await api(`/projects/${projectId}/endpoints`)
  const endpoint=endpoints.find(e=>e.host===host(url))
  if(!endpoint)throw new Error('Production endpoint not identified')
  if(process.argv[2]==='backup') {
    let state
    if(existsSync(stateFile))state=JSON.parse(readFileSync(stateFile,'utf8'))
    else {
      const name=`pre-trade-history-${new Date().toISOString().replace(/[:.]/g,'-')}`
      const {branch}=await api(`/projects/${projectId}/branches`,'POST',{branch:{name,parent_id:endpoint.branch_id}})
      state={projectId,productionBranchId:endpoint.branch_id,backupBranchId:branch.id,backupName:name,createdAt:new Date().toISOString(),previousDeploymentId:'dpl_Cu5VWXReZ1d6ekgvF8AHdXkGND27'}
      writeFileSync(stateFile,JSON.stringify(state,null,2))
    }
    if(state.projectId!==projectId||state.productionBranchId!==endpoint.branch_id)throw new Error('Verified backup required')
    for(let i=0;i<40;i++) {
      const checked=(await api(`/projects/${projectId}/branches/${state.backupBranchId}`)).branch
      if(checked.parent_id!==endpoint.branch_id||checked.name!==state.backupName)throw new Error('Verified backup required')
      if(checked.current_state==='ready'){console.log(JSON.stringify({...state,backupState:checked.current_state}));return}
      await new Promise(resolve=>setTimeout(resolve,500))
    }
    throw new Error('Backup not ready')
  }
  if(process.argv[2]!=='migrate')throw new Error('Use backup|migrate')
  const state=JSON.parse(readFileSync(stateFile,'utf8'))
  const {branch}=await api(`/projects/${projectId}/branches/${state.backupBranchId}`)
  if(state.projectId!==projectId||state.productionBranchId!==endpoint.branch_id||branch.parent_id!==endpoint.branch_id||branch.current_state!=='ready'||branch.name!==state.backupName)throw new Error('Verified backup required')
  const client=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:15000})
  try {
    await client.connect()
    const report=await migrateTradeHistory(client)
    state.migration={number:'0047',appliedAt:new Date().toISOString(),...report}
    writeFileSync(stateFile,JSON.stringify(state,null,2))
    console.log(JSON.stringify(state))
  }finally{await client.end().catch(()=>{})}
}
main().catch(e=>{const safe=['Production configuration mismatch','Release backup state already exists','Backup not ready','Existing project required','Production endpoint not identified','Verified backup required','Use backup|migrate'];console.error(`Release preparation failed (${e.message.startsWith('Neon HTTP')||safe.includes(e.message)?e.message:e.code??e.name}); secrets suppressed`);process.exitCode=1})
