import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { root, fixture, runJvm } from './fixtures/jvm-tools.mjs';

test('listener stop and resume reject in-flight recognition and queued invocation', () => {
  assert.match(runJvm(
    [join(root, 'android/sense/src/main/java/ai/elizaresearch/alphaphone/sense/ListeningEpoch.java'), fixture('ListeningEpochTest.java')],
    'ai.elizaresearch.alphaphone.sense.ListeningEpochTest',
  ), /^PASS listener session authority/);
});
