import test from 'node:test';
import assert from 'node:assert/strict';
import {checkHomeInstanceHandoff} from '../specs/quint/refinement/native/home-instance-handoff.mjs';
import {jvmSkip} from './fixtures/jvm-tools.mjs';

test('MainActivity hand-off matches every HomeInstanceHandoff model step', {timeout: 300000, skip: jvmSkip('json', 'javac')}, () => {
  const replay = checkHomeInstanceHandoff();
  assert.equal(replay.traces, 64);
  assert.ok(replay.steps > 500, `${replay.steps} replayed steps`);
  assert.ok(replay.actions.frontStartArrives > 0);
  assert.equal(replay.reached.length, 6);
});
