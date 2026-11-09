import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkLauncherObserver} from '../specs/quint/refinement/application/launcher-observer.mjs';

test('shared launcher observers retire timers and native subscriptions once', {timeout: 120000}, async () => {
  const receipt = await checkLauncherObserver([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 12);
  assert.equal(receipt.checkpoints, 78);
});
