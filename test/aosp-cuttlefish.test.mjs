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
