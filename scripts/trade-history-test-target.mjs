import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'

export const targetFile = join(tmpdir(), 'trading-history-test-target-2026-10-06.json')
export function readTestTarget() {
  const target = JSON.parse(readFileSync(targetFile, 'utf8'))
  if (!target.branchId || target.branchId === target.parentId || !target.name.startsWith('trade-history-qa-')) throw new Error('Unverified test branch')
  const uri = new URL(target.connectionString)
  if (uri.hostname.replace('-pooler','') === target.productionHost.replace('-pooler','')) throw new Error('Production target rejected')
  uri.searchParams.set('sslmode','verify-full')
  return {...target,connectionString:uri.toString()}
}
async function main() {
  const credentials=JSON.parse(readFileSync(join(homedir(),'.config/neon/credentials.json'),'utf8'))
  const api=async(path,method='GET',body)=>{
    const response=await fetch(`https://console.neon.tech/api/v2${path}`,{method,headers:{Authorization:`Bearer ${credentials.access_token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)})
    if(!response.ok) throw new Error(`Neon HTTP ${response.status}`)
    return response.status===204?{}:response.json()
  }
  if(process.argv[2]==='cleanup') {
    if(!existsSync(targetFile)) return console.log('No test branch state to clean up')
    const target=JSON.parse(readFileSync(targetFile,'utf8'))
    if(!target.branchId||target.branchId===target.parentId||!target.name?.startsWith('trade-history-qa-'))throw new Error('Cleanup identity mismatch')
    const {branch}=await api(`/projects/${target.projectId}/branches/${target.branchId}`)
    if(branch.name!==target.name||branch.parent_id!==target.parentId) throw new Error('Cleanup identity mismatch')
    await api(`/projects/${target.projectId}/branches/${target.branchId}`,'DELETE')
    unlinkSync(targetFile)
    console.log(JSON.stringify({removedTestBranch:target.branchId}))
    return
  }
  const envFile=fileURLToPath(new URL('../.env.local',import.meta.url))
  loadEnvFile(existsSync(envFile)?envFile:'C:/Users/sabin/Documents/Codex/Projects/Apps/stock-hit-rate-tracker/.env.local')
  const production=new URL(process.env.DATABASE_URL_UNPOOLED??process.env.DATABASE_URL)
  const projects=process.env.NEON_PROJECT_ID?[{id:process.env.NEON_PROJECT_ID}]:(await api('/projects')).projects
  let match
  for(const project of projects){
    const {endpoints}=await api(`/projects/${project.id}/endpoints`)
    const endpoint=endpoints.find(e=>e.host.replace('-pooler','')===production.hostname.replace('-pooler',''))
    if(endpoint) {match={project,endpoint};break}
  }
  if(!match) throw new Error('Configured project not identified')
  if(process.argv[2]!=='create') return console.log(JSON.stringify({projectId:match.project.id,parentBranchId:match.endpoint.branch_id,credentialAvailable:true}))
  if(existsSync(targetFile)) throw new Error('Existing test target must be inspected or cleaned up first')
  const name=`trade-history-qa-${new Date().toISOString().replace(/[:.]/g,'-')}`
  const created=await api(`/projects/${match.project.id}/branches`,'POST',{branch:{name,parent_id:match.endpoint.branch_id},endpoints:[{type:'read_write'}]})
  // Save identity immediately so cleanup remains possible if provisioning fails later.
  const target={projectId:match.project.id,branchId:created.branch.id,parentId:match.endpoint.branch_id,name,productionHost:production.hostname}
  writeFileSync(targetFile,JSON.stringify(target),{mode:0o600})
  const query=new URLSearchParams({branch_id:target.branchId,database_name:production.pathname.slice(1),role_name:decodeURIComponent(production.username),pooled:'false'})
  const {uri}=await api(`/projects/${target.projectId}/connection_uri?${query}`)
  target.connectionString=uri
  writeFileSync(targetFile,JSON.stringify(target),{mode:0o600})
  readTestTarget()
  console.log(JSON.stringify({projectId:target.projectId,testBranchId:target.branchId,parentBranchId:target.parentId,name}))
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  main().catch(e=>{const safe=['Configured project not identified','Existing test target must be inspected or cleaned up first','Unverified test branch','Production target rejected'];console.error(`Test target setup failed: ${e.message.startsWith('Neon HTTP')||safe.includes(e.message)?e.message:e.code??e.cause?.code??e.name}; secrets suppressed`);process.exitCode=1})
}
