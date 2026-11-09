import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nativeSource, fixture, runJvm } from './fixtures/jvm-tools.mjs';

test('delayed provider results cannot cross a lifecycle or permission boundary', () => {
  assert.match(runJvm(
    [nativeSource('NativeReadEpoch.java'), fixture('NativeReadEpochTest.java')],
    'ai.elizaresearch.alphaphone.NativeReadEpochTest',
  ), /^PASS native read publication fences/);
  const catalog=readFileSync(nativeSource('PermittedMediaCatalog.java'),'utf8');
  assert.match(catalog,/main\.post\(\(\)->\{try\{requireReadTicket\(ticket\);call\.resolve/);
  assert.match(catalog,/checkReadAccess/);assert.match(catalog,/ACTION_SCREEN_OFF/);
  const photos=readFileSync(nativeSource('AlphaPhotosPlugin.java'),'utf8');
  assert.match(photos,/permitted\.publish\(call,value,ticket\)/);
  const facade=readFileSync(nativeSource('AlphaPhotoLibraryPlugin.java'),'utf8');
  assert.equal((facade.match(/catalog\.publish\(call,/g)||[]).length,3);
});
