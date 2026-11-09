import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkBrowserAlbumStorage} from '../specs/quint/refinement/application/browser-album-storage.mjs';

test('browser album commits and rendered membership match the media-revision model', {timeout: 420_000}, async () => {
  const receipt = await checkBrowserAlbumStorage([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 4);
});
