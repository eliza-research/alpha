import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runApplicationRefinement} from '../specs/quint/refinement/application/index.mjs';

test('application source observations match bounded Quint component traces', {timeout: 1200000}, async () => {
  const result = await runApplicationRefinement();
  const manifest = JSON.parse(readFileSync(new URL('../specs/quint/application/manifest.json', import.meta.url)));
  assert.deepEqual(new Set(result.receipts.map(receipt => receipt.coverageModel)), new Set(manifest.map(model => model.module)));
  assert.ok(result.receipts.every(receipt => receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound));
  assert.ok(Array.isArray(result.obligations), 'remaining obligations accompany the bounded evidence');
});
