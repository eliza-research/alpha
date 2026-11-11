import test from 'node:test';
import assert from 'node:assert/strict';
import {checkDeviceActionReview} from '../specs/quint/refinement/application/device-action-review.mjs';

test('real device-action coordinator binds review, reservation, claim and one effect', {timeout:120000}, async()=>{
  const receipt=await checkDeviceActionReview(['test/quint-device-action-review.test.mjs']);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
  assert.equal(receipt.traces,25);
  const last=Object.fromEntries(receipt.traceInputs.map(t=>[t.name,t.steps.at(-1).expect]));
  assert.equal(last['abort-before-effect']['s.dispatches'],0);
  assert.equal(last['abort-after-effect']['s.status'],'succeeded');
  assert.equal(last['receipt-outage']['s.synced'],false);
  assert.equal(last['terminal-journal-never-replayed']['s.dispatches'],1);
  assert.equal(last['recreated-coordinator-never-replays-journal']['s.dispatches'],1);
  assert.equal(last['direct-current-request']['s.authority'],'request');
  assert.equal(last['ask-first']['s.dispatches'],0);
});
