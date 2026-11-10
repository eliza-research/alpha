import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { detectedCounterexample, readJson, repositoryRoot, runQuintChecker, runtimeScriptPaths, runtimeAssetPaths, sourceRoots } from '../scripts/quint-lib.ts';

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

test('runner records unexpected exceptions as failures and retains unfinished results', () => {
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
