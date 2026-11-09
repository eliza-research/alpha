import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeSource, fixture, runJvm, jsonJarSkip } from './fixtures/jvm-tools.mjs';

test('native paired speech accepts the pinned host contract and rejects stale providers, wrong identities and invalid text', { skip: jsonJarSkip }, () => {
  assert.match(runJvm(
    [nativeSource('PairedSpeechContract.java'), fixture('PairedSpeechContractTest.java')],
    'ai.elizaresearch.alphaphone.PairedSpeechContractTest', { json: true },
  ), /^PASS paired speech exact contract/);
});
