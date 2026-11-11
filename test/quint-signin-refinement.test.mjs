import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('native sign-in preserves cancellation ownership and bounds email, SMS and MFA attempts', {timeout: 360000}, () => {
  const result = spawnSync(process.execPath, ['-e', `
    import {runSignInCoordinatorRefinement} from './specs/quint/refinement/services/sign-in-coordinator.mjs';
    const receipt = await runSignInCoordinatorRefinement(undefined, ['test/quint-signin-refinement.test.mjs']);
    if (!receipt.passed || !receipt.inputsUnchanged || !receipt.driverInputsBound || receipt.traces !== 21) throw Error('Incomplete sign-in refinement');
    console.log(JSON.stringify({traces: receipt.traces, checkpoints: receipt.checkpoints}));
  `], {cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 350000, maxBuffer: 16 * 1024 * 1024});
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /"traces":21/);
});
