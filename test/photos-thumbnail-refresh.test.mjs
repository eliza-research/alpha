import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {batches, thumbnailPlan} from '../apps/app/src/runtime/photos-view.ts';

// Run the adapter's real thumbnail completion path. The native read can finish after a catalog
// reload, so a thumbnail from the old catalog must never be installed in its replacement row.
const source = readFileSync('apps/app/src/prototype/camera-adapter.ts', 'utf8');
const start = source.indexOf('  async function settleThumbnails(');
const end = source.indexOf('  const gridCss=', start);
assert.ok(start >= 0 && end > start);
const implementation = stripTypeScriptTypes(source.slice(start, end), {mode: 'transform'});

test('a thumbnail read finishing after a catalog reload preserves the new row and retries its image', async () => {
  const id = 'native-camera-m:external_primary:i:1';
  const oldRow = {id, date: 1, revision: 'old', image: ''};
  let finishRead;
  const updates = [];
  const context = vm.createContext({
    captures: [oldRow], libraryEpoch: 1, disposed: false, thumbFetching: new Set(),
    thumbnailPlan, batches, LIBRARY_LIMITS: {thumbnailsKept: 240},
    nativeId: id => id.replace(/^native-camera-/, ''),
    library: {thumbnails: () => new Promise(resolve => { finishRead = resolve; })},
    photosApi: {set: patch => updates.push(patch)},
  });
  vm.runInContext(implementation, context);
  const pending = context.settleThumbnails([oldRow], 0, 1);
  context.captures = [{...oldRow, revision: 'new'}];
  context.libraryEpoch++;
  finishRead({items: [{id: 'm:external_primary:i:1', image: 'old pixels'}]});
  await pending;
  assert.equal(context.captures[0].image, '', 'old pixels cannot fill a newer catalog row');
  assert.equal(context.thumbFetching.size, 0, 'the stale request releases its pending ids');
  assert.equal(updates.length, 1, 'rerender retries the current catalog after pending ids release');

  context.library.thumbnails = async () => ({items: [{id: 'm:external_primary:i:1', image: 'new pixels'}]});
  await context.settleThumbnails(context.captures, 0, 1);
  assert.equal(context.captures[0].image, 'new pixels');
});
