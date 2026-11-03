import{createRequire}from'node:module'
import{writeFileSync}from'node:fs'
const tracker='C:/Users/sabin/Documents/Agentic Coding/Apps/stock-hit-rate-tracker',root='http://127.0.0.1:3063',out=tracker+'/docs/phase3-qa/browser'
const{chromium}=createRequire('C:/Users/sabin/AppData/Roaming/npm/node_modules/browser-use/package.json')('playwright')
const{Client}=createRequire(tracker+'/package.json')('pg')
const db=new Client({host:'127.0.0.1',port:5583,user:'phase3_admin',password:'Synthetic-Phase3-Only-2026!',database:'phase3_core'});await db.connect()
const note=(await db.query('SELECT note FROM fibonacci_observation WHERE "userId"=$1 AND note LIKE $2 ORDER BY "createdAt" DESC LIMIT 1',['phase3-synthetic','Phase3 mobile%'])).rows[0].note;await db.end()
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:390,height:1400}})
await page.context().route('**/*',r=>new URL(r.request().url()).origin===root?r.continue():r.abort())
try{
 const auth=await page.context().request.post(root+'/api/auth/sign-in/email',{headers:{Origin:root},data:{email:'phase3@example.invalid',password:'Synthetic-Phase3-Only-2026!'}});if(auth.status()!==200)throw Error('Synthetic login failed')
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/candles'&&r.status()===200)
 await page.goto(root+'/stock/1');await response;await page.locator('canvas').first().waitFor({state:'visible'})
 const panel=page.getByText('Kurschart · FIBQA-S',{exact:true}).locator('xpath=ancestor::div[contains(@class,"panel")][1]')
 await panel.scrollIntoViewIfNeeded();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
 await panel.screenshot({path:out+'/chart-recovered-mobile.png'})
 await page.goto(root+'/collection?fib.basis=1');await page.getByLabel('Wellen suchen',{exact:true}).fill(note);await page.getByText('1 Treffer im gesamten Bestand',{exact:true}).waitFor();await page.screenshot({path:out+'/collection-mobile.png'})
 writeFileSync(out+'/visual-followup.json',JSON.stringify({at:new Date().toISOString(),synthetic:true,viewport:{width:390,height:1400},purpose:'Tall screenshot only; functional mobile checks separately at 390x844',collectionWithoutClosingDialogOverlay:true},null,2))
 console.log('Final mobile chart and filtered collection screenshots refreshed.')
}finally{await browser.close()}
