import test from 'node:test';
import assert from 'node:assert/strict';
import {modelNames} from '../specs/quint/refinement/services/maps-model-traces.mjs';
import {replayMapsGuidanceVoice} from '../specs/quint/refinement/services/maps-guidance-voice.mjs';

test('the guidance voice follows every MapsGuidanceVoice model trace step by step', {timeout: 300000}, async () => {
  const {scenarios, witnesses} = modelNames('specs/quint/services/MapsGuidanceVoice.qnt');
  assert.equal(scenarios.length, 7);
  assert.equal(witnesses.length, 6);
  const result = await replayMapsGuidanceVoice({scenarios, witnesses});
  console.log(JSON.stringify(result));
  assert.equal(result.traces, scenarios.length + witnesses.length + 60);
  assert.ok(result.checkpoints > result.traces * 5);
  for (const action of ['update', 'hide', 'show', 'speechSettles', 'pause', 'toggle', 'contextChanges', 'setSheetOpen']) assert.ok(result.actions[action] > 0, action);
});
