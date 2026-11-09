import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeSource, fixture, runJvm } from './fixtures/jvm-tools.mjs';

test('local speech model ownership cancels without blocking, reopens safely and validates complete PCM', () => {
  assert.match(runJvm(
    [nativeSource('AlphaLocalSpeechEngine.java'), fixture('AlphaLocalSpeechEngineTest.java')],
    'ai.elizaresearch.alphaphone.AlphaLocalSpeechEngineTest',
  ), /^PASS local speech lifecycle and PCM/);
});
