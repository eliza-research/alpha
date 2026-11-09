import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkBrowserFilesTrash} from '../specs/quint/refinement/application/browser-files-trash.mjs';

test('Files Trash lock, exact marker custody and recovery compare with the prepared source', {timeout: 120000}, async () => {
  const receipt = await checkBrowserFilesTrash([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.model, 'BrowserFilesTrash');
  assert.equal(receipt.traces, 12);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
  for (const mode of ['web', 'fallback']) {
    const traces = receipt.traceInputs.filter(trace => trace.name.startsWith(mode+' '));
    assert.equal(traces.length, 6);
    assert.equal(traces.find(trace => trace.name.endsWith('failedMoves')).steps.at(-1).expect.AllRowsReachVisiblePlace, false);
  }
});
