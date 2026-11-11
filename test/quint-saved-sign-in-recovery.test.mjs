import test from 'node:test';
import assert from 'node:assert/strict';
import {checkSavedSignInRecovery} from '../specs/quint/refinement/native/saved-sign-in-recovery.mjs';
import {jvmSkip} from './fixtures/jvm-tools.mjs';

test('AlphaCloudSignInPlugin saved sign-in restore matches every SavedSignInRecovery model step', {timeout: 300000, skip: jvmSkip('json', 'javac')}, () => {
  const replay = checkSavedSignInRecovery();
  assert.equal(replay.traces, 122);
  assert.ok(replay.steps > 1000, `${replay.steps} replayed steps`);
  assert.ok(replay.actions.restoreEnds >= 10 && replay.actions.restoreReads >= 50);
  assert.equal(replay.reached.length, 7);
});
