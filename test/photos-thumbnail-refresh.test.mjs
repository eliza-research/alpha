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

test('album covers keep their thumbnail through a deep scroll, and a cover dropped earlier is read again', async () => {
  const row = n => ({id: 'native-camera-m:external_primary:i:' + n, date: 1000 - n, revision: 'r', image: 'pixels ' + n});
  const reads = [];
  const context = vm.createContext({
    captures: Array.from({length: 600}, (_, n) => row(n)), libraryEpoch: 1, disposed: false, thumbFetching: new Set(), browserMode: false,
    thumbnailPlan, batches, LIBRARY_LIMITS: {thumbnailsKept: 240}, queueMicrotask,
    nativeId: id => id.replace(/^native-camera-/, ''),
    library: {thumbnails: async ({ids}) => { reads.push(ids); return {items: ids.map(id => ({id, image: 'read ' + id}))}; }},
    photosApi: {set: () => {}},
  });
  vm.runInContext(implementation, context);
  // Albums showed rows 0 (Camera) and 3 (a custom album) as covers; the owner then scrolls far down.
  context.keepCovers([context.captures[0], context.captures[3], undefined]);
  await context.settleThumbnails(context.captures, 500, 520);
  assert.equal(context.captures[0].image, 'pixels 0', 'a cover keeps its thumbnail');
  assert.equal(context.captures[3].image, 'pixels 3');
  assert.equal(context.captures[1].image, '', 'other rows far from the window drop theirs');
  // A cover whose thumbnail was dropped before Albums opened is read again when Albums shows it.
  context.keepCovers([context.captures[1]]);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(reads.at(-1), ['m:external_primary:i:1']);
  assert.equal(context.captures[1].image, 'read m:external_primary:i:1');
});
