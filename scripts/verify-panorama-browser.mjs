// Loopback-only S4 fallback after CUA deadline/attachment failures. Synthetic DB only.
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import pg from 'pg';
const requireTool=createRequire(join(process.env.APPDATA,'npm/node_modules/browser-use/package.json'));
const {chromium}=requireTool('playwright');
const base='http://localhost:3044',out=resolve('docs/design/s4');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.setDefaultTimeout(15000);
const db=new pg.Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:5564/postgres'});
const errors=[],checks=[];
let renamed=false;
page.on('pageerror',e=>errors.push(e.message));
const goto=async query=>{await page.goto(base+'/analysis'+query);await page.locator('[data-research-panorama]').waitFor();};
try {
  await db.connect();
  assert.equal((await db.query('SELECT email FROM "user" WHERE id=$1',['fibonacci-local-qa'])).rows[0]?.email,'fibonacci-qa@example.invalid');
  const before=JSON.stringify((await db.query('SELECT id,version,evidence FROM fibonacci_observation ORDER BY id')).rows);
  const auth=await page.context().request.post(base+'/api/auth/sign-in/email',{headers:{Origin:base},data:{email:'fibonacci-qa@example.invalid',password:'Local-Fibonacci-QA-2026!'}});
  assert.equal(auth.status(),200);
  await goto('?fib.allKinds=1');
  const panorama=page.locator('[data-research-panorama]');
  assert.match(await panorama.innerText(),/40 Beobachtungen · 37 abgeschlossen/);
  assert.match(await panorama.innerText(),/8 Beobachtungen · 8 abgeschlossen/);
  const retracement=page.getByRole('region',{name:'Retracement-Statistik',exact:true});
  assert.match(await retracement.innerText(),/24\/36 · 66,7 %/);
  assert.match(await retracement.innerText(),/0\/36 · 0 %/);
  assert.ok(!(await panorama.innerText()).includes('74000000'));
  assert.equal(await page.locator('details.research-basis').getAttribute('open'),null);
  checks.push('Both measurement kinds split; known expected counts, ratios, zero and no visible case IDs');
  for(const width of [1440,1024,390]) {
    await page.setViewportSize({width,height:width===390?844:1000});
    await retracement.getByRole('heading',{name:'Retracement',exact:true}).scrollIntoViewIfNeeded();
    const size=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
    assert.ok(size.scroll<=size.client+1,JSON.stringify({width,...size}));
    await page.screenshot({path:join(out,`panorama-${width}.png`)});
    checks.push(`Readable responsive layout without global overflow at ${width}px`);
  }
  await page.setViewportSize({width:1440,height:1000});
  await goto('?fib.allKinds=1&fib.subdivision=three_part&fib.subdivisionConfidence=bestaetigt');
  assert.match(await retracement.innerText(),/19 Beobachtungen · 18 abgeschlossen/);
  assert.match(await retracement.innerText(),/18\/18 · 100 %/);
  checks.push('Confirmed subdivision filter retains independent pattern and valid denominator');
  await page.goto(base+'/analysis?fib.stockId=2');
  await page.getByRole('status').getByText('Keine passenden Beobachtungen',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-research-panorama] figure').count(),0);
  await page.screenshot({path:join(out,'empty.png')});
  checks.push('Valid empty selection is distinct from zero percentage');
  await page.goto(base+'/analysis?fib.levelFrom=61.8');
  await page.getByText('Statistik derzeit nicht verfügbar',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-research-panorama] figure').count(),0);
  await page.screenshot({path:join(out,'invalid-selection.png')});
  checks.push('Incomplete level meaning blocks all final panorama figures');
  await db.query('ALTER TABLE fibonacci_observation RENAME TO s4_qa_temporarily_unavailable');renamed=true;
  await page.goto(base+'/analysis');
  await page.getByRole('button',{name:'Erneut laden',exact:true}).waitFor();
  assert.equal(await page.locator('[data-research-panorama]').count(),0);
  await page.screenshot({path:join(out,'load-error.png')});
  await db.query('ALTER TABLE s4_qa_temporarily_unavailable RENAME TO fibonacci_observation');renamed=false;
  // A server-data error is expected in this deliberate local failure case.
  errors.length=0;
  await page.getByRole('button',{name:'Erneut laden',exact:true}).click();
  await page.locator('[data-research-panorama]').waitFor();
  checks.push('Actual server data failure shows error and retry recovers without empty-success state');
  const after=JSON.stringify((await db.query('SELECT id,version,evidence FROM fibonacci_observation ORDER BY id')).rows);
  assert.equal(before,after);assert.deepEqual(errors,[]);
  checks.push('All synthetic observations and versions unchanged; no unexpected page errors after recovery');
  await writeFile(join(out,'browser.json'),JSON.stringify({checkedAt:new Date().toISOString(),syntheticOnly:true,fallbackReason:'CUA CDP dispatch deadline, lost attachment and new-tab timeout',passed:checks.length,checks},null,2)+'\n');
  console.log(JSON.stringify({passed:checks.length,checks}));
} finally {
  if(renamed)await db.query('ALTER TABLE s4_qa_temporarily_unavailable RENAME TO fibonacci_observation');
  await db.end();await browser.close();
}
