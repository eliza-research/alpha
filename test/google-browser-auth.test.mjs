import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, cpSync, rmSync, readFileSync, readdirSync, existsSync} from 'node:fs';
import {join, resolve, relative} from 'node:path';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {preparePatchedNative} from '../scripts/prepare-patched-native.ts';
import {realNode} from '../scripts/run-node-only-tests.ts';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';

// Run the shared browser, callback and credential-ownership regressions against
// exactly the authenticated source that Gradle packages, without editing vendor.
test('packaged shared Google browser sign-in preserves lifecycle and credential ownership', {timeout: scaledTimeout(360000)}, () => {
  const root=resolve(import.meta.dirname, '..');
  const node=realNode();
  assert.ok(node, 'The shared native sign-in suite requires genuine Node.js 24+');
  const staged=preparePatchedNative({root});
  const temporary=mkdtempSync(join(tmpdir(), 'alpha-browser-auth-'));
  const module=join(temporary, 'packages/auth/android');
  try {
    cpSync(join(staged.root, 'packages/auth/android'), module, {recursive:true});
    // The overlay replaces upstream test files wholesale. Each fork records the upstream
    // file it came from, so a pin bump that changes one forces the fork to be rebased.
    const overlay=join(root, 'test/fixtures/google-browser-auth');
    const base=JSON.parse(readFileSync(join(overlay, 'upstream-base.json'), 'utf8'));
    const forks=readdirSync(overlay, {recursive:true, withFileTypes:true}).filter((entry) => entry.isFile())
      .map((entry) => relative(overlay, join(entry.parentPath, entry.name))).filter((name) => name!=='upstream-base.json');
    assert.deepEqual(forks.sort(), Object.keys(base.files).sort(), 'every overlay file records its upstream base');
    for (const [name, sha256] of Object.entries(base.files)) {
      const upstream=join(module, 'test', name);
      const actual=existsSync(upstream) ? createHash('sha256').update(readFileSync(upstream)).digest('hex') : null;
      assert.equal(actual, sha256, `upstream sign-in tests changed; rebase the Alpha fork (${name})`);
    }
    // The shared suite also checks that its existing first-party host retains
    // native mode. These are test inputs only, never Alpha application sources.
    cpSync(join(root, 'vendor/eliza/packages/app/platforms/android'), join(temporary, 'packages/app/platforms/android'), {recursive:true});
    cpSync(join(root, 'vendor/eliza/packages/app/scripts/mobile/android/templates'), join(temporary, 'packages/app/scripts/mobile/android/templates'), {recursive:true});
    cpSync(join(root, 'vendor/eliza/packages/ui/src/android-cloud'), join(temporary, 'packages/ui/src/android-cloud'), {recursive:true});
    // The current shared suite also executes the resident credential mutation conductor and its
    // exact stop lease. Keep those owning source regressions alongside Alpha's browser cases.
    for(const source of ['plugins/plugin-native-secure-store/android-nativeonly','plugins/plugin-native-agent/android'])
      cpSync(join(root,'vendor/eliza',source),join(temporary,source),{recursive:true});
    const env={...process.env};
    delete env.NODE_TEST_CONTEXT;
    // These upstream node:test/JVM fixtures execute with their genuine Node runtime.
    const runSuite=(label,minimumTests)=>{
      const run=spawnSync(node, ['--test', '--test-reporter=tap', join(module, 'test/native-sign-in.test.mjs')], {timeout:scaledTimeout(170000), env, encoding:'utf8'});
      const detail=`${label}:\n${run.stdout}\n${run.stderr}`;
      assert.equal(run.error, undefined, `${run.error?.message ?? ''}\n${detail}`);
      assert.equal(run.status, 0, detail);
      const count=(name)=>Number(new RegExp(`^# ${name} (\\d+)$`, 'm').exec(run.stdout)?.[1] ?? NaN);
      assert.ok(count('tests') >= minimumTests, `${label} suite actually ran:\n${detail}`);
      assert.equal(count('pass'), count('tests'), detail);
      for(const outcome of ['fail','cancelled','skipped','todo']) assert.equal(count(outcome), 0, detail);
    };
    // Keep the pin's own recovery coverage, including retry/receipt failures,
    // before exercising Alpha's additional browser and credential-owner cases.
    runSuite('pinned upstream',16);
    cpSync(overlay, join(module, 'test'), {recursive:true, filter:(source) => source!==join(overlay, 'upstream-base.json')});
    runSuite('Alpha browser',17);
  } finally { rmSync(temporary, {recursive:true, force:true}); }
});
