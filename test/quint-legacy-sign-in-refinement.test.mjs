import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {tsImport} from './support/ts-import.mjs';

const {checkSignInRefinement} = await tsImport('../specs/quint/legacy/sign-in/check-sign-in-refinement.mjs', import.meta.url);

test('historical SignIn replays the mounted chooser and retains the old gate difference', {timeout: scaledTimeout(360000)}, async () => {
  const {receipts: [receipt], mismatch} = await checkSignInRefinement([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 3);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
  assert.equal(mismatch.id, 'SignInHistoricalBootGate');
  assert.ok(mismatch.driverInputsBound);
});
