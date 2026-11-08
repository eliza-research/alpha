import test from 'node:test';
import assert from 'node:assert/strict';
import {checkNotePermission,notePermissionScenarios} from '../specs/quint/refinement/native/note-bridge.mjs';

test('actual Note bridge rechecks call and lifecycle before queued microphone admission', {timeout:300000}, async()=>{
  const receipt=await checkNotePermission(['test/quint-note-permission.test.mjs']);
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,notePermissionScenarios.length);
  assert.equal(receipt.driverInputsBound,true);
  assert.equal(receipt.inputsUnchanged,true);
  assert.ok(receipt.actions.permissionReply>0);
  assert.ok(receipt.actions.closeHost>0);
  assert.ok(receipt.actions.runQueued>0);
});
