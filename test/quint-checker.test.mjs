import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { detectedCounterexample, loadModels, missingQuintScenarios, quintModelOptions, quintProofBackend, readJson, repositoryRoot, runQuintChecker, runtimeScriptPaths, runtimeAssetPaths, sourceRoots, validateQuintModelMetadata } from '../scripts/quint-lib.ts';

test('all registered scenarios need an actual successful execution record', () => {
  assert.deepEqual(missingQuintScenarios(['reviewTest', 'setup'], '\u001b[32m    ok reviewTest passed 1 test(s)\u001b[0m\n    ok setup passed 3 test(s)\n'), []);
  assert.deepEqual(missingQuintScenarios(['reviewTest', 'setup'], '2 passing\n    ok reviewTest passed 1 test(s)\n'), ['setup']);
  assert.deepEqual(missingQuintScenarios(['reviewTest'], '    ok reviewTest passed 0 test(s)\n'), ['reviewTest']);
});

test('manifest budgets and extra proof initializers cannot silently disappear', () => {
  const model = {module: 'Fixture', path: 'Fixture.qnt', tests: ['exampleTest'],
    bounds: {maxSamples: 1000, maxSteps: 60, maxVerifyDepth: 8, seed: '123'},
    invariants: ['safety'], additionalProofInit: 'counterInit'};
  const source = 'module Fixture { var n: int action counterInit = n\' = 1 val safety = n >= 0 run exampleTest = counterInit }';
  validateQuintModelMetadata(model, source);
  assert.throws(() => validateQuintModelMetadata({...model, invariants: ['local']},
    'module Fixture { var n: int action counterInit = { val local = true n\' = 1 } run exampleTest = counterInit }'), /Missing top-level invariant/);
  assert.throws(() => validateQuintModelMetadata({...model, additionalProofInit: 'missing'}, source), /Missing additional proof init/);
  assert.throws(() => validateQuintModelMetadata({...model, bounds: {maxVerifyDepth: 0}}, source), /Invalid bounds/);
  assert.deepEqual(quintModelOptions(model, 'check'), {samples: 1000, steps: 60, seed: '123'});
  assert.deepEqual(quintModelOptions(model, 'verify'), {samples: 1000, steps: 8, seed: '123'});
  assert.deepEqual(quintModelOptions(model, 'check', {samples: 3, steps: 2, seed: '1'}), {samples: 3, steps: 2, seed: '1'});
});

test('verification backend honors explicit overrides and preserves other proof defaults', () => {
  assert.equal(quintProofBackend({}, 'verify'), 'apalache');
  assert.equal(quintProofBackend({verifyBackend: 'tlc'}, 'verify'), 'tlc');
  assert.equal(quintProofBackend({verifyBackend: 'tlc'}, 'verify', 'apalache'), 'apalache');
  for (const phase of ['compare', 'temporal']) {
    assert.equal(quintProofBackend({verifyBackend: 'apalache'}, phase), 'tlc');
    assert.equal(quintProofBackend({verifyBackend: 'tlc'}, phase, 'apalache'), 'apalache');
  }
  assert.throws(() => validateQuintModelMetadata({module: 'Fixture', tests: ['exampleTest'], verifyBackend: 'unknown'}, ''),
    /Invalid verifyBackend/);
});

test('the admitted model registry retains the audited families and scenarios', () => {
  const models = loadModels();
  const floors = {application: 116, services: 51, native: 65, legacy: 27};
  for (const [family, floor] of Object.entries(floors)) assert.ok(models.filter(model => model.family === family).length >= floor, `${family} lost registered models; review an intentional retirement explicitly`);
  assert.ok(models.reduce((count, model) => count + model.tests.length, 0) >= 1841, 'registered scenario count regressed');
});

test('counterexample admission requires the pinned CLI violation markers and rejects tool errors', () => {
  assert.equal(detectedCounterexample('[violation] Found an issue (42ms).\nerror: found a counterexample\n'), true);
  assert.equal(detectedCounterexample('\u001b[31m[violation]\u001b[0m Found an issue (42ms).\nerror: Invariant violated\n'), true);
  assert.equal(detectedCounterexample("error: [QNT404] Name 'InvariantViolated' not found\nerror: Argument error\n"), false);
  assert.equal(detectedCounterexample('Invariant safety violated\n'), false);
  assert.equal(detectedCounterexample('[violation] Found an issue (42ms).\nerror: found a counterexample\nerror: [QNT404] missing\n'), false);
  assert.equal(detectedCounterexample('[failure] TLC encountered an error\nerror: found a counterexample\n'), false);
});

