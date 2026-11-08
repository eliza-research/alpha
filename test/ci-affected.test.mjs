import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, readdirSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';

// Exercise the actual Actions entry point, complete Git history and output files.
test('CI selection follows changed files, renames, missing history and manual dispatch', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'alpha-ci-selection-'));
  t.after(() => rmSync(cwd, {recursive:true, force:true}));
  const git = (...args) => execFileSync('git', args, {cwd, encoding:'utf8'}).trim();
  git('init', '-q'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'CI fixture');
  const put = (name, text='fixture\n') => {
    mkdirSync(join(cwd, name, '..'), {recursive:true}); writeFileSync(join(cwd, name), text);
  };
  put('apps/app/source.ts'); put('test/browser/notes.spec.ts'); put('test/browser/production-surface.spec.ts');
  git('add', '.'); git('commit', '-qm', 'base');
  let base = git('rev-parse', 'HEAD');
  const select = (event, eventName='pull_request', sha=git('rev-parse','HEAD')) => {
    const eventPath=join(cwd,'event.json'), output=join(cwd,'output'), summary=join(cwd,'summary');
    writeFileSync(eventPath, JSON.stringify(event)); writeFileSync(output,''); writeFileSync(summary,'');
    execFileSync(process.execPath, [resolve('scripts/ci/affected.mjs')], {cwd, encoding:'utf8', env:{...process.env,
      GITHUB_EVENT_PATH:eventPath, GITHUB_EVENT_NAME:eventName, GITHUB_SHA:sha, GITHUB_OUTPUT:output, GITHUB_STEP_SUMMARY:summary}});
    assert.match(readFileSync(summary,'utf8'), /Change selection/);
    return Object.fromEntries(readFileSync(output,'utf8').trim().split('\n').map(line=>{
      const i=line.indexOf('='); return [line.slice(0,i),JSON.parse(line.slice(i+1))];
    }));
  };
  const commit = name => {git('add', ...(name==='.'?['-u']:[name]));git('commit','-qm','change '+name);};
  const pr = () => ({pull_request:{base:{sha:base},head:{sha:git('rev-parse','HEAD')}}});
  const lanes = result => [result.verify,result.browser,result.android,result.prepare];
  put('design/reference.html');commit('design'); assert.deepEqual(lanes(select(pr())),[false,false,false,false]);
  base=git('rev-parse','HEAD');put('docs/market-research/notes.md');commit('docs'); assert.deepEqual(lanes(select(pr())),[false,false,false,false]);
  // Docs that node tests read select repository verification only.
  base=git('rev-parse','HEAD');put('docs/reference.md');commit('docs'); assert.deepEqual(lanes(select(pr())),[true,false,false,false]);
  base=git('rev-parse','HEAD');put('test/browser/notes.spec.ts','changed\n');commit('test');
  let result=select(pr());assert.deepEqual(lanes(result),[true,true,false,false]);
  assert.deepEqual(result.browser_specs,['test/browser/notes.spec.ts']);assert.deepEqual(result.browser_shards,[1]);
  assert.equal(result.browser_production,false);assert.equal(result.browser_speech,false);
  base=git('rev-parse','HEAD');put('test/browser/production-surface.spec.ts','changed\n');commit('test');
  result=select(pr());assert.equal(result.browser_development,false);assert.equal(result.browser_production,true);
  // The local-agent profile step owns host reminder recovery (it skips without VITE_LOCAL_AGENT) as well as the speech specs.
  base=git('rev-parse','HEAD');put('test/browser/host-reminder-recovery.spec.ts','changed\n');commit('test');
  result=select(pr());assert.deepEqual(result.browser_specs,['test/browser/host-reminder-recovery.spec.ts']);assert.equal(result.browser_speech,true);
  base=git('rev-parse','HEAD');git('mv','apps/app/source.ts','docs/reference.ts');commit('.');
  result=select(pr());assert.deepEqual(lanes(result),[true,true,true,false]);assert.deepEqual(result.browser_specs,[]);
  base=git('rev-parse','HEAD');git('rm','test/browser/notes.spec.ts');commit('.');
  result=select(pr());assert.deepEqual(result.browser_shards,[1,2,3,4,5,6]);assert.equal(result.browser_production,true);
  base=git('rev-parse','HEAD');put('unknown-build-input');commit('unknown-build-input');
  assert.deepEqual(lanes(select({before:base},'push')),[true,true,true,true]);
  assert.deepEqual(lanes(select({before:'0'.repeat(40)},'push')),[true,true,true,true]);
  assert.deepEqual(lanes(select({},'workflow_dispatch')),[true,true,true,true]);
});

test('docs read by node tests select verify; design and research notes select nothing', async () => {
  const {affected, testReadReference} = await import('../scripts/ci/affected.mjs');
  const lanes = paths => {const r=affected(paths);return [r.verify,r.browser,r.android,r.prepare];};
  for (const path of ['docs/dependency-audit.dispositions.json','docs/dependency-audit.snapshot.json','docs/ci-cost-policy.md',
    'docs/requirements.json','docs/mvp-remaining-work-2026-10-09.json','docs/mvp-remaining-work-2026-10-09.md','docs/core-loop-audit.md','README.md']) {
    assert.equal(testReadReference(path), true, path);
    assert.deepEqual(lanes([path]), [true,false,false,false], path);
  }
  assert.deepEqual(lanes(['design/prototype.html','design/assets/icon.svg']), [false,false,false,false]);
  assert.deepEqual(lanes(['.github/workflows/dependency-audit.yml']), [true,false,false,false], 'the scheduled audit workflow selects verify only');
  assert.deepEqual(lanes(['specs/quint/application/Application.qnt','specs/quint/coverage.json','scripts/check-quint.mjs']), [true,false,false,false], 'formal specifications run repository verification');
  assert.deepEqual(lanes(['docs/market-research/proposal.md','AGENTS.md','LICENSE']), [false,false,false,false]);
  // Every docs file a node test names must select verify.
  const named = new Set();
  for (const file of readdirSync('test').filter(name => name.endsWith('.test.mjs')))
    for (const [path] of readFileSync(join('test', file), 'utf8').matchAll(/docs\/[A-Za-z0-9_.\/-]+\.(?:json|md)/g)) if (existsSync(path)) named.add(path);
  assert.ok(named.size >= 5);
  for (const path of named) assert.equal(testReadReference(path), true, path);
});
