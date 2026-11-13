import test from 'node:test';
import assert from 'node:assert/strict';
import {modelNames} from '../specs/quint/refinement/services/maps-model-traces.mjs';
import {replayMapsAgentSurfaceAdmission} from '../specs/quint/refinement/application/maps-agent-surface-admission.mjs';

test('the Maps adapter agent surface check follows every MapsAgentSurfaceAdmission model trace step by step', {timeout: 300000}, async () => {
  const {scenarios, witnesses} = modelNames('specs/quint/application/MapsAgentSurfaceAdmission.qnt');
  assert.equal(scenarios.length, 8);
  assert.equal(witnesses.length, 5);
  const result = await replayMapsAgentSurfaceAdmission({scenarios, witnesses});
  console.log(JSON.stringify(result));
  assert.equal(result.traces, scenarios.length + witnesses.length + 80);
  assert.ok(result.checkpoints > result.traces * 5);
  for (const action of ['setBlock', 'go', 'request', 'commit', 'timeout', 'dispose']) assert.ok(result.actions[action] > 0, action);
});
