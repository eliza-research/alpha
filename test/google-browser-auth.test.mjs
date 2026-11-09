import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, cpSync, rmSync, readFileSync, readdirSync, existsSync} from 'node:fs';
import {join, resolve, relative} from 'node:path';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {preparePatchedNative} from '../scripts/prepare-patched-native.mjs';

// Run the shared browser, callback and credential-ownership regressions against
// exactly the authenticated source that Gradle packages, without editing vendor.
test('packaged shared Google browser sign-in preserves lifecycle and credential ownership', {timeout: 180000}, () => {
  const root=resolve(import.meta.dirname, '..');
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
    cpSync(overlay, join(module, 'test'), {recursive:true, filter:(source) => source!==join(overlay, 'upstream-base.json')});
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
    const output=execFileSync(process.execPath, ['--test', '--test-reporter=tap', join(module, 'test/native-sign-in.test.mjs')], {timeout:170000, env, encoding:'utf8'});
    assert.ok(Number(/# tests (\d+)/.exec(output)?.[1]) >= 12, 'the shared suite actually ran');
    assert.match(output, /# fail 0\b/);
    assert.match(output, /# skipped 0\b/);
  } finally { rmSync(temporary, {recursive:true, force:true}); }
});
