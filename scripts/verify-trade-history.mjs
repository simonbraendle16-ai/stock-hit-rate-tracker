import { spawn } from 'node:child_process'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import pg from 'pg'
import { readTestTarget } from './trade-history-test-target.mjs'
import { migrateTradeHistory } from './apply-trade-history-migration.mjs'

const target=readTestTarget()
const base='http://localhost:3106'
const fixtureFile=join(tmpdir(),'trading-history-qa-fixture-2026-10-06.json')
const reportFile=join(tmpdir(),'trading-history-qa-report-2026-10-06.json')
const connectionString=target.connectionString
async function database(){const client=new pg.Client({connectionString,connectionTimeoutMillis:15000});await client.connect();return client}
async function migration(){
  const client=await database(),blocker=await database()
  try {
    const first=await migrateTradeHistory(client),second=await migrateTradeHistory(client)
    assert.deepEqual(first.fingerprint,second.fingerprint)
    const metadata=(await client.query('SELECT current_user AS role,version() AS version')).rows[0]
    await client.query('BEGIN READ ONLY')
    await assert.rejects(client.query('INSERT INTO trade_action_request ("userId","tradeId","requestKey","requestHash",response) VALUES (\'readonly\',0,\'readonly\',\'readonly\',\'{}\')'),e=>e.code==='25006')
    await client.query('ROLLBACK')
    await blocker.query('BEGIN');await blocker.query('LOCK TABLE trade IN ACCESS EXCLUSIVE MODE')
    try {await assert.rejects(migrateTradeHistory(client),e=>e.code==='55P03')} finally {await blocker.query('ROLLBACK')}
    const report={branchId:target.branchId,migration:'0047',appliedTwice:true,readOnlyWriteRejected:true,lockTimeoutRolledBack:true,...first,metadata}
    writeFileSync(reportFile,JSON.stringify(report,null,2))
    console.log(JSON.stringify(report,null,2))
  }finally{await blocker.end();await client.end()}
}
async function runNext(mode){
  const env={...process.env,DATABASE_URL:connectionString,DATABASE_URL_UNPOOLED:connectionString,BETTER_AUTH_SECRET:'isolated-history-qa-only-2026-10-06-change-before-any-real-use',BETTER_AUTH_URL:base,NEXT_TELEMETRY_DISABLED:'1',ASSISTANT_TEST_DATABASE_URL:connectionString,ASSISTANT_TEST_API_BASE_URL:base}
  delete env.ASSISTANT_API_TOKEN;delete env.ASSISTANT_API_BASE_URL
  const args=mode==='build'?['node_modules/next/dist/bin/next','build']:mode==='serve'?['node_modules/next/dist/bin/next','start','-p','3106']:['scripts/smoke-assistant-trade-write.mjs']
  const child=spawn(process.execPath,args,{env,stdio:'inherit',windowsHide:true})
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal))
  process.exitCode=await new Promise(resolve=>child.once('exit',code=>resolve(code??1)))
}
async function http(){
  const client=await database(),source=()=>({kind:'user_statement',confirmedByUser:true,capturedAt:new Date().toISOString()})
  let token,readToken,otherToken,userId
  const counters={requests:0}
  async function request(path,{method='GET',body,version,key,auth=token,status=200}={}) {
    counters.requests++
    const response=await fetch(`${base}/api/assistant/v1${path}`,{method,headers:{...(auth?{Authorization:`Bearer ${auth}`} : {}),...(body?{'Content-Type':'application/json'}:{}),...(version?{'X-Expected-Version':String(version)}:{}),...(key?{'Idempotency-Key':key}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)})
    const data=await response.json()
    assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(data)}`)
    return data
  }
  try {
    const email=`history-qa-${randomUUID()}@example.invalid`,password=`History-QA-${randomBytes(12).toString('hex')}`
    const signup=await fetch(`${base}/api/auth/sign-up/email`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({email,password,name:'Isolierte Historienprüfung'})})
    assert.equal(signup.status,200)
    const registered=await signup.json();userId=registered.user.id
    const portfolioId=(await client.query('INSERT INTO portfolio ("userId",name,kind,currency,"startCapital") VALUES ($1,\'Historienprüfung\',\'echtgeld\',\'EUR\',10000) RETURNING id',[userId])).rows[0].id
    async function apiToken(owner,scopes){const raw=`sat_${randomBytes(32).toString('base64url')}`;await client.query('INSERT INTO assistant_api_token ("userId",name,"tokenHash",scopes) VALUES ($1,\'Isolated QA\',$2,$3::jsonb)',[owner,createHash('sha256').update(raw).digest('hex'),JSON.stringify(scopes)]);return raw}
    token=await apiToken(userId,['trades:read','trades:write']);readToken=await apiToken(userId,['trades:read'])
    const other=`history-other-${randomUUID()}`
    await client.query('INSERT INTO "user" (id,name,email) VALUES ($1,\'Other isolated user\',$2)',[other,`${other}@example.invalid`]);otherToken=await apiToken(other,['trades:read','trades:write'])
    const payload={portfolioId,ticker:'HISTQA',market:'sonstiges',tradeKind:'schnell',direction:'long',entryPrice:100,stopLoss:90,takeProfit:120,quoteCurrency:'EUR',positionSize:10,source:source()}
    const creationKey=randomUUID(),created=await request('/trades',{method:'POST',body:payload,key:creationKey,status:201}),id=created.id
    assert.equal((await request('/trades',{method:'POST',body:payload,key:creationKey})).id,id)
    await request('/trades',{method:'POST',body:{...payload,takeProfit:121},key:creationKey,status:409})
    await request(`/trades/${id}`,{auth:null,status:401});await request(`/trades/${id}`,{auth:otherToken,status:404})
    await request(`/trades/${id}`,{method:'PATCH',auth:readToken,body:{notes:'Unauthorized'},version:created.version,status:403})
    let current=await request(`/trades/${id}`)
    const metadata={notes:'Synthetic QA note'}
    await request(`/trades/${id}`,{method:'PATCH',body:metadata,version:current.version})
    await request(`/trades/${id}`,{method:'PATCH',body:metadata,version:current.version})
    current=await request(`/trades/${id}`);assert.equal(current.events.length,1)
    await request(`/trades/${id}`,{method:'PATCH',body:{notes:'Stale'},version:created.version,status:409})
    await request(`/trades/${id}`,{method:'PATCH',body:{positionSize:12},version:current.version,status:422})
    const concurrentVersion=current.version
    const concurrent=await Promise.all(['Concurrent A','Concurrent B'].map(notes=>fetch(`${base}/api/assistant/v1/trades/${id}`,{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Expected-Version':String(concurrentVersion)},body:JSON.stringify({notes})})))
    assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409])
    current=await request(`/trades/${id}`)
    await request(`/trades/${id}`,{method:'PATCH',body:{notes:'Synthetic final plan',positionSize:10,source:source()},version:current.version})
    current=await request(`/trades/${id}`)
    async function action(action,fields={},offset=0){
      const observed=source()
      const body={action,source:observed,at:observed.capturedAt,...fields},key=randomUUID(),version=current.version
      const saved=await request(`/trades/${id}/actions`,{method:'POST',body,key,version})
      const replay=await request(`/trades/${id}/actions`,{method:'POST',body,key,version});assert.deepEqual(replay,saved)
      await request(`/trades/${id}/actions`,{method:'POST',body:{...body,note:'Different request'},key,version,status:409})
      current=await request(`/trades/${id}`);return saved
    }
    await action('activate',{price:100,quantity:10,mood:{note:'Synthetic entry answer'}})
    assert.equal(current.events.find(e=>e.type==='eroeffnet').quantity,10)
    await action('add',{price:110,quantity:2},1000)
    await action('partialClose',{price:120,quantity:3},2000)
    await action('management',{patch:{stopLoss:95,targets:[{price:115,sharePct:50}]},reason:'Synthetic trailing condition',assessment:{assessment:'plan',reason:'Synthetic confirmed plan',source:'user_statement'}},2500)
    await action('close',{price:115,quantity:9},3000)
    assert.equal(current.reviewPending,true);assert.equal(current.followedPlan,null)
    const partial=current.events.find(e=>e.type==='teilverkauf'),opening=current.events.find(e=>e.type==='eroeffnet')
    async function revise(eventId,patch,status=200){const saved=await request(`/trades/${id}/events/${eventId}/revisions`,{method:'POST',body:{patch,reason:'Synthetic execution correction',source:source()},version:current.version,key:randomUUID(),status});current=await request(`/trades/${id}`);return saved}
    await revise(opening.id,{quantity:1},409);assert.equal(current.eventRevisions.length,0)
    await revise(partial.id,{price:121});await revise(partial.id,{price:122});assert.equal(current.eventRevisions.length,2)
    assert.equal(current.eventRevisions[0].before.price,120);assert.equal(current.eventRevisions[1].after.price,122)
    async function review(fields,status=200){await request(`/trades/${id}/review`,{method:'PATCH',body:{source:source(),...fields},version:current.version,key:randomUUID(),status});current=await request(`/trades/${id}`)}
    await review({status:'deferred',deferredUntil:new Date(Date.now()+86400000).toISOString()});assert.equal(current.reviewPending,false)
    await review({status:'skipped',reason:'Synthetic skip'});assert.equal(current.followedPlan,null)
    await review({status:'pending'});assert.equal(current.reviewPending,true)
    await review({status:'completed',followedPlan:false,mood:{note:'Synthetic free-form exit reflection'}});assert.equal(current.reviewPending,false)
    const loss=await request('/trades',{method:'POST',body:{...payload,ticker:'LOSSQA'},key:randomUUID(),status:201})
    let lossCurrent=await request(`/trades/${loss.id}`)
    for(const [action,price] of [['activate',100],['close',90]]){
      const observed=source()
      await request(`/trades/${loss.id}/actions`,{method:'POST',body:{action,price,quantity:10,source:observed,at:observed.capturedAt,...(action==='activate'?{mood:{note:'Synthetic loss entry'}}:{})},key:randomUUID(),version:lossCurrent.version})
      lossCurrent=await request(`/trades/${loss.id}`)
    }
    assert.equal(lossCurrent.result,'verlust')
    const lossReview={status:'completed',followedPlan:false,mood:{note:'Synthetic honest loss answer'},source:source()}
    await request(`/trades/${loss.id}/review`,{method:'PATCH',body:lossReview,key:randomUUID(),version:lossCurrent.version,status:422})
    await request(`/trades/${loss.id}/review`,{method:'PATCH',body:{...lossReview,lossAccepted:false},key:randomUUID(),version:lossCurrent.version})
    const lossRead=await request(`/trades/${loss.id}`);assert.equal(lossRead.reviewPending,false);assert.equal(lossRead.reviewLossAccepted,false)
    const foreignPlan=await request('/trades',{method:'POST',body:{...payload,ticker:'FXQA'},key:randomUUID(),status:201})
    // Seed a frozen foreign-currency model solely in the isolated synthetic fixture.
    await client.query('UPDATE trade SET "entryPrice"=39.41,"stopLoss"=36,"takeProfit"=48.5,"positionSize"=20,"investedAmount"=883.09928,"leverage"=1,"quoteCurrency"=\'EUR\',"accountCurrency"=\'USD\',"quoteToAccountRate"=1.1204,"fxRateAt"=now() WHERE id=$1 AND "userId"=$2',[foreignPlan.id,userId])
    const fxBefore=await request(`/trades/${foreignPlan.id}`)
    const fxPatch={entryPrice:39,positionSize:20,investedAmount:873.912,notes:'Synthetic current entry 39; former entry historical',planContext:{version:1,expectedMove:'Synthetic move',entryTrigger:'39 EUR',riskConfirmed:true,stopManagement:'Synthetic stop condition',targetManagement:'Synthetic target condition'},source:source()}
    await request(`/trades/${foreignPlan.id}`,{method:'PATCH',body:{...fxPatch,investedAmount:883.09928},version:fxBefore.version,status:422})
    const fxAfter=await request(`/trades/${foreignPlan.id}`,{method:'PATCH',body:fxPatch,version:fxBefore.version})
    assert.equal(fxAfter.positionSize,20);assert.equal(fxAfter.investedAmount,873.912);assert.equal(fxAfter.quoteToAccountRate,1.1204)
    assert.equal(fxAfter.fxRateAt,fxBefore.fxRateAt)
    const legacy=await request('/trades',{method:'POST',body:{...payload,ticker:'OLDQA'},key:randomUUID(),status:201})
    await client.query('UPDATE trade SET status=\'abgeschlossen\',"closedAt"=now(),"reviewStatus"=NULL,"followedPlan"=NULL WHERE id=$1 AND "userId"=$2',[legacy.id,userId])
    assert.equal((await request(`/trades/${legacy.id}`)).reviewPending,false)
    assert.equal((await request('/trades?reviewStatus=pending')).items.some(t=>t.id===legacy.id),false)
    // Protected evidence is synthetic and exists only on the verified test clone.
    await client.query('UPDATE trade_event SET payload=$1 WHERE id=$2 AND "userId"=$3',[JSON.stringify({source:'broker'}),opening.id,userId])
    await revise(opening.id,{price:101},409)
    await client.query('UPDATE trade_event SET payload=$1 WHERE id=$2 AND "userId"=$3',[JSON.stringify({source:'user_statement',planningSnapshot:{entryPrice:100,stopLoss:90,takeProfit:120,positionSize:10,quoteCurrency:'EUR',accountCurrency:'EUR'}}),opening.id,userId])
    writeFileSync(fixtureFile,JSON.stringify({email,password,userId,tradeId:id,legacyTradeId:legacy.id,fxTradeId:foreignPlan.id,portfolioId,base}),{mode:0o600})
    console.log(JSON.stringify({httpVerified:true,requests:counters.requests,tradeId:id,legacyTradeId:legacy.id,branchId:target.branchId}))
  }finally{await client.end()}
}
async function verifyUi() {
  const fixture=JSON.parse(readFileSync(fixtureFile,'utf8')),client=await database()
  const token=`sat_${randomBytes(32).toString('base64url')}`,hash=createHash('sha256').update(token).digest('hex')
  try {
    await client.query('INSERT INTO assistant_api_token ("userId",name,"tokenHash",scopes) VALUES ($1,\'Isolated UI readback\',$2,$3::jsonb)',[fixture.userId,hash,JSON.stringify(['trades:read'])])
    const get=async id=>{const response=await fetch(`${base}/api/assistant/v1/trades/${id}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);return response.json()}
    const [fx,review]=await Promise.all([get(fixture.fxTradeId),get(fixture.tradeId)])
    assert.equal(fx.entryPrice,39.1);assert.ok(Math.abs(fx.positionSize-20)<1e-10);assert.equal(fx.investedAmount,876.1528);assert.equal(fx.quoteToAccountRate,1.1204)
    assert.equal(fx.notes,'Synthetische Editor-Abnahme: Entry 39,1 EUR bei 20 Einheiten.')
    assert.equal(review.reviewPending,false);assert.equal(review.followedPlan,false)
    assert.equal(review.moodExitNote,'Synthetische Browser-Abnahme: bewusste Wiederöffnung.')
    console.log(JSON.stringify({uiApiReadbackVerified:true,fx:{entryPrice:fx.entryPrice,positionSize:fx.positionSize,investedAmount:fx.investedAmount,quoteToAccountRate:fx.quoteToAccountRate},review:{status:review.reviewStatus,followedPlan:review.followedPlan}}))
  } finally {await client.query('DELETE FROM assistant_api_token WHERE "tokenHash"=$1',[hash]);await client.end()}
}
const mode=process.argv[2]
try{if(mode==='migrate')await migration();else if(['build','serve','legacy-smoke'].includes(mode))await runNext(mode);else if(mode==='http')await http();else if(mode==='verify-ui')await verifyUi();else throw new Error('Use migrate|build|serve|http|legacy-smoke|verify-ui')}
catch(e){console.error(e instanceof assert.AssertionError?e.message:`Verification failed (${e.code??e.name}); secrets suppressed`);process.exitCode=1}
