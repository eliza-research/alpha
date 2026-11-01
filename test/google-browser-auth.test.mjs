import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, cpSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
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
    cpSync(join(root, 'test/fixtures/google-browser-auth'), join(module, 'test'), {recursive:true});
    // The shared suite also checks that its existing first-party host retains
    // native mode. These are test inputs only, never Alpha application sources.
    cpSync(join(root, 'vendor/eliza/packages/app/platforms/android'), join(temporary, 'packages/app/platforms/android'), {recursive:true});
    cpSync(join(root, 'vendor/eliza/packages/app/scripts/mobile/android/templates'), join(temporary, 'packages/app/scripts/mobile/android/templates'), {recursive:true});
    cpSync(join(root, 'vendor/eliza/packages/ui/src/android-cloud'), join(temporary, 'packages/ui/src/android-cloud'), {recursive:true});
    const env={...process.env};
    delete env.NODE_TEST_CONTEXT;
    const output=execFileSync(process.execPath, ['--test', '--test-reporter=tap', join(module, 'test/native-sign-in.test.mjs')], {timeout:170000, env, encoding:'utf8'});
    assert.ok(Number(/# tests (\d+)/.exec(output)?.[1]) >= 12, 'the shared suite actually ran');
    assert.match(output, /# fail 0\b/);
    assert.match(output, /# skipped 0\b/);
  } finally { rmSync(temporary, {recursive:true, force:true}); }
});
