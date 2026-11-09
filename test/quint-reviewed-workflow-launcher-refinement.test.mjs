import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkReviewedWorkflowLauncher} from '../specs/quint/refinement/services/reviewed-workflow-launcher.mjs';

test('reviewed workflow launcher compares private admission and child handoff', {timeout: 150000}, async () => {
  const bun = process.env.ALPHA_QUINT_BUN;
  const receipt = await checkReviewedWorkflowLauncher([fileURLToPath(import.meta.url)], bun);
  assert.equal(receipt.model, 'ReviewedWorkflowLauncher');
  assert.equal(receipt.traces, bun ? 18 : 15);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
  const last = name => receipt.traceInputs.find(trace => trace.name === name).steps.at(-1).expect;
  assert.equal(last('default-source')['s.features'], 'disabled');
  assert.equal(last('existing-profile')['s.features'], 'enabled');
  assert.equal(last('existing-profile')['s.embeddings'], false);
  assert.equal(last('missing-entry')['s.token'], true);
  assert.equal(last('routing')['s.identity'], true);
  for (const name of ['git-metadata', 'write-metadata']) {
    const outcome = last(name);
    assert.equal(outcome['s.booted'], true);
    assert.equal(outcome['s.metadata'], false);
    assert.equal(outcome.ChildCustodyAfterReceiptFailure, false);
  }
  if (bun) {
    assert.equal(last('actual-pinned')['s.preloadEntry'], true);
    assert.equal(last('actual-wrong-pin')['s.revision'], 'other');
    assert.equal(last('actual-wrong-pin')['s.preloadEntry'], false);
    assert.equal(last('actual-dirty')['s.revision'], 'pinned');
    assert.equal(last('actual-dirty')['s.preloadEntry'], false);
  }
});
