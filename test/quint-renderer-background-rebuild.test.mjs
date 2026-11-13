import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkRendererBackgroundRebuild} from '../specs/quint/refinement/native/renderer-background-rebuild.mjs';
import {jvmSkip} from './fixtures/jvm-tools.mjs';

test('MainActivity background renderer loss matches every RendererBackgroundRebuild model step', {timeout: scaledTimeout(300000), skip: jvmSkip('json', 'javac')}, () => {
  const replay = checkRendererBackgroundRebuild();
  assert.equal(replay.traces, 65);
  assert.ok(replay.steps > 1000, `${replay.steps} replayed steps`);
  assert.ok(replay.actions.report > 100 && replay.actions.recreated > 50);
  assert.equal(replay.reached.length, 7);
});
