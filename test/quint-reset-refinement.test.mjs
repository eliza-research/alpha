import assert from 'node:assert/strict';
import test from 'node:test';
import {checkResetOrchestration} from '../specs/quint/refinement/native/reset-orchestration.mjs';

test('reset durable admission and callbacks match the refined Quint transitions', {timeout: 600000}, async () => {
  const result = await checkResetOrchestration();
  assert.ok(result.regressions.checks >= 25);
  assert.equal(result.regressions.crossProcess, true);
  assert.equal(result.results.length, 20);
  assert.deepEqual(result.results.filter(row => row.status !== 'passed'), []);
});
