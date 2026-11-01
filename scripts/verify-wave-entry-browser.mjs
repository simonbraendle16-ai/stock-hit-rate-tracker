// Synthetic local QA only. No environment file or production endpoint is read.
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import pg from 'pg';
const requireTool=createRequire(join(process.env.APPDATA,'npm/node_modules/browser-use/package.json'));
const {chromium}=requireTool('playwright');
const out=resolve('docs/wave-entry-qa');await mkdir(out,{recursive:true});
const root='http://localhost:3051';
const db=new pg.Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:5569/postgres'});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultTimeout(30000);
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
 await db.connect();assert.equal((await db.query('SELECT id FROM "user" WHERE email=$1',['fibonacci-qa@example.invalid'])).rows[0].id,'fibonacci-local-qa');
 const auth=await page.context().request.post(root+'/api/auth/sign-in/email',{headers:{Origin:root},data:{email:'fibonacci-qa@example.invalid',password:'Local-Fibonacci-QA-2026!'}});assert.equal(auth.status(),200);
 await page.goto(root+'/analysis');await page.waitForURL(/fib\.perspective=panorama/);await page.waitForLoadState('networkidle');await open();
 assert.equal(await dialog().getByRole('combobox',{name:'Wellenstatus',exact:true}).innerText(),'Abgeschlossen');
 for(const label of ['Sicherheit des Musters','Sicherheit der Unterteilung'])assert.equal(await dialog().getByRole('combobox',{name:label,exact:true}).innerText(),'Bestätigt');
 assert.equal(await dialog().getByRole('combobox',{name:/Genauigkeit (Beginn|Ende)|Datumsformat/}).count(),0);
 await base();await select('Messart','Expansion',dialog());await select('Muster der untersuchten Welle','ABC · unbestimmt',dialog());await select('Innere Unterteilung','Dreiteilig',dialog());
 const target=dialog().getByRole('group',{name:'Erwartete Fibonacci-Zielzone',exact:true});
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
 // Existing unknown confidence, old date precision and optional evidence survive a note-only edit.
 const oldId='10000000-0000-4000-8000-000000000004';
 const historical={start:{date:'2008',precision:'year',approximate:true,earliest:'2007-01-01',latest:'2009-12-31'},end:null,source:'Synthetic original time source'};
 const oldEvidence={durationDays:8,historicalTime:historical,structureCode:'abc',subdivision:'three_part',structureConfidence:'unbekannt',subdivisionConfidence:'vermutet',waveDirection:'long',targetZone:[38.2,61.8],entryZone:[50,61.8],reachedLevels:[38.2],provenance:'Synthetic historical observation'};
 await db.query('UPDATE fibonacci_observation SET evidence=$2, version=version+1 WHERE id=$1',[oldId,JSON.stringify(oldEvidence)]);
 await page.goto(root+'/analysis?fib.observationId='+oldId+'&fib.tab=protocol&fib.basis=1');await page.waitForURL(/fib\.perspective=panorama/);await page.waitForLoadState('networkidle');const row=page.getByRole('row').filter({hasText:oldId});await row.getByRole('button',{name:/bearbeiten/i}).click();
 assert.equal(await dialog().getByRole('combobox',{name:'Sicherheit des Musters',exact:true}).innerText(),'Unbekannt');assert.equal(await dialog().getByRole('combobox',{name:'Sicherheit der Unterteilung',exact:true}).innerText(),'Vermutet');
 assert.ok(await dialog().locator('summary').filter({hasText:'Erwartung und möglicher Einstieg'}).innerText().then(t=>t.includes('Angaben vorhanden')));
 await note(('QA historical preservation'+runTag));await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForTimeout(65000);assert.equal(await dialog().getByLabel('Messnotiz · optional',{exact:true}).inputValue(),('QA historical preservation'+runTag));await dialog().getByRole('button',{name:'Speichern',exact:true}).click();await dialog().waitFor({state:'hidden'});const edited=await saveWait(('QA historical preservation'+runTag));
 for(const key of Object.keys(oldEvidence))assert.deepEqual(edited.evidence[key],oldEvidence[key],key);
 assert.ok(await dialog().count()===0);
 // Range conversion requires confirmation and supports cancellation without loss.
 await page.getByRole('row').filter({hasText:oldId}).filter({hasText:('QA historical preservation'+runTag)}).waitFor();await page.getByRole('row').filter({hasText:oldId}).getByRole('button',{name:/bearbeiten/i}).click();
 const oldTarget=dialog().getByRole('group',{name:'Erwartete Fibonacci-Zielzone',exact:true});assert.equal(await oldTarget.getByRole('combobox',{name:'Bis Level',exact:true}).count(),1);
 page.once('dialog',d=>d.dismiss());await select('Erwartete Fibonacci-Zielzone · Eingabe','Einzellevel',oldTarget);assert.equal(await oldTarget.getByRole('combobox',{name:'Bis Level',exact:true}).count(),1);
 page.once('dialog',d=>d.accept());await select('Erwartete Fibonacci-Zielzone · Eingabe','Einzellevel',oldTarget);assert.equal(await oldTarget.getByRole('combobox',{name:'Bis Level',exact:true}).count(),0);
 await dialog().getByLabel('Historischer Beginn',{exact:true}).fill('2009');await dialog().getByRole('button',{name:'Speichern',exact:true}).click();await dialog().waitFor({state:'hidden'});const changed=(await db.query('SELECT evidence FROM fibonacci_observation WHERE id=$1',[oldId])).rows[0].evidence;
 assert.deepEqual(changed.historicalTime.start,{date:'2009',precision:'year'});assert.deepEqual(changed.targetZone,[38.2,38.2]);assert.equal(changed.historicalTime.source,historical.source);
 assert.deepEqual(errors,[]);
 const result={checkedAt:new Date().toISOString(),syntheticOnly:true,isolatedEdge:true,viewports:summary,defaults:true,seriesSaveAndDatabaseReadback:true,contextOnlyCarry:true,distinctIds:true,unknownStructureNotConfirmed:true,explicitUncertainty:true,invalidDatesBlockSave:true,networkFailureRetainsDraft:true,sameIdRetryVersion:retry.version,hiddenValuesPreserved:true,draftSurvivesFocusAndInterval:true,legacyDateMetadataPreserved:true,explicitDateChangeClearsBoundaryMetadata:true,rangeConversionRequiresConfirmation:true,pageErrors:errors,measuredSelectionClicks:clicks,firstEntrySelectionClicks:firstSelectionClicks,baselineExtraSelectionClicks:8,seriesContextSelectionClicksSaved:6};
 await writeFile(join(out,'browser.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(error){await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});await writeFile(join(out,'failure-aria.txt'),await page.locator('body').ariaSnapshot().catch(()=>''));throw error;}
finally{await db.end();await browser.close();}
