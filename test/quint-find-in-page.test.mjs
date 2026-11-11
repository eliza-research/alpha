import test from 'node:test';
import assert from 'node:assert/strict';
import {checkFindInPage} from '../specs/quint/refinement/application/find-in-page.mjs';

test('the browser adapter find bar follows every FindInPage trace', {timeout: 240000}, async () => {
  const receipt = await checkFindInPage();
  assert.equal(receipt.traces, 49);
  assert.ok(receipt.checkpoints > 1000, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['openFind', 'closeFind', 'typeQuery', 'timerFires', 'nativeResult', 'deliver', 'pick', 'present', 'navigate', 'closeTab'])
    assert.ok(receipt.actions[action] > 0, `${action} is replayed`);
});
