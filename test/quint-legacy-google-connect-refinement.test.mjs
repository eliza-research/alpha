import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {tsImport} from 'tsx/esm/api';

test('historical Google Connect replays mounted Inbox and Calendar consent boundaries', {timeout: 360000}, async () => {
  const entry = new URL('../specs/quint/legacy/google-connect/check-google-connect-refinement.mjs', import.meta.url);
  const {checkGoogleConnectRefinement} = await tsImport(entry.href, import.meta.url);
  const {receipts: [receipt], mismatches} = await checkGoogleConnectRefinement([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 3);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
  assert.deepEqual(mismatches.map(row => row.id), ['GoogleConnectProposedDirectConsent', 'GoogleConnectCurrentReadOnlyRequest']);
});
