import assert from 'node:assert/strict';
import test from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {collectLegacyCampaigns} = await tsImport('../specs/quint/refinement/legacy/index.mjs', import.meta.url);

test('the legacy campaign preserves receipts on either side of a failed replay', async () => {
  const error = Error('synthetic source refusal', {cause: Error('closed fixture cause')});
  const obligation = {model: 'First', obligation: 'fixture boundary'};
  const result = await collectLegacyCampaigns([
    ['First', async () => ({receipts: [{model: 'first-profile'}], obligations: [obligation]})],
    ['Failed', async () => {throw error;}],
    [null, async () => [{model: 'Later'}]],
  ]);
  assert.deepEqual(result.receipts, [{model: 'first-profile', coverageModel: 'First'}, {model: 'Later'}]);
  assert.deepEqual(result.obligations, [obligation]);
  assert.deepEqual(result.failures, [{campaign: 'Failed', error}]);
});
