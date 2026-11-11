import test from 'node:test';
import assert from 'node:assert/strict';
import {replayDomainDocumentCreation} from '../specs/quint/refinement/application/domain-document-creation.mjs';

test('browser domain documents follow every DomainDocumentCreation model step', {timeout: 180000}, async () => {
  const receipt = await replayDomainDocumentCreation({traces: 40, maxSteps: 14});
  assert.equal(receipt.traces, 40);
  assert.ok(receipt.steps > 100, JSON.stringify(receipt));
  for (const action of ['read', 'edit', 'legacyWrite']) assert.ok(receipt.actions[action] > 0, action);
});
test('a domain document that imports changed legacy bytes is rejected by the replay', {timeout: 180000}, async () => {
  await assert.rejects(replayDomainDocumentCreation({traces: 40, maxSteps: 14, rewrite: {'browser/domain-document.ts': text =>
    text.replace("if(actual!==expected)throw", 'if(false)throw')}}), /trace \d+ step \d+ (read|edit)/);
});
