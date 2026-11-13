import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkChatAttachments} from '../specs/quint/refinement/application/chat-attachments.mjs';

// Partial source contract regression. Original extracted member schedules and ports remain bounded.
// This does not establish whole-file refinement, installed behavior or acceptance.
test('partial source contract: ChatAttachments retains its original source schedules', {timeout: 240000}, async () => {
  const receipt = await checkChatAttachments([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.model, 'ChatAttachments');
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
