import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkResidentStartCancel} from '../specs/quint/refinement/native/resident-start-cancel.mjs';
import {jvmSkip} from './fixtures/jvm-tools.mjs';

test('AlphaLocalAgentPlugin start, cancel, stop and shutdown recheck match every ResidentStartCancel model step', {timeout: scaledTimeout(300000), skip: jvmSkip('json', 'javac')}, () => {
  const replay = checkResidentStartCancel();
  assert.equal(replay.traces, 76);
  assert.ok(replay.steps > 1000, `${replay.steps} replayed steps`);
  assert.ok(replay.actions.finishRetry >= 10 && replay.actions.retryShutdown >= 50 && replay.actions.start >= 50);
  assert.equal(replay.reached.length, 11);
});
