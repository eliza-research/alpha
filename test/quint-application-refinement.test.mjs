import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {collectApplicationCampaigns, runApplicationRefinement} from '../specs/quint/refinement/application/index.mjs';

// The complete campaign exceeded the former 40-minute ceiling on the build VM.
// Preserve every component bound and use the same two-hour ceiling as archive verification.
test('application source observations match bounded Quint component traces', {timeout: 7200000}, async () => {
  const result = await runApplicationRefinement(({receipts, failures}) => {
    console.log('Application refinement:', receipts.length, 'completed,', failures.length, 'failed;', receipts.at(-1)?.coverageModel || 'starting');
  });
  assert.deepEqual(result.failures, [], result.failures.map(({campaign, error}) => `${campaign}: ${error}`).join('\n'));
  const manifest = JSON.parse(readFileSync(new URL('../specs/quint/application/manifest.json', import.meta.url)));
  const declared = new Set(manifest.map(model => model.module));
  assert.ok(result.receipts.every(receipt => declared.has(receipt.coverageModel)));
  const observed = new Set(result.receipts.map(receipt => receipt.coverageModel));
  for (const model of declared) {
    if (!observed.has(model)) assert.ok(result.obligations.some(row =>
      row.model === model && row.obligation === 'Source-adapter refinement'));
  }
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
  assert.ok(result.obligations.some(row => row.model === 'Application' && row.obligation === 'Source-adapter refinement'));
});
