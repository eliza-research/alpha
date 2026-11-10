import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {collectApplicationCampaigns, runApplicationRefinement} from '../specs/quint/refinement/application/index.mjs';

// The aggregate runs 110 source-observation campaigns, each with its own bounded
// driver checks. A progressing prepared-SDK run exceeded 20 minutes before the
// final campaigns; allow collection to finish without relaxing any trace checks.
test('application source observations match bounded Quint component traces', {timeout: 1800000}, async () => {
  const result = await runApplicationRefinement();
  assert.deepEqual(result.failures, [], result.failures.map(({campaign, error}) => `${campaign}: ${error}`).join('\n'));
  const manifest = JSON.parse(readFileSync(new URL('../specs/quint/application/manifest.json', import.meta.url)));
  assert.deepEqual(new Set(result.receipts.map(receipt => receipt.coverageModel)), new Set(manifest.map(model => model.module)));
  assert.ok(result.receipts.every(receipt => receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound));
  assert.ok(Array.isArray(result.obligations), 'remaining obligations accompany the bounded evidence');
});

test('application campaign retains receipts before and after an adapter fails', async () => {
  const initial = {model: 'ShellNavigation', observedFields: [], traceInputs: [{}], assumptions: []};
  const timeout = new Error('fixture failed to mount');
  const result = await collectApplicationCampaigns([
    () => ({...initial, id: 'before'}),
    function failedMount() {throw timeout;},
    () => ({receipt: {...initial, id: 'after'}, obligations: [{obligation: 'fixture'}]}),
  ]);
  assert.deepEqual(result.receipts.map(receipt => [receipt.coverageModel, receipt.id]),
    [['ShellNavigation', 'before'], ['ShellNavigation', 'after']]);
  assert.deepEqual(result.failures, [{campaign: 'failedMount', error: timeout}]);
  assert.ok(result.obligations.some(row => row.obligation === 'fixture'));
});
