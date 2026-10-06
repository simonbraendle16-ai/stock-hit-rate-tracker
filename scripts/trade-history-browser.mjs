// Windows entrypoint for the installed browser-use direct CLI, with a private QA session.
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync, mkdtempSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { pathToFileURL } from 'node:url'
const installed='C:/Users/sabin/AppData/Roaming/npm/node_modules/browser-use/dist'
const {run_direct_command}=await import(pathToFileURL(join(installed,'skill-cli/direct.js')))
const {systemChrome}=await import(pathToFileURL(join(installed,'browser/session.js')))
const state_file=join(tmpdir(),'trade-history-browser-2026-10-06.json')
async function local_launcher(){
  const port=await new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port))})})
  const user_data_dir=mkdtempSync(join(tmpdir(),'trade-history-browser-profile-'))
  const child=spawn(systemChrome.findExecutable(),['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${user_data_dir}`,'--no-first-run','--no-default-browser-check','--window-size=1440,1200','about:blank'],{detached:true,stdio:'ignore',windowsHide:true})
  child.unref()
  const cdp_url=`http://127.0.0.1:${port}`
  for(let i=0;i<100;i++){
    try{if((await fetch(`${cdp_url}/json/version`)).ok)return{cdp_url,browser_pid:child.pid,user_data_dir,owns_user_data_dir:true}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  child.kill();throw new Error('QA browser startup timed out')
}
const run=args=>run_direct_command(args,{state_file,local_launcher})
if(process.argv[2]==='authenticate'){
  const fixture=JSON.parse(readFileSync(join(tmpdir(),'trading-history-qa-fixture-2026-10-06.json'),'utf8'))
  const response=await fetch(`${fixture.base}/api/auth/sign-in/email`,{method:'POST',headers:{'Content-Type':'application/json',Origin:fixture.base},body:JSON.stringify({email:fixture.email,password:fixture.password})})
  if(!response.ok)throw new Error(`Synthetic login HTTP ${response.status}`)
  for(const header of response.headers.getSetCookie()){
    const pair=header.split(';')[0],eq=pair.indexOf('=')
    if(pair.slice(0,eq).includes('session_token'))await run(['cookies','set',pair.slice(0,eq),pair.slice(eq+1),'--domain','localhost','--http-only'])
  }
  process.exit(await run(['open',`${fixture.base}/trades/${fixture.tradeId}`]))
}else process.exit(await run(process.argv.slice(2)))
