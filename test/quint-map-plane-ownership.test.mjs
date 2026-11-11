import test from 'node:test';
import assert from 'node:assert/strict';
import {modelNames} from '../specs/quint/refinement/services/maps-model-traces.mjs';
import {replayMapPlaneOwnership} from '../specs/quint/refinement/application/map-plane-ownership.mjs';

test('the Maps adapter map plane handling follows every MapPlaneOwnership model trace step by step', {timeout: 300000}, async () => {
  const {scenarios, witnesses} = modelNames('specs/quint/application/MapPlaneOwnership.qnt');
  assert.equal(scenarios.length, 7);
  assert.equal(witnesses.length, 5);
  const result = await replayMapPlaneOwnership({scenarios, witnesses});
  console.log(JSON.stringify(result));
  assert.equal(result.traces, scenarios.length + witnesses.length + 60);
  assert.ok(result.checkpoints > result.traces * 5);
  for (const action of ['render', 'setBasemap', 'planeEvent', 'retry', 'release', 'setActive', 'dispose']) assert.ok(result.actions[action] > 0, action);
});
