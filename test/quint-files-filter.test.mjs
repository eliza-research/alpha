import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkFilesFilter, checkRetiredFilesFilterReload} from '../specs/quint/refinement/application/files-filter.mjs';

const source = fileURLToPath(import.meta.url);
test('actual Files filters discard late replies from replaced, cleared or cancelled requests', {timeout: 120000}, async () => {
  const receipt = await checkFilesFilter([source]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.traces, 17);
});

test('a reload retired by view leave cannot publish filter rows', async () => {
  await checkRetiredFilesFilterReload([source]);
});
