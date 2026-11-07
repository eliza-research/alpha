import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transformSync} from 'esbuild';

// The full native coordinator runs on a JVM with controlled Android, storage and HTTP ports.
// Each scenario gets its own process because Java's URL factory is process-global.
test('native sign-in checks successful replacement, burn failures, owned cancellation and recovery against Quint', {timeout: 240000}, () => {
  const result = spawnSync(process.execPath, ['--import=tsx', '--input-type=module', '-e', `
    import {runSignInCoordinatorRefinement} from './specs/quint/refinement/services/sign-in-coordinator.mjs';
    const result = await runSignInCoordinatorRefinement();
    if (!result.passed || result.traces !== 11) throw Error('Incomplete coordinator refinement');
    console.log(JSON.stringify({traces: result.traces, checkpoints: result.checkpoints}));
  `], {cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 230000, maxBuffer: 8 * 1024 * 1024});
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /"traces":11/);
});

function incompleteNoticeFixture() {
  const source = readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  signInIncomplete(value: unknown) {');
  const end = source.indexOf('\n  /**', start);
  assert.ok(start >= 0 && end > start, 'The actual renderer notice handler is located');
  const code = transformSync(`const connectionController = {${source.slice(start, end)}}; globalThis.controller = connectionController;`, {loader: 'ts'}).code;
  let settle;
  const state = {open: false, signIn: {step: 'google', environment: 'production'}, message: '', error: ''};
  const context = vm.createContext({
    state,
    operation: {},
    operationSettled: new Promise(resolve => { settle = resolve; }),
    update: next => Object.assign(state, next),
    signInFailureMessage: code => code,
  });
  vm.runInContext(code, context);
  return {state, context, settle};
}

test('retained cancellation storage failure is shown after the current renderer operation settles', async () => {
  const fixture = incompleteNoticeFixture();
  fixture.context.controller.signInIncomplete({code: 'storage'});
  assert.equal(fixture.state.open, false);
  fixture.context.operation = null;
  fixture.settle();
  await Promise.resolve();
  assert.equal(fixture.state.open, true);
  assert.equal(fixture.state.error, 'storage');
  assert.equal(fixture.state.signIn.step, 'choose');
  assert.equal(fixture.state.signIn.environment, 'production');
});

test('cold storage failure opens recovery while unrelated retained codes remain ignored', () => {
  const fixture = incompleteNoticeFixture();
  fixture.context.operation = null;
  fixture.context.controller.signInIncomplete({code: 'unrecognized'});
  assert.equal(fixture.state.open, false);
  fixture.context.controller.signInIncomplete({code: 'storage'});
  assert.equal(fixture.state.open, true);
  assert.equal(fixture.state.error, 'storage');
});
