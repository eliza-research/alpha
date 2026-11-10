import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {collectApplicationCampaigns, runApplicationRefinement} from '../specs/quint/refinement/application/index.mjs';

// The complete aggregate exceeded 20 minutes on the measured two-worker run.
// Keep all component checks and their own bounds; allow the aggregate to finish.
test('application source observations match bounded Quint component traces', {timeout: 2400000}, async () => {
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
