import {readFileSync} from 'node:fs';
// Synthetic local QA only. No environment file or production endpoint is read.
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const pg=createRequire("C:/Users/sabin/Documents/Agentic Coding/Apps/stock-hit-rate-tracker/package.json")('pg');
const requireTool=createRequire(join(process.env.APPDATA,'npm/node_modules/browser-use/package.json'));
const {chromium}=requireTool('playwright');
const out="C:/Users/sabin/Documents/Agentic Coding/Apps/stock-hit-rate-tracker/docs/phase3-qa/browser";await mkdir(out,{recursive:true});
const root='http://127.0.0.1:3063';
const db=new pg.Client({connectionString:'postgresql://phase3_admin:Synthetic-Phase3-Only-2026%21@127.0.0.1:5583/phase3_core'});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultTimeout(30000);
await page.context().route('**/*',route=>new URL(route.request().url()).origin===root?route.continue():route.abort());
const errors=[];page.on('pageerror',e=>errors.push(e.message));
let clicks=0;
const runTag=" "+Date.now();
const select=async(label,value,scope=page)=>{clicks+=2;await scope.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:value,exact:typeof value==='string'}).click();};
const dialog=()=>page.getByRole('dialog');
const read=async(note)=>(await db.query('SELECT * FROM fibonacci_observation WHERE note=$1',[note])).rows;
const saveWait=async(note)=>{for(let i=0;i<100;i++){const rows=await read(note);if(rows.length)return rows[0];await new Promise(r=>setTimeout(r,100));}throw Error('No synthetic DB readback for '+note);};
const open=async()=>{await page.getByRole('button',{name:'Neue Beobachtung',exact:true}).click();await dialog().waitFor();};
const base=async(wave='4')=>{
 await select('Instrument',/FIBQA-S/,dialog());await select('Welle',wave,dialog());await select('Wellengrad',/^Minor/,dialog());await select('Timeframe','1d',dialog());await select('Richtung der untersuchten Welle','Aufwärts',dialog());
};
const note=async(value)=>{await dialog().locator('summary').filter({hasText:'5 · Optionale Ergänzungen'}).click();await dialog().getByLabel('Messnotiz · optional',{exact:true}).fill(value);};
const summary=[];
try {
 await db.connect();assert.equal((await db.query('SELECT id FROM "user" WHERE email=$1',['phase3@example.invalid'])).rows[0].id,'phase3-synthetic');
 const auth=await page.context().request.post(root+'/api/auth/sign-in/email',{headers:{Origin:root},data:{email:'phase3@example.invalid',password:'Synthetic-Phase3-Only-2026!'}});assert.equal(auth.status(),200);
 await page.goto(root+'/analysis');await page.waitForURL(/fib\.perspective=panorama/);await page.waitForLoadState('networkidle');await open();
 assert.equal(await dialog().getByRole('combobox',{name:'Wellenstatus',exact:true}).innerText(),'Abgeschlossen');
 for(const label of ['Sicherheit des Musters','Sicherheit der Unterteilung'])assert.equal(await dialog().getByRole('combobox',{name:label,exact:true}).innerText(),'Bestätigt');
 assert.equal(await dialog().getByRole('combobox',{name:/Genauigkeit (Beginn|Ende)|Datumsformat/}).count(),0);
 await base();await select('Messart','Expansion',dialog());await select('Muster der untersuchten Welle','ABC · unbestimmt',dialog());await select('Innere Unterteilung','Dreiteilig',dialog());
 const target=dialog().getByRole('group',{name:'Erwartete Fibonacci-Zielzone',exact:true});
 assert.equal(await target.getByRole('combobox',{name:'Erwartete Fibonacci-Zielzone · Eingabe',exact:true}).innerText(),'Bereich');
 await select('Erwartete Fibonacci-Zielzone · Eingabe','Einzellevel',target);
 assert.equal(await target.getByRole('combobox',{name:'Bis Level',exact:true}).count(),0);
 await select('Fibonacci-Level',/· 61,8 %$/,target);
 await select('Beobachtete Umkehr','Am Fibonacci-Level',dialog());
 await select('Fibonacci-Level',/· 61,8 %$/,dialog().getByRole('group',{name:'Beobachteter Umkehrbereich',exact:true}));
 await dialog().getByLabel('Historischer Beginn',{exact:true}).fill('03.2024');await dialog().getByLabel('Historisches Ende',{exact:true}).fill('21.03.2024');
 await select('Dauerklasse','3–7 Tage',dialog().getByRole('group',{name:'Wellendauer',exact:true}));
 await note(('QA fast entry first'+runTag));
 const firstSelectionClicks=clicks;
 for(const width of [1440,1024,768,390]){
  await page.setViewportSize({width,height:1050});
  const size=await dialog().evaluate(e=>({client:e.clientWidth,scroll:e.scrollWidth}));assert.ok(size.scroll<=size.client+1,JSON.stringify({width,...size}));
  await dialog().screenshot({path:join(out,`form-${width}.png`)});
  summary.push({width,...size});
 }
 await page.setViewportSize({width:1440,height:1050});
 await dialog().getByRole('button',{name:'Speichern und weitere Welle',exact:true}).click();
 const first=await saveWait(('QA fast entry first'+runTag));
 await dialog().getByRole('combobox',{name:'Welle',exact:true}).filter({hasText:'Bitte auswählen'}).waitFor();
 assert.equal(first.status,'abgeschlossen');assert.equal(first.measurementKind,'expansion');assert.equal(first.evidence.structureConfidence,'bestaetigt');assert.equal(first.evidence.subdivisionConfidence,'bestaetigt');
 assert.deepEqual(first.evidence.targetZone,[61.8,61.8]);assert.equal(first.evidence.durations.wave.bucket,'d3_7');assert.equal(first.evidence.durationDays,undefined);
 assert.deepEqual(first.evidence.historicalTime,{start:{date:'2024-03',precision:'month'},end:{date:'2024-03-21',precision:'day'}});
 for(const [label,expected] of [['Instrument','FIBQA-S · Synthetische Aktie'],['Timeframe','1d'],['Wellengrad','Minor · 1'],['Welle','Bitte auswählen'],['Richtung der untersuchten Welle','Bitte auswählen'],['Muster der untersuchten Welle','Unbekannt'],['Innere Unterteilung','Unbekannt'],['Wellenstatus','Abgeschlossen'],['Messart','Retracement']])assert.equal(await dialog().getByRole('combobox',{name:label,exact:true}).innerText(),expected);
 assert.equal(await dialog().getByLabel('Historischer Beginn',{exact:true}).inputValue(),'');
 assert.equal(await dialog().getByLabel('Messnotiz · optional',{exact:true}).inputValue(),'');
 await select('Welle','A',dialog());await select('Richtung der untersuchten Welle','Abwärts',dialog());await note(('QA fast entry second'+runTag));
 await dialog().getByRole('button',{name:'Speichern',exact:true}).click();const second=await saveWait(('QA fast entry second'+runTag));await dialog().waitFor({state:'hidden'});
 assert.notEqual(first.id,second.id);assert.equal(second.evidence.structureConfidence,undefined);assert.equal(second.evidence.subdivisionConfidence,undefined);assert.equal(second.evidence.targetZone,undefined);assert.equal(second.evidence.waveDirection,'short');
 // Explicit uncertainty and native invalid-date prevention, followed by a failed network save and same-ID retry.
 await open();await base('B');await select('Muster der untersuchten Welle','ABC · unbestimmt',dialog());await select('Sicherheit des Musters','Vermutet',dialog());await select('Innere Unterteilung','Fünfteilig',dialog());await select('Sicherheit der Unterteilung','Unbekannt',dialog());
 await note(('QA fast entry retry'+runTag));await dialog().getByLabel('Historischer Beginn',{exact:true}).fill('31.02.2024');await dialog().getByRole('button',{name:'Speichern',exact:true}).click();assert.equal((await read(('QA fast entry retry'+runTag))).length,0);assert.equal(await dialog().getByLabel('Historischer Beginn',{exact:true}).evaluate(e=>e.validity.valid),false);
 await dialog().getByLabel('Historischer Beginn',{exact:true}).fill('2024');
 let aborted=false;await page.route('**/*',async route=>{if(!aborted&&route.request().method()==='POST'&&new URL(route.request().url()).origin===root){aborted=true;await route.abort('failed');}else await route.continue();});
 await dialog().getByRole('button',{name:'Speichern und weitere Welle',exact:true}).click();await dialog().getByRole('alert').waitFor();assert.ok(aborted);assert.equal(await dialog().getByLabel('Messnotiz · optional',{exact:true}).inputValue(),('QA fast entry retry'+runTag));assert.equal((await read(('QA fast entry retry'+runTag))).length,0);
 assert.ok(await dialog().locator('details').evaluateAll(nodes=>nodes.every(n=>n.open)));
 await page.unroute('**/*');await dialog().getByRole('button',{name:'Speichern',exact:true}).click();const retry=await saveWait(('QA fast entry retry'+runTag));await dialog().waitFor({state:'hidden'});assert.equal((await read(('QA fast entry retry'+runTag))).length,1);assert.equal(retry.version,1);assert.equal(retry.evidence.structureConfidence,'vermutet');assert.equal(retry.evidence.subdivisionConfidence,'unbekannt');
 // Correct the saved first wave through the UI and prove the same ID/revision.
 await page.goto(root+'/collection?fib.basis=1');await page.getByLabel('Wellen suchen',{exact:true}).fill('QA fast entry first'+runTag);
 await page.getByText('1 Treffer im gesamten Bestand',{exact:true}).waitFor();await page.getByRole('button',{name:'Bearbeiten',exact:true}).click();
 if(!await dialog().getByLabel('Messnotiz · optional',{exact:true}).isVisible())await dialog().locator('summary').filter({hasText:'5 · Optionale Ergänzungen'}).click();
 await dialog().getByLabel('Messnotiz · optional',{exact:true}).fill('Phase3 corrected'+runTag);await dialog().getByRole('button',{name:'Speichern',exact:true}).click();await dialog().waitFor({state:'hidden'});
 const corrected=await saveWait('Phase3 corrected'+runTag);assert.equal(corrected.id,first.id);assert.equal(corrected.version,2);
 const revisions=(await db.query('SELECT count(*)::int n FROM fibonacci_revision WHERE "observationId"=$1',[first.id])).rows[0].n;assert.ok(revisions>0);
 await page.screenshot({path:join(out,'corrected-desktop.png')});
 // Separate actual mobile save, not only a viewport screenshot of a desktop save.
 await page.setViewportSize({width:390,height:844});await page.goto(root+'/analysis');await page.waitForLoadState('networkidle');await open();await base('B');
 await note('Phase3 mobile'+runTag);await dialog().screenshot({path:join(out,'mobile-entry.png')});await dialog().getByRole('button',{name:'Speichern',exact:true}).click();const mobile=await saveWait('Phase3 mobile'+runTag);await dialog().waitFor({state:'hidden'});
 assert.notEqual(mobile.id,first.id);assert.equal(mobile.version,1);
 // Filter the real browser collection and compare its count with A.
 await page.goto(root+'/collection?fib.basis=1');await page.waitForLoadState('networkidle');writeFileSyncCompat('collection-aria.txt',await page.locator('body').ariaSnapshot());
 const total=(await db.query('SELECT count(*)::int n FROM fibonacci_observation WHERE "userId"=$1',['phase3-synthetic'])).rows[0].n;
 assert.ok((await page.getByLabel('Gespeicherter Gesamtbestand').innerText()).includes(total+' Beobachtungen insgesamt'));
 await page.getByRole('button',{name:'Weiter',exact:true}).click();await page.getByRole('navigation',{name:'Wellen-Seiten'}).getByText(new RegExp('51')).waitFor();assert.ok(await page.locator('article').count()>0);assert.ok(await page.locator('article').count()<=50);
 await page.getByRole('button',{name:'Zurück',exact:true}).click();
 await page.getByLabel('Wellen suchen',{exact:true}).fill('Phase3 mobile'+runTag);await page.getByText('1 Treffer im gesamten Bestand',{exact:true}).waitFor();assert.equal(await page.locator('article').count(),1);
 assert.ok((await page.getByLabel('Gespeicherter Gesamtbestand').innerText()).includes(total+' Beobachtungen insgesamt'));
 await page.getByRole('button',{name:'Details',exact:true}).click();await dialog().waitFor();assert.ok((await dialog().innerText()).includes('Phase3 mobile'+runTag));await dialog().screenshot({path:join(out,'mobile-saved-detail.png')});await dialog().getByRole('button',{name:'Schließen',exact:true}).click();
 await page.screenshot({path:join(out,'collection-mobile.png')});
 // Actual chart: source A has no candle table, so successful candles prove B.
 assert.equal((await db.query("SELECT to_regclass('public.candle_cache') AS relation")).rows[0].relation,null);
 await page.setViewportSize({width:1440,height:1050});
 let responsePromise=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/candles'&&r.status()===200);
 await page.goto(root+'/stock/1');const chart=await (await responsePromise).json();assert.ok(chart.candles.length>0);await page.locator('canvas').first().waitFor({state:'visible'});await page.getByText('Kurschart · FIBQA-S',{exact:true}).locator('xpath=ancestor::div[contains(@class,"panel")][1]').screenshot({path:join(out,'chart-desktop.png')});
 const controller=new pg.Client({connectionString:'postgresql://phase3_admin:Synthetic-Phase3-Only-2026%21@127.0.0.1:5583/postgres'});await controller.connect();let outageSave;
 try{
  await controller.query('ALTER DATABASE phase3_market ALLOW_CONNECTIONS false');await controller.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='phase3_market' AND application_name='tracker-market-v1'");
  responsePromise=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/candles'&&r.status()>=500);
  await page.goto(root+'/stock/1');const failed=await responsePromise;assert.equal(failed.status(),502);await page.getByText('Kursdaten konnten nicht geladen werden.',{exact:true}).first().waitFor();await page.screenshot({path:join(out,'chart-B-outage.png')});
  await page.setViewportSize({width:390,height:844});await page.goto(root+'/analysis');await page.waitForLoadState('networkidle');await open();await base('C');await note('Phase3 A save B outage'+runTag);await dialog().getByRole('button',{name:'Speichern',exact:true}).click();outageSave=await saveWait('Phase3 A save B outage'+runTag);await dialog().waitFor({state:'hidden'});assert.equal(outageSave.version,1);await page.screenshot({path:join(out,'saved-during-B-outage-mobile.png')});
 }finally{await controller.query('ALTER DATABASE phase3_market ALLOW_CONNECTIONS true');await controller.end()}
 responsePromise=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/candles'&&r.status()===200);
 await page.goto(root+'/stock/1');const recovered=await (await responsePromise).json();assert.ok(recovered.candles.length>0);await page.locator('canvas').first().waitFor({state:'visible'});await page.getByText('Kurschart · FIBQA-S',{exact:true}).locator('xpath=ancestor::div[contains(@class,"panel")][1]').screenshot({path:join(out,'chart-recovered-mobile.png')});
 const mobileLayout=await page.evaluate(()=>({width:window.innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(mobileLayout.scroll<=mobileLayout.width+1,JSON.stringify(mobileLayout));
 assert.ok(!(await page.locator('body').innerText()).includes('im 15-Minuten-Takt'));assert.ok((await page.locator('body').innerText()).includes('Stundenplan'));
 assert.deepEqual(errors,[]);
 const result={at:new Date().toISOString(),syntheticOnly:true,localEdge:true,productionBuild:readFileSync("C:/Users/sabin/Documents/Agentic Coding/Apps/stock-hit-rate-tracker/.next/BUILD_ID",'utf8').trim(),viewports:summary,mobileLayout,
  seriesSaveAndReadback:true,distinctIds:true,networkFailureRetainsDraft:true,retrySavedExactlyOnce:true,correctionSameId:true,correctionVersion:corrected.version,revisions,mobileSave:true,
  filterVisible:true,pagination:true,totalAndFilteredCounters:true,truthfulActivityNotice:true,chartReadsB:true,chartCandles:chart.candles.length,BOutageHonest502:true,personalSaveWhileBDown:outageSave.id,BRecoveryVisible:true,recoveredCandles:recovered.candles.length,pageErrors:errors};
 await writeFile(join(out,'browser.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});await writeFile(join(out,'failure-aria.txt'),await page.locator('body').ariaSnapshot().catch(()=>''));throw error;}
finally{await db.end();await browser.close();}
function writeFileSyncCompat(name,text){return writeFile(join(out,name),text)}
