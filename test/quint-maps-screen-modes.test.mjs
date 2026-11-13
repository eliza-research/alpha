import test from 'node:test';
import assert from 'node:assert/strict';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import {modelNames} from '../specs/quint/refinement/services/maps-model-traces.mjs';
import {replayMapsScreenModes} from '../specs/quint/refinement/services/maps-screen-modes.mjs';

test('the mounted Maps screen follows every MapsScreenModes model trace step by step', {timeout: scaledTimeout(600000)}, async () => {
  const {scenarios, witnesses} = modelNames('specs/quint/services/MapsScreenModes.qnt');
  assert.equal(scenarios.length, 17);
  assert.equal(witnesses.length, 9);
  const result = await replayMapsScreenModes({scenarios, witnesses});
  console.log(JSON.stringify(result));
  assert.equal(result.traces, scenarios.length + witnesses.length + 150);
  assert.ok(result.checkpoints > result.traces * 5);
  for (const action of ['focusSearch', 'typeQuery', 'clearQuery', 'submitSearch', 'pickResult', 'pickSaved', 'closePlace', 'openDirections', 'openGrantedDirections',
    'locate', 'fixArrives', 'editOrigin', 'searchOrigin', 'chooseOrigin', 'routePlanned', 'start', 'screenOffStarted', 'screenOffRefused',
    'screenOffLost', 'end', 'back', 'leave', 'hide', 'show', 'agentShowPlace', 'agentShowDirections', 'agentPlanFrom', 'crossAppQuery',
    'offerHandoff', 'consumeHandoff']) assert.ok(result.actions[action] > 0, action);
});
