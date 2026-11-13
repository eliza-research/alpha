import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {repositoryRoot} from '../scripts/quint-lib.ts';
import {realNode} from '../scripts/run-node-only-tests.ts';

test('function checker distinguishes proofs, skips, failed verification and regenerated source drift', () => {
  const node = realNode();
  assert.ok(node, 'LemmaScript fixtures require genuine Node.js 24+');
  const root = mkdtempSync(join(tmpdir(), 'alpha-lemma-checker-'));
  const write = (path, text, mode) => {mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), text, {mode});};
  try {
    for (const file of ['scripts/check-lemma.ts', 'scripts/quint-lib.ts', 'scripts/sha256.ts', 'scripts/upstream-pin.ts', 'scripts/run-node-only-tests.ts', 'specs/quint/refinement/timeouts.mjs']) {
      mkdirSync(dirname(join(root, file)), {recursive: true});
      copyFileSync(join(repositoryRoot, file), join(root, file));
    }
    write('bun.lock', '{}'); write('lemmascript.json', '{"proof-dir":"specs/lemma"}');
    write('LemmaScript-files.txt', 'apps/app/src/policy.ts 30\n');
    write('apps/app/src/policy.ts', '//@ verify\nexport function policy() { return true; }\n');
    write('specs/lemma/apps/app/src/policy.dfy.gen', 'fixture generation\n'); write('specs/lemma/apps/app/src/policy.dfy', 'fixture proof\n');
    write('node_modules/lemmascript/package.json', '{"version":"0.6.6","type":"module"}');
    write('node_modules/lemmascript/tools/dist/lsc.js', `import fs from 'node:fs';
if(process.versions.bun)throw Error('LemmaScript must run on genuine Node.js');
if(process.argv.includes('extract')){console.log(JSON.stringify({functions:[{name:'policy'}]}));process.exit(0);}
if(process.env.LEMMA_FIXTURE_DRIFT==='1')fs.appendFileSync('specs/lemma/apps/app/src/policy.dfy.gen','changed');
if(process.argv.includes('check')){
 if(process.env.LEMMA_FIXTURE_HELPER_DRIFT)fs.appendFileSync(process.env.LEMMA_FIXTURE_HELPER_DRIFT,'\\n// controlled helper drift\\n');
 if(process.env.LEMMA_FIXTURE_FAIL==='1')process.exit(1);
 console.log('Dafny program verifier finished with '+(process.env.LEMMA_FIXTURE_EMPTY==='1'?'0':'1')+' verified, 0 errors');
}`);
    write('bin/dafny', '#!/bin/sh\nprintf "%s\\n" "${LEMMA_FIXTURE_VERSION:-4.11.0}"\n', 0o755);
    const run = env => {
      const result = spawnSync(process.execPath, ['scripts/check-lemma.ts'], {cwd: root,
        env: {...process.env, PATH: join(root, 'bin'), ALPHA_NODE: node, LEMMA_REQUIRE_BACKEND: '0', ...env}, encoding: 'utf8'});
      return {result, receipt: JSON.parse(readFileSync(join(root, 'test-results/lemma/check.json'), 'utf8'))};
    };
    let check = run({}); assert.equal(check.result.status, 0, check.result.stderr); assert.equal(check.receipt.passed, true); assert.equal(check.receipt.verifiedConditions, 1);
    check = run({LEMMA_FIXTURE_VERSION: '4.11.0+'+'f'.repeat(40)}); assert.equal(check.result.status, 0); assert.equal(check.receipt.passed, true);
    check = run({LEMMA_FIXTURE_VERSION: '4.11.0-rc1'}); assert.equal(check.receipt.passed, false);
    check = run({LEMMA_FIXTURE_VERSION: '4.11.0+unreviewed'}); assert.equal(check.receipt.passed, false);
    check = run({LEMMA_FIXTURE_VERSION: '4.10.0'}); assert.equal(check.result.status, 0); assert.equal(check.receipt.passed, false); assert.equal(check.receipt.status, 'skipped-no-qualified-backend');
    check = run({LEMMA_FIXTURE_VERSION: '4.10.0', LEMMA_REQUIRE_BACKEND: '1'}); assert.equal(check.result.status, 2); assert.equal(check.receipt.passed, false);
    check = run({LEMMA_FIXTURE_FAIL: '1'}); assert.equal(check.result.status, 1); assert.equal(check.receipt.status, 'failed');
    check = run({LEMMA_FIXTURE_EMPTY: '1'}); assert.equal(check.result.status, 1); assert.equal(check.receipt.passed, false);
    for (const helper of ['scripts/quint-lib.ts', 'scripts/sha256.ts', 'scripts/upstream-pin.ts']) {
      const original = readFileSync(join(root, helper));
      check = run({LEMMA_FIXTURE_HELPER_DRIFT: helper});
      assert.equal(check.result.status, 1, helper);
      assert.equal(check.receipt.passed, false, helper);
      assert.deepEqual(check.receipt.changedInputs, [helper]);
      writeFileSync(join(root, helper), original);
    }
    check = run({LEMMA_FIXTURE_DRIFT: '1'}); assert.equal(check.result.status, 1); assert.equal(check.receipt.passed, false); assert.deepEqual(check.receipt.changedInputs, ['specs/lemma/apps/app/src/policy.dfy.gen']);
    write('apps/app/src/unlisted.ts', '//@ verify\nexport function unlisted() { return true; }\n');
    check = run({}); assert.equal(check.result.status, 1); assert.match(check.receipt.error, /Unregistered function annotations/);
    rmSync(join(root, 'apps/app/src/unlisted.ts'));
    write('apps/app/src/policy.ts', '//@ verify\n//@ ensures \\result\nexport function policy() { return true; }\n');
    check = run({}); assert.equal(check.result.status, 1); assert.match(check.receipt.error, /Unread or empty verified contract/);
    write('apps/app/src/policy.ts', '//@ verify\n//@ assume true\nexport function policy() { return true; }\n');
    check = run({}); assert.equal(check.result.status, 1); assert.match(check.receipt.error, /Unadmitted proof assumption/);
    write('apps/app/src/policy.ts', '//@ verify\nexport function policy() { return true; }\n');
    write('specs/lemma/apps/app/src/policy.dfy', 'lemma {:axiom} unproved() {}\n');
    check = run({}); assert.equal(check.result.status, 1); assert.match(check.receipt.error, /Unadmitted proof assumption/);
    write('specs/lemma/apps/app/src/policy.dfy', 'fixture proof\n');
    rmSync(join(root, 'specs/lemma/apps/app/src/policy.dfy.gen'));
    check = run({}); assert.equal(check.result.status, 1); assert.equal(check.receipt.passed, false); assert.equal(check.receipt.status, 'failed');
  } finally {rmSync(root, {recursive: true, force: true});}
});
