import test from 'node:test';
import assert from 'node:assert/strict';
import {modelNames} from '../specs/quint/refinement/services/maps-model-traces.mjs';
import {replayResidentMapsRelayOffer} from '../specs/quint/refinement/services/resident-maps-relay-offer.mjs';

test('the resident navigation relay follows every ResidentMapsRelayOffer model trace step by step', {timeout: 300000}, async () => {
  const {scenarios, witnesses} = modelNames('specs/quint/services/ResidentMapsRelayOffer.qnt');
  assert.equal(scenarios.length, 8);
  assert.equal(witnesses.length, 6);
  const result = await replayResidentMapsRelayOffer({scenarios, witnesses});
  console.log(JSON.stringify(result));
  assert.equal(result.traces, scenarios.length + witnesses.length + 60);
  assert.ok(result.checkpoints > result.traces * 5);
  for (const action of ['setNavigation', 'beginTurn', 'openSettles', 'receivingFails', 'endTurn']) assert.ok(result.actions[action] > 0, action);
});
