import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {nodeOnly} from './support/node-only.mjs';
import {checkBrowserFilesTrash} from '../specs/quint/refinement/application/browser-files-trash.mjs';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';

// Leave time for source preparation and receipt verification around the 120-second checker.
test('Files Trash lock, exact marker custody and recovery compare with the prepared source', {timeout: scaledTimeout(180000), ...nodeOnly('the Files Trash source takes a Web Lock and Bun has no navigator.locks')}, async () => {
  const receipt = await checkBrowserFilesTrash([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.model, 'BrowserFilesTrash');
  assert.equal(receipt.traces, 12);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
  for (const mode of ['web', 'fallback']) {
    const traces = receipt.traceInputs.filter(trace => trace.name.startsWith(mode+' '));
    assert.equal(traces.length, 6);
    const placements = traces.find(trace => trace.name.endsWith('failedPlacements'));
    assert.equal(placements.steps.at(-1).expect['s.status'], 'failed');
    assert.deepEqual(placements.steps.at(-1).expect['s.rows'].entries, [[1, 'live'], [2, 'live']]);
  }
});
