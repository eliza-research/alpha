import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkDeviceActionReview} from '../specs/quint/refinement/application/device-action-review.mjs';

test('real device-action coordinator binds review, reservation, claim and one effect', {timeout:scaledTimeout(120000)}, async()=>{
  const receipt=await checkDeviceActionReview(['test/quint-device-action-review.test.mjs']);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
  assert.equal(receipt.traces,36);
  const last=Object.fromEntries(receipt.traceInputs.map(t=>[t.name,t.steps.at(-1).expect]));
  assert.equal(last['abort-before-effect']['s.dispatches'],0);
  assert.equal(last['abort-after-effect']['s.status'],'succeeded');
  assert.equal(last['receipt-outage']['s.synced'],false);
  assert.equal(last['terminal-journal-never-replayed']['s.dispatches'],1);
  assert.equal(last['recreated-coordinator-never-replays-journal']['s.dispatches'],1);
  assert.equal(last['direct-current-request']['s.authority'],'request');
  assert.equal(last['ask-first']['s.dispatches'],0);
  assert.equal(last['unreadable-preference']['s.dispatches'],0);
  assert.equal(last['unreadable-preference']['s.journal'],'empty');
  // One pass over five current-request notes runs four; the fifth keeps its card.
  assert.equal(last['four-direct-per-pass']['s.passEffects'],4);
  assert.equal(last['four-direct-per-pass']['s.card'],true);
  assert.equal(last['four-direct-per-pass']['s.journal'],'empty');
  assert.equal(last['failure-ends-pass']['s.passOpen'],false);
  assert.equal(last['failure-ends-pass']['s.passEffects'],1);
  assert.equal(last['mixed-pass']['s.browserAuto'],1);
  assert.equal(last['second-pass-keeps-browser-attempt']['s.browserAuto'],1);
  assert.equal(last['workflow-step-never-listed']['s.card'],false);
  assert.equal(last['settings-is-navigation-only']['s.op'],'settings_write');
  assert.equal(last['settings-is-navigation-only']['s.card'],false);
  assert.equal(last['expired-after-claim']['s.dispatches'],0);
  assert.equal(last['expired-after-claim']['s.status'],'failed');
  // Known divergence (AGENT-06): no dispatch, yet the public call answers "unknown".
  for (const name of ['reserve-failure','decision-outage','missing-execution-claim','direct-pre-dispatch-failure-answers-unknown']) {
    const steps=receipt.traceInputs.find(t=>t.name===name).steps;
    assert.ok(steps.some(step=>step.expect['s.returned']==='unknown'&&step.expect['s.dispatches']===0),name);
  }
});
