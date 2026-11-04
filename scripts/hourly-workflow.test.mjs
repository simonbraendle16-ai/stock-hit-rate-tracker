import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const yaml = readFileSync(new URL('../.github/workflows/active-trade-market-data.yml', import.meta.url), 'utf8');
const script = yaml.split('        run: |')[1].trimEnd().split('\n').slice(1).map(line => line.slice(10)).join('\n');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
for (const mode of ['empty', 'complete', 'claimed', 'partial', 'transport', 'remaining']) {
  test(`regular workflow shell: ${mode}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'hourly-workflow-'));
    try {
      writeFileSync(join(dir, 'jq.cjs'), `const fs=require('fs'); const a=process.argv.slice(2);const r=JSON.parse(fs.readFileSync('report.json'));if(a[0]!=='-e'){console.log(JSON.stringify(r));process.exit(0)}process.exit((a[1].includes('seriesDeferred')?r.seriesDeferred===0:r.ok===true)?0:1)`);
      writeFileSync(join(dir, 'curl.cjs'), `const fs=require('fs'); const phase=process.argv.at(-1).split('=').at(-1),mode=process.env.CASE;fs.appendFileSync('calls',phase+'\\n');if(mode==='transport'){process.stdout.write('000');process.exit(28)}const left=mode==='empty'?0:phase==='main'?2:phase==='limited-1'?1:mode==='remaining'?1:0;const ok=!(mode==='partial'&&phase==='main');const ran=!(mode==='claimed'&&phase==='main');fs.writeFileSync('report.json',JSON.stringify({ok,ran,seriesDeferred:left}));process.stdout.write(ok?'200':'503')`);
      writeFileSync(join(dir, 'run.sh'), `set -e\ncurl(){ node curl.cjs "$@"; }\njq(){ node jq.cjs "$@"; }\nsleep(){ [ "$1" = 65 ]; echo wait >> waits; }\n${script}\n`);
      const result = spawnSync(bash, ['run.sh'], { cwd: dir, env: { ...process.env, CASE: mode, APP_URL: 'https://synthetic.invalid', CRON_SECRET: 'synthetic-only' }, encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, ['empty', 'complete', 'claimed'].includes(mode) ? 0 : 1, result.stderr);
      const calls = readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n');
      assert.deepEqual(calls, ['empty', 'transport'].includes(mode) ? ['main'] : ['main', 'limited-1', 'limited-2']);
      if (calls.length === 3) assert.equal(readFileSync(join(dir, 'waits'), 'utf8').trim().split('\n').length, 2);
    } finally {
      assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/')));
      rmSync(dir, { recursive: true });
    }
  });
}
