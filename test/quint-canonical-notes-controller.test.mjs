import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkCanonicalNotesController} from '../specs/quint/refinement/application/canonical-notes-controller.mjs';

test('current canonical Notes controller matches owner, request and listener schedules', {timeout:scaledTimeout(120000)}, async () => {
  const receipt = await checkCanonicalNotesController([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 14);
  assert.equal(receipt.observedFields.length, 21);
  for (const name of ['write-aborts-read', 'late-aborted-read', 'stale-read', 'retire-read', 'retire-write', 'binding-read', 'events']) {
    assert.ok(receipt.traceInputs.some(trace => trace.name === name), name);
  }
});
