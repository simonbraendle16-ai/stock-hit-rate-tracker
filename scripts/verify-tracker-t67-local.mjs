import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import pg from 'pg';
// Fixed loopback only. No environment-file loader and no production connection.
const client=new pg.Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:5557/postgres'});
const base='http://localhost:3027/api/assistant/v1/fibonacci';
const owner='fibonacci-local-qa', tokenId=randomUUID(), token='sat_'+randomBytes(32).toString('base64url');
const checks=[];
const check=(name,value)=>{assert.ok(value,name);checks.push(name);};
try {
  await client.connect();
  assert.equal((await client.query('SELECT email FROM "user" WHERE id=$1',[owner])).rows[0]?.email,'fibonacci-qa@example.invalid');
  const fingerprint=async()=>createHash('sha256').update(JSON.stringify((await client.query('SELECT * FROM fibonacci_observation ORDER BY id')).rows)).digest('hex');
  const before=await fingerprint();
  await client.query('INSERT INTO assistant_api_token(id,"userId",name,"tokenHash",scopes) VALUES($1,$2,$3,$4,$5::jsonb)',[tokenId,owner,'Synthetic T6/T7 QA',createHash('sha256').update(token).digest('hex'),JSON.stringify(['trades:read'])]);
  const fetchQA=q=>fetch(base+'?'+q,{headers:{Authorization:'Bearer '+token}});
  const get=async q=>{const response=await fetchQA(q);assert.equal(response.status,200);return response.json();};
  const q='measurementKind=retracement&levelFrom=61.8&levelMeaning=end&wave=4&waveLabelScope=self&limit=20';
  const first=await get(q), second=await get(q+'&offset=20'), last=await get(q+'&offset=40'), sorted=await get(q+'&order=oldest');
  check('47 full-population end-level matches across three pages',first.total===47&&second.total===47&&last.total===47);
  check('20 / 20 / 7 page sizes',first.items.length===20&&second.items.length===20&&last.items.length===7);
  assert.deepEqual(first.stats,second.stats);assert.deepEqual(first.stats,sorted.stats);checks.push('Statistics independent of page and sorting');
  assert.deepEqual(first.levelSelection,second.levelSelection);checks.push('Full traceable level-group IDs independent of page');
  check('No duplicate or missing observation across pages',new Set([...first.items,...second.items,...last.items].map(r=>r.id)).size===47);
  const exported=await fetchQA(q+'&offset=20&format=csv');assert.equal(exported.status,200);const csv=await exported.text();
  check('CSV includes every selected ID, sources, time precision and version',first.levelSelection.ids.every(id=>csv.includes(id))&&csv.includes('historicalTime')&&csv.includes('Version')&&csv.includes('provenance'));
  const draft='query='+encodeURIComponent('Tesla Welle 4 2020–2025 ABC 61,8');
  const pending=await get(draft);
  check('Unresolved query has no final statistics',pending.ready===false&&pending.stats===null&&pending.total===null&&pending.interpretation.pending.length===3);
  const resolved=await get(draft+'&resolutions='+encodeURIComponent(JSON.stringify({'instrument:0':'1',waveLabelScope:'self',levelMeaning:'end'})));
  check('Resolved structured search equals manual filter population',resolved.ready&&resolved.total===47&&resolved.levelSelection.ids.join()===first.levelSelection.ids.join());
  const blocked=await fetchQA(draft+'&format=csv');check('Unresolved export blocked',blocked.status===422);
  const descendant=await get(q.replace('waveLabelScope=self','waveLabelScope=descendants'));
  check('Explicit descendant scope retains independent child',descendant.total===48);
  check('Duration averages separated by wave degree and timeframe',first.stats.coverage.residenceComparisons.groups.length===2&&first.stats.coverage.residenceComparisons.groups.every(g=>Math.abs(g.average-8)<1e-12));
  check('Reported wave and residence duration types remain independent',new Set(first.stats.categorical.durations.groups.map(g=>g.type)).size===2); // QA seed reports wave and residence only.
  for(const invalid of ['levelFrom=61.8','offset=-1','wave=4&wave=5','order=invalid']) check('Invalid request rejected: '+invalid,(await fetchQA(invalid)).status===400);
  check('Observation fingerprint unchanged',before===await fingerprint());
  const report={at:new Date().toISOString(),environment:'local synthetic loopback only',observations:50,matches:47,checks,passed:checks.length,observationFingerprint:before};
  writeFileSync(new URL('../docs/tracker-t67-http-2026-10-19.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:checks.length,observations:50,matches:47,unchanged:true}));
} finally {
  try {await client.query('DELETE FROM assistant_api_token WHERE id=$1',[tokenId]);} finally {await client.end();}
}
