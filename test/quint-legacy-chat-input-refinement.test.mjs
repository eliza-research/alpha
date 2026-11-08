import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkChatInputRefinement} from '../specs/quint/legacy/chat-input/check-chat-input-refinement.mjs';

test('historical chat input profiles replay exact mounted composer observations', {timeout: 240000}, async () => {
  const {receipts: [receipt], mismatches} = await checkChatInputRefinement([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.model, 'ChatInput');
  assert.equal(receipt.traces, 6);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
  assert.equal(mismatches.length, 4);
  assert.ok(mismatches.every(row => row.driverInputsBound && row.results[0].kind === 'observation-mismatch'));
});
