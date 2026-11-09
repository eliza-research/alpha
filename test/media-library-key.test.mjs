import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeSource, fixture, runJvm } from './fixtures/jvm-tools.mjs';

test('media identities distinguish volumes and kinds and refuse ambiguous or cross-user inputs', () => {
  assert.match(runJvm(
    [nativeSource('MediaLibraryKey.java'), fixture('MediaLibraryKeyTest.java')],
    'ai.elizaresearch.alphaphone.MediaLibraryKeyTest',
  ), /^PASS media library keys/);
});
