import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runNativeRefinement} from '../specs/quint/refinement/native/index.mjs';

test('native source transitions refine their finite Quint projections', {timeout: 600000}, async () => {
  const results = await runNativeRefinement();
  const manifest = JSON.parse(readFileSync(new URL('../specs/quint/native/manifest.json', import.meta.url)));
  const expected = [...manifest.models.map(model => model.module).filter(model => !['ApplicationComposition', 'ControllerComposition'].includes(model)),
    'NativeCredentialMutation'].sort();
  assert.deepEqual([...new Set(results.receipts.map(result => result.model))].sort(), expected);
  for (const result of results.receipts) {
    assert.ok(result.checkpoints > 0, result.model);
    assert.equal(result.driverInputsBound, true, `${result.model} driver inputs`);
    assert.equal(result.passed, true, result.model);
  }
  for (const model of ['ApplicationComposition', 'ControllerComposition']) {
    assert.ok(results.obligations.some(item => item.model === model), model);
  }
});
