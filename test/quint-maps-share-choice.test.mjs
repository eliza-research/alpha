// Partial source contract regression evidence. Original schedules, actions and assertions are retained.
// Only the selected source members/components and controlled ports execute; this is not whole-file refinement.
import {after as afterPartialContract} from 'node:test';
import partialContractAssert from 'node:assert/strict';
import {fileURLToPath as partialContractFile} from 'node:url';
import {captureReplayClosure as capturePartialClosure} from '../specs/quint/refinement/observed-replay.mjs';
import {captureInputs as capturePartialInputs} from '../specs/quint/refinement/check-traces.mjs';
const partialContractInputs = capturePartialClosure([partialContractFile(import.meta.url)]);
afterPartialContract(() => partialContractAssert.deepEqual(capturePartialInputs(Object.keys(partialContractInputs)), partialContractInputs));

import test from 'node:test';
import assert from 'node:assert/strict';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import {modelNames} from '../specs/quint/refinement/services/maps-model-traces.mjs';
import {replayMapsShareChoice} from '../specs/quint/refinement/application/maps-share-choice.mjs';

test("partial source contract: the chat share-choice buttons follow every MapsShareChoice model trace step by step", {timeout: scaledTimeout(300000)}, async () => {
  const {scenarios, witnesses} = modelNames('specs/quint/application/MapsShareChoice.qnt');
  assert.equal(scenarios.length, 7);
  assert.equal(witnesses.length, 5);
  const result = await replayMapsShareChoice({scenarios, witnesses});
  console.log(JSON.stringify(result));
  assert.equal(result.traces, scenarios.length + witnesses.length + 60);
  assert.ok(result.checkpoints > result.traces * 5);
  for (const action of ['agentReply', 'userMessage', 'replaceText', 'render', 'tap', 'sendSettles', 'setHidden', 'setSheetOpen', 'setBusy', 'setTyping', 'setRecording', 'setDraft', 'setEditing', 'changeSession', 'changeConversation', 'unmount']) assert.ok(result.actions[action] > 0, action);
});
