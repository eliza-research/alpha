import test from 'node:test';
import assert from 'node:assert/strict';
import {listFocus} from '../specs/quint/refinement/application/list-focus.mjs';

test('source list-focus captures and FIFO callbacks match the bounded Quint helper model', {timeout:180000}, async () => {
 const result=await listFocus();
 assert.equal(result.passed,true);
 assert.equal(result.inputsUnchanged,true);
 assert.equal(result.driverInputsBound,true);
 assert.equal(result.observedFields.length,15);
 assert.equal(result.traceInputs.length,24);
 for(const name of ['capture-unmounted','capture-no-focus','capture-other-owner','capture-missing-key',
  'restore','removed','duplicate','other','other-blur','hidden-root','hidden-node','disabled','dialog',
  'hidden-document','disconnected','navigation','newer-commit','discarded','unchanged',
  'two-captures','restoring-before-expiry'])assert(result.traceInputs.some(trace=>trace.name===name),name);
});
