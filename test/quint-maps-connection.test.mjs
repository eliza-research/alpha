import test from 'node:test';
import assert from 'node:assert/strict';
import {modelNames} from '../specs/quint/refinement/services/maps-model-traces.mjs';
import {replayMapsConnection} from '../specs/quint/refinement/services/maps-connection.mjs';

test('Cloud Maps connection code follows every MapsConnection model trace step by step', {timeout: 300000}, async () => {
  const {scenarios, witnesses} = modelNames('specs/quint/services/MapsConnection.qnt');
  assert.equal(scenarios.length, 8);
  assert.equal(witnesses.length, 6);
  const result = await replayMapsConnection({scenarios, witnesses});
  console.log(JSON.stringify(result));
  assert.equal(result.traces, scenarios.length + witnesses.length + 40);
  assert.ok(result.checkpoints > result.traces * 5);
  for (const action of ['accountChange', 'clientRebuilt', 'residentBecomesReady', 'openMaps', 'searchRetry', 'attemptSettles', 'request', 'startGuidance', 'endGuidance', 'unguardedRead']) assert.ok(result.actions[action] > 0, action);
});
