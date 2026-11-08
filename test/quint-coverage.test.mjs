import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkCoverage, detectedCounterexample, loadModels, readJson, repositoryRoot, runtimeScriptPaths, runtimeAssetPaths, sha256, sourceRoots } from '../scripts/quint-lib.mjs';

test('counterexample admission requires the pinned CLI violation markers and rejects tool errors', () => {
  assert.equal(detectedCounterexample('[violation] Found an issue (42ms).\nerror: found a counterexample\n'), true);
  assert.equal(detectedCounterexample('\u001b[31m[violation]\u001b[0m Found an issue (42ms).\nerror: Invariant violated\n'), true);
  assert.equal(detectedCounterexample("error: [QNT404] Name 'InvariantViolated' not found\nerror: Argument error\n"), false);
  assert.equal(detectedCounterexample('Invariant safety violated\n'), false);
  assert.equal(detectedCounterexample('[violation] Found an issue (42ms).\nerror: found a counterexample\nerror: [QNT404] missing\n'), false);
  assert.equal(detectedCounterexample('[failure] TLC encountered an error\nerror: found a counterexample\n'), false);
});

test('runner records unexpected exceptions as failures and labels coverage evidence accurately', () => {
  const root = mkdtempSync(join(tmpdir(), 'alpha-quint-runner-'));
  const write = (path, contents) => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  };
  try {
    for (const path of [...sourceRoots, 'scripts']) mkdirSync(join(root, path), { recursive: true });
    for (const name of ['check-quint.mjs', 'quint-lib.mjs']) copyFileSync(join(repositoryRoot, 'scripts', name), join(root, 'scripts', name));
    const fixtureSources = [...runtimeScriptPaths, ...runtimeAssetPaths];
    for (const path of fixtureSources) write(path, '');
    const model = { module: 'Fixture', path: 'specs/quint/application/Fixture.qnt', init: 'init', step: 'step', invariant: 'safety', tests: ['exampleTest'], currentChecks: [null] };
    write(model.path, 'module Fixture { run exampleTest = true }');
    for (const family of ['application', 'services', 'native', 'legacy']) {
      write(`specs/quint/${family}/manifest.json`, JSON.stringify(family === 'application' ? [model] : []));
    }
    write('specs/quint/coverage.json', JSON.stringify({
      upstream: { commit: 'fixture' },
      files: fixtureSources.map(path => ({ path, sha256: sha256(''), models: ['Fixture'], treatment: 'test fixture', scope: 'test support' })),
    }));
    write('upstream.lock.json', JSON.stringify({ commit: 'fixture' }));
    write('package-lock.json', '{}');
    write('specs/quint/tlc.json', '{}');
    write('node_modules/@informalsystems/quint/package.json', JSON.stringify({ version: '0.33.1' }));

    const compare = spawnSync(process.execPath, ['scripts/check-quint.mjs', 'compare', '--out=compare.json'], { cwd: root, encoding: 'utf8', timeout: 10000 });
    assert.equal(compare.status, 1, compare.stderr);
    const failure = readJson(join(root, 'compare.json'));
    assert.equal(failure.passed, false);
    assert.equal(failure.status, 'failed');
    assert.match(failure.error, /TypeError/);
    assert.deepEqual(failure.finalCoverageErrors, []);

    const coverage = spawnSync(process.execPath, ['scripts/check-quint.mjs', 'coverage', '--out=coverage.json'], { cwd: root, encoding: 'utf8', timeout: 10000 });
    assert.equal(coverage.status, 0, coverage.stderr);
    const success = readJson(join(root, 'coverage.json'));
    assert.equal(success.passed, true);
    assert.equal(success.status, 'passed');
    assert.equal(success.evidence, 'source coverage admission');

    write('node_modules/@informalsystems/quint/dist/src/cli.js', 'setTimeout(() => {}, 60000);');
    const interrupted = spawnSync(process.execPath, ['scripts/check-quint.mjs', 'typecheck', '--out=interrupted.json'], { cwd: root, encoding: 'utf8', timeout: 2000 });
    assert.equal(interrupted.error?.code, 'ETIMEDOUT');
    const unfinished = readJson(join(root, 'interrupted.json'));
    assert.equal(unfinished.passed, false);
    assert.equal(unfinished.status, 'running');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('every authored application source and every Quint module has a current coverage allocation', () => {
  const models = loadModels();
  const inventory = readJson(join(repositoryRoot, 'specs/quint/coverage.json'));
  assert.deepEqual(checkCoverage(models, inventory), []);
  assert.ok(models.length >= 34);
  for (const model of models) {
    const source = readFileSync(join(repositoryRoot, model.path), 'utf8');
    assert.match(source, /\baction\s+step\b/);
    assert.ok(model.tests.length >= 2, `${model.module} must exercise multiple scenarios`);
  }
});

test('coverage admission detects changed, removed and unassigned source records', () => {
  const models = loadModels();
  const inventory = readJson(join(repositoryRoot, 'specs/quint/coverage.json'));
  inventory.files[0].sha256 = '0'.repeat(64);
  assert.ok(checkCoverage(models, inventory).some(message => message.startsWith('Changed source')));
  inventory.files[0].models = ['MissingModel'];
  assert.ok(checkCoverage(models, inventory).some(message => message.startsWith('Unknown model')));
  inventory.files.pop();
  assert.ok(checkCoverage(models, inventory).some(message => message.startsWith('New source')));
});

test('source discovery follows consumed shared modules and rejects a stale client projection', () => {
  const root = mkdtempSync(join(tmpdir(), 'alpha-quint-shared-scope-'));
  const write = (path, contents) => {
    const file = join(root, path);
    mkdirSync(dirname(file), {recursive: true});
    writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
  };
  try {
    for (const path of sourceRoots) mkdirSync(join(root, path), {recursive: true});
    mkdirSync(join(root, 'scripts'), {recursive: true});
    copyFileSync(join(repositoryRoot, 'scripts/quint-lib.mjs'), join(root, 'scripts/quint-lib.mjs'));
    write('upstream.lock.json', {commit: 'fixture', appSource: 'packages/app'});
    write('.eliza/client-features/.source.json', {baseCommit: 'fixture', sourceFiles: {'packages/ui/src/state.ts': 'fixture'}});
    write('android/consumer-host.json', {profile: {modules: [{source: {root: 'upstream', path: 'plugins/fixture/android'}}]}, residentHost: {helpers: ['packages/runtime/Owner.java']}});
    write('patches/eliza/native-manifest.json', {modules: [], patches: []});
    for (const family of ['application', 'services', 'native', 'legacy']) {
      write(`specs/quint/${family}/manifest.json`, family === 'services'
        ? [{sources: ['vendor/eliza/plugins/worker/src/state.ts']}] : []);
    }
    const bundledSource = 'export let bundled = false;';
    const generatedOrigin = 'export let generatedOrigin = false;';
    write('vendor/eliza/packages/core/src/bundled.ts', bundledSource);
    write('vendor/eliza/packages/core/src/generated.ts', generatedOrigin);
    const graph = {
      schema: 1, classification: 'observed-product-android-bundle-inputs', sourcePin: 'fixture',
      producer: {sourceTreeVerifiedBeforeAndAfter: true, inputHashesUnchanged: true},
      files: {
        'packages/core/src/bundled.ts': {tracked: true, sha256: sha256(bundledSource)},
        'packages/core/dist/generated.js': {tracked: false, generatedSource: {
          source: 'packages/core/src/generated.ts', sourceSha256: sha256(generatedOrigin),
        }},
      },
    };
    write('specs/quint/refinement/services/runtime-bundle-inputs.json', graph);
    write('vendor/eliza/plugins/worker/src/state.ts', 'export let queued = false;');
    write('vendor/eliza/packages/ui/src/state.ts', 'export let active = false;');
    write('vendor/eliza/plugins/fixture/android/src/main/java/Fixture.java', 'class Fixture {}');
    write('vendor/eliza/packages/runtime/Owner.java', 'class Owner {}');
    mkdirSync(join(root, 'vendor/eliza/packages/app/platforms/android/sense/src/main'), {recursive: true});
    mkdirSync(join(root, 'vendor/eliza/packages/os/android/sense/systemui/chip/source'), {recursive: true});
    const run = () => spawnSync(process.execPath, ['--input-type=module', '-e', "import {sharedSourcePaths} from './scripts/quint-lib.mjs'; console.log(JSON.stringify(sharedSourcePaths()));"], {cwd: root, encoding: 'utf8'});
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [
      'vendor/eliza/packages/core/src/bundled.ts',
      'vendor/eliza/packages/core/src/generated.ts',
      'vendor/eliza/packages/runtime/Owner.java',
      'vendor/eliza/packages/ui/src/state.ts',
      'vendor/eliza/plugins/fixture/android/src/main/java/Fixture.java',
      'vendor/eliza/plugins/worker/src/state.ts',
    ]);
    write('vendor/eliza/plugins/fixture/android/src/main/java/Added.java', 'class Added {}');
    assert.ok(JSON.parse(run().stdout).includes('vendor/eliza/plugins/fixture/android/src/main/java/Added.java'));
    write('specs/quint/refinement/services/runtime-bundle-inputs.json', {...graph, sourcePin: 'obsolete'});
    assert.match(run().stderr, /Refresh the authenticated runtime bundle inventory/);
    write('specs/quint/refinement/services/runtime-bundle-inputs.json', graph);
    write('vendor/eliza/packages/core/src/bundled.ts', 'export let bundled = true;');
    assert.match(run().stderr, /Runtime bundle input changed/);
    write('vendor/eliza/packages/core/src/bundled.ts', bundledSource);
    write('.eliza/client-features/.source.json', {baseCommit: 'obsolete', sourceFiles: {}});
    const stale = run();
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /Prepare client sources for the current upstream pin/);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
