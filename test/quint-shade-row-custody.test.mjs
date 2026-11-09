import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkShadeRowCustody} from '../specs/quint/refinement/application/shade-row-custody.mjs';

test('the simulated shade refines exact poll and rendered row custody', {timeout: 120000}, async () => {
  const receipt = await checkShadeRowCustody([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 10);
});
