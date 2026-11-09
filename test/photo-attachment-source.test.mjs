import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeSource, fixture, runJvm } from './fixtures/jvm-tools.mjs';

test('Photos attachment source keeps exact readable bytes and rejects changed or revoked sources', () => {
  assert.match(runJvm(
    [nativeSource('PhotoAttachmentSource.java'), fixture('PhotoAttachmentSourceTest.java')],
    'ai.elizaresearch.alphaphone.PhotoAttachmentSourceTest',
  ), /^PASS photo attachment source/);
});
