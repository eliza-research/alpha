import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkPluginConnectorCustody} from '../specs/quint/legacy/core/check-plugin-connector-custody.mjs';

test('pinned plugin connector custody exposes late publication and exact rival ownership', {timeout: 120000}, async () => {
  const result = await checkPluginConnectorCustody([fileURLToPath(import.meta.url)]);
  assert.deepEqual(result.records.map(record => record.checkpoints.length), [6, 5, 4, 5, 4, 4]);
});
