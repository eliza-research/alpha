import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeSource, fixture, runJvm, jsonJarSkip } from './fixtures/jvm-tools.mjs';

test('native digest consent and source reads remain bounded across persistence and revocation', { skip: jsonJarSkip }, () => {
  assert.match(runJvm(
    ['NoticeOwner.java', 'NativeDigestSources.java', 'HostedResultNotices.java'].map(nativeSource)
      .concat(fixture('NativeDigestSourcesTest.java')),
    'ai.elizaresearch.alphaphone.NativeDigestSourcesTest',
    { json: true },
  ), /^PASS native digest sources/);
});