test('only a silent native checker fault gets one retained retry', async () => {
  const silent = {status: null, signal: 'SIGSEGV', stdout: '', stderr: ''};
  const success = {status: 0, signal: null, stdout: '1 passing', stderr: ''};
  const interruptedAttempt = {exitCode: null, signal: 'SIGSEGV'};
  const cases = [
    {attempts: [silent, success], expected: {result: success, interruptedAttempt}},
    {attempts: [silent, silent], expected: {result: silent, interruptedAttempt}},
    ...[
      {...silent, signal: 'SIGTERM'},
      {...silent, error: Error('timeout')},
      {...silent, stderr: 'checker diagnostic'},
      {...silent, status: 1, signal: null, stdout: 'Assertion failed'},
      success,
    ].map(result => ({attempts: [result], expected: {result}})),
  ];
  for (const {attempts, expected} of cases) {
    let called = 0;
    assert.deepEqual(await runQuintChecker(() => attempts[called++]), expected);
    assert.equal(called, attempts.length);
  }
});

test('runner records backend routing, unexpected exceptions and unfinished results', () => {
  const root = mkdtempSync(join(tmpdir(), 'alpha-quint-runner-'));
  const write = (path, contents) => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  };
  try {
    for (const path of [...sourceRoots, 'scripts']) mkdirSync(join(root, path), { recursive: true });
    const runnerModules = ['check-quint.ts', 'quint-lib.ts', 'core-state-patch.ts', 'build-policy-source.ts'];
    for (const name of runnerModules) copyFileSync(join(repositoryRoot, 'scripts', name), join(root, 'scripts', name));
    const fixtureSources = [...runtimeScriptPaths, ...runtimeAssetPaths];
    for (const path of fixtureSources) if (!runnerModules.some(name => path === `scripts/${name}`)) write(path, '');
    const model = { module: 'Fixture', path: 'specs/quint/application/Fixture.qnt', init: 'init', step: 'step', invariant: 'safety', tests: ['exampleTest'], currentChecks: [null] };
    write(model.path, 'module Fixture { run exampleTest = true }');
    for (const family of ['application', 'services', 'native', 'legacy']) {
      write(`specs/quint/${family}/manifest.json`, JSON.stringify(family === 'application' ? [model] : []));
    }
    write('upstream.lock.json', JSON.stringify({ commit: 'fixture' }));
    write('package-lock.json', '{}');
    write('specs/quint/tlc.json', '{}');
    write('node_modules/@informalsystems/quint/package.json', JSON.stringify({ version: '0.33.1' }));

    const compare = spawnSync(process.execPath, ['scripts/check-quint.ts', 'compare', '--out=compare.json'], { cwd: root, encoding: 'utf8', timeout: 10000 });
    assert.equal(compare.status, 1, compare.stderr);
    const failure = readJson(join(root, 'compare.json'));
    assert.equal(failure.passed, false);
    assert.equal(failure.status, 'failed');
    assert.match(failure.error, /TypeError/);
    assert.deepEqual(failure.finalInputErrors, []);

    const routed = {...model, module: 'Routed', path: 'specs/quint/application/Routed.qnt', verifyBackend: 'tlc'};
    write(routed.path, 'module Routed { run exampleTest = true }');
    write('specs/quint/application/manifest.json', JSON.stringify([model, routed]));
    write('node_modules/@informalsystems/quint/dist/src/cli.js', 'console.log(process.argv.find(arg => arg.startsWith("--backend=")));');
    for (const override of [[], ['--backend=apalache']]) {
      const result = spawnSync(process.execPath, ['scripts/check-quint.ts', 'verify', '--out=verify.json', ...override],
        {cwd: root, encoding: 'utf8', timeout: 10000});
      assert.equal(result.status, 0, result.stderr);
      const proof = readJson(join(root, 'verify.json'));
      assert.equal(proof.passed, true);
      assert.equal(proof.backend, override.length ? 'apalache' : 'mixed');
      assert.deepEqual(proof.results.map(row => [row.model, row.backend, row.output.trim()]),
        [['Fixture', 'apalache', '--backend=apalache'], ['Routed', override.length ? 'apalache' : 'tlc', override[0] ?? '--backend=tlc']]);
    }

    write('node_modules/@informalsystems/quint/dist/src/cli.js', 'setTimeout(() => {}, 60000);');
    const interrupted = spawnSync(process.execPath, ['scripts/check-quint.ts', 'typecheck', '--out=interrupted.json'], { cwd: root, encoding: 'utf8', timeout: 2000 });
    assert.equal(interrupted.error?.code, 'ETIMEDOUT');
    const unfinished = readJson(join(root, 'interrupted.json'));
    assert.equal(unfinished.passed, false);
    assert.equal(unfinished.status, 'running');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
