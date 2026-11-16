import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {observedReplay} from '../specs/quint/refinement/observed-replay.mjs';
import {checkResidentStartCancel, checkResidentStartMutation} from '../specs/quint/refinement/native/resident-start-cancel.mjs';
import {jvmSkip} from './fixtures/jvm-tools.mjs';

test('AlphaLocalAgentPlugin start, cancel, stop and shutdown recheck match every ResidentStartCancel model step', {timeout: scaledTimeout(300000), skip: jvmSkip('json', 'javac')}, () => {
  const replay = checkResidentStartCancel();
  assert.equal(replay.traces, 76);
  assert.ok(replay.steps > 1000, `${replay.steps} replayed steps`);
  assert.ok(replay.actions.finishRetry >= 10 && replay.actions.retryShutdown >= 50 && replay.actions.start >= 50);
  assert.equal(replay.reached.length, 11);
});

test('the real credential mutation fences starts and owns the exact shutdown acknowledgement', {timeout:scaledTimeout(180000), skip:jvmSkip('json', 'javac')}, async () => {
  const receipt = await observedReplay({
    model:'ResidentStartCancel', prefix:'s',
    projection:'Whole AlphaLocalAgentPlugin lifecycle state, bridge refusal and in-memory commit observations',
    assumptions:[
      'The existing whole-plugin Java harness invokes mutateCredentials and the actual async start, cancel and retry paths. Boot state, deadline clock, exact service acknowledgements, focus and commit callback are closed fixture ports.',
      'A previously captured start probe returns after mutation admission. A stopped service still cannot commit when only another stop is acknowledged. The fixture never reads or writes a real credential slot.',
    ],
    extraSources:[fileURLToPath(import.meta.url)],
    out:'test-results/quint-refinement/ResidentStartMutation.json',
    run:checkResidentStartMutation,
  });
  assert.equal(receipt.traces, 5);
  assert.equal(receipt.checkpoints, 51);
  assert.equal(receipt.actions.beginMutation, 6);
  assert.equal(receipt.actions.resumeStartProbe, 1);
  assert.equal(receipt.replaySummary.reached.length, 5);
  assert.equal(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound && verifyRefinementReceiptInputs(receipt), true);
});
