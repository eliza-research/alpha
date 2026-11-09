import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkReviewedWorkflowLauncher} from '../specs/quint/refinement/services/reviewed-workflow-launcher.mjs';

test('reviewed workflow launcher compares private admission and child handoff', {timeout: 150000}, async () => {
  const bun = process.env.ALPHA_QUINT_BUN;
  const receipt = await checkReviewedWorkflowLauncher([fileURLToPath(import.meta.url)], bun);
  assert.equal(receipt.model, 'ReviewedWorkflowLauncher');
  assert.equal(receipt.traces, bun ? 19 : 16);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
  const last = name => receipt.traceInputs.find(trace => trace.name === name).steps.at(-1).expect;
  assert.equal(last('default-source')['s.features'], 'disabled');
  assert.equal(last('existing-profile')['s.features'], 'enabled');
  assert.equal(last('existing-profile')['s.embeddings'], false);
  assert.equal(last('missing-entry')['s.token'], true);
  assert.equal(last('routing')['s.identity'], true);
  const revision = last('git-metadata');
  assert.equal(revision['s.child'], false);
  assert.equal(revision['s.logOpen'], false);
  const write = last('write-metadata');
  assert.equal(write['s.metadata'], false);
  assert.equal(write['s.childClosed'], true);
  assert.equal(write['s.logOpen'], false);
  assert.equal(write['s.cleanupSignal'], 'SIGTERM');
  assert.equal(write.ChildCustodyAfterReceiptFailure, true);
  assert.equal(last('spawn-error')['s.pid'], false);
  assert.equal(last('spawn-error')['s.exitCode'], 1);
  assert.equal(last('signal-int')['s.forwarded'], 'SIGINT');
  assert.equal(last('signal-term')['s.forwarded'], 'SIGTERM');
  assert.equal(last('exit-seven')['s.exitCode'], 7);
  if (bun) {
    assert.equal(last('actual-pinned')['s.preloadEntry'], true);
    assert.equal(last('actual-wrong-pin')['s.revision'], 'other');
    assert.equal(last('actual-wrong-pin')['s.preloadEntry'], false);
    assert.equal(last('actual-dirty')['s.revision'], 'pinned');
    assert.equal(last('actual-dirty')['s.preloadEntry'], false);
  }
});
