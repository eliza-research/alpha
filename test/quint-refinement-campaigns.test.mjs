import assert from 'node:assert/strict';
import test from 'node:test';
import {collectRefinementCampaigns} from '../specs/quint/refinement/campaigns.mjs';

test('a failed service campaign retains earlier receipts and still checks later adapters', async () => {
  const error = Error('closed compiler failed', {cause: Error('synthetic javac SIGSEGV')});
  const base = {model: 'Base', obligation: 'External acceptance'};
  const earlier = {model: 'Earlier', obligation: 'Selected provider boundary'};
  const later = {model: 'Later', obligation: 'Selected device boundary'};
  const receipts = ['Earlier', 'EarlierArray', 'Later'].map(model => ({model, passed: true}));
  const ran = [];
  const result = await collectRefinementCampaigns([
    ['earlier', async () => {ran.push('earlier'); return {receipts: [receipts[0]], obligations: [earlier]};}],
    ['earlierArray', async () => {ran.push('earlierArray'); return [receipts[1]];}],
    ['credentialRefinement', async () => {ran.push('credentialRefinement'); throw error;}],
    ['later', async () => {ran.push('later'); return {receipts: [receipts[2]], obligations: [later]};}],
    ['laterSingle', async () => {ran.push('laterSingle'); return {model: 'LaterSingle', passed: true};}],
  ], [base]);

  assert.deepEqual(ran, ['earlier', 'earlierArray', 'credentialRefinement', 'later', 'laterSingle']);
  assert.deepEqual(result.receipts, [...receipts, {model: 'LaterSingle', passed: true}]);
  assert.deepEqual(result.obligations, [base, earlier, later]);
  assert.deepEqual(result.failures, [{campaign: 'credentialRefinement', error}]);
});

test('an explicitly failed receipt remains evidence without ending the service campaign', async () => {
  const failed = {model: 'FailedReceipt', passed: false};
  const later = {model: 'LaterReceipt', passed: true};
  const result = await collectRefinementCampaigns([
    ['reportedFailure', async () => [failed]],
    ['later', async () => later],
  ]);

  assert.deepEqual(result.receipts, [failed, later]);
  assert.equal(result.failures[0].campaign, 'reportedFailure');
  assert.match(result.failures[0].error.message, /FailedReceipt/);
});

test('a native group retains the receipt emitted before a later checkpoint fails', async () => {
  const error = Error('synthetic replay failed');
  const earlier = {model: 'EarlierNative', passed: true};
  const later = {model: 'LaterNative', passed: true};
  const obligation = {model: later.model, obligation: 'Installed callback delivery'};
  const result = await collectRefinementCampaigns([
    ['ComponentTraces', async record => {record(earlier); throw error;}],
    ['nextAdapter', async () => ({receipt: later, obligations: [obligation]})],
  ]);

  assert.deepEqual(result.receipts, [earlier, later]);
  assert.deepEqual(result.obligations, [obligation]);
  assert.deepEqual(result.failures, [{campaign: 'ComponentTraces', error}]);
});
