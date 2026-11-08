import test from 'node:test';
import assert from 'node:assert/strict';
import {cuttlefishOptions} from '../scripts/aosp-cuttlefish.mjs';

test('explicit Cuttlefish target requires source and cannot consume Pixel factory authority', () => {
  assert.equal(cuttlefishOptions({target:'cuttlefish', source:'/reviewed/aosp'}), true);
  assert.throws(() => cuttlefishOptions({target:'cuttlefish'}), /aosp-source/);
  assert.throws(() => cuttlefishOptions({target:'cuttlefish', source:'/reviewed/aosp', factory:'/pixel.zip'}), /pixel10a/);
  assert.equal(cuttlefishOptions({target:'pixel10a', source:'/reviewed/aosp', factory:'/pixel.zip'}), false);
  assert.equal(cuttlefishOptions({}), false);
});

test('Cuttlefish staging admits exactly the reviewed Android 17 source overrides', async t => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const {createHash} = await import('node:crypto');
  const {reviewedSourceOverrides} = await import('../scripts/stage-aosp.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-overrides-')); t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const lockPath = path.join(dir, 'lock.json'); const overrides = [{path:'frameworks/base/tools/aapt2/Android.bp', sha256:'a'.repeat(64), sizeBytes:1}];
  fs.writeFileSync(lockPath, JSON.stringify({overrides}));
  assert.deepEqual(reviewedSourceOverrides({cuttlefish:true, lockPath}), overrides);
  assert.deepEqual(reviewedSourceOverrides({lockPath}), []);
  const sourceLockSha256 = createHash('sha256').update(fs.readFileSync(lockPath)).digest('hex');
  assert.deepEqual(reviewedSourceOverrides({physicalSource:{sourceLockSha256}, lockPath}), overrides);
  assert.throws(() => reviewedSourceOverrides({physicalSource:{sourceLockSha256:'0'.repeat(64)}, lockPath}), /source lock changed/);
});


test('image staging admits named SystemUI patches only through the exact Pixel source verifier', async () => {
  const {stagingSystemuiPatches} = await import('../scripts/stage-aosp.mjs');
  assert.deepEqual(stagingSystemuiPatches([], false), []);
  assert.throws(() => stagingSystemuiPatches(['chip'], false), /requires --target pixel10a/);
  assert.throws(() => stagingSystemuiPatches(['chip', 'chip'], true), /Duplicate/);
  assert.throws(() => stagingSystemuiPatches(['unknown'], true), /Unknown SystemUI bundle/);
  const patches = stagingSystemuiPatches(['chip'], true);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].name, 'listener-systemui-chip');
  assert.equal(patches[0].manifest.baselineLockSha256.length, 64);
});
