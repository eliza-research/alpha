import assert from 'node:assert/strict';
import test from 'node:test';
import {runPilotApkUpdateRefinement} from '../specs/quint/refinement/services/pilot-update.mjs';

test('scripted pilot update observations refine the bounded update and journal model', async () => {
  const {receipts, obligations} = await runPilotApkUpdateRefinement();
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].model, 'PilotApkUpdate');
  assert.equal(receipts[0].traces, 12);
  assert.equal(receipts[0].driverInputsBound, true);
  assert.ok(obligations.some(row => row.obligation.includes('Installed update')));
});
