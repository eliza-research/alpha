import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {verifyDeviceSource} from '../vendor/eliza/packages/os/scripts/android/verify-device-source.mjs';
import {soongAppNativePatch} from '../vendor/eliza/packages/os/scripts/android/soong-app-native.mjs';
import {loadProfile, verifyProfileSource} from '../vendor/eliza/packages/os/scripts/android/verify-source-lock.ts';

export const defaultLockPath = fileURLToPath(new URL('../vendor/eliza/packages/os/android/sources/pixel10a-stallion.json', import.meta.url));
const profileLockPath = fileURLToPath(new URL('../vendor/eliza/packages/os/android/aosp.lock.json', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Alpha adapter for upstream's shared Pixel 10a source admission. Fixture locks may
 * be supplied explicitly; production defaults authenticate the shared profile and inventory. */
export async function verifyPixel10aSource({source, factory, lock = defaultLockPath, appliedPatches = []}) {
  if (!source || !factory) throw Error('Pixel 10a staging requires --aosp-source and --factory-image');
  if (path.resolve(lock) === defaultLockPath) {
    return verifyProfileSource(loadProfile('pixel10a', profileLockPath), {
      aospRoot: source, archivePath: factory, lockPath: profileLockPath, appliedPatches,
    });
  }
  return verifyDeviceSource({source, factory, lock, appliedPatches,
    expected: {target:'pixel10a', codename:'stallion', androidRelease:'17'}});
}

/** A reviewed SystemUI bundle ('ops', 'chip' or 'assist') in the form verifyPixel10aSource accepts. */
export {senseSystemuiPatch as listenerSystemuiPatch} from '../vendor/eliza/packages/os/scripts/android/sense-systemui.mjs';

/** Explicit host-build patches; defaults and device source remain unchanged. */
export function aospBuildPatch(bundle) {
  if (bundle === 'soong-app-native') return soongAppNativePatch();
  if (bundle !== 'soong-memory') throw Error(`Unknown AOSP build patch: ${bundle}`);
  const directory = fileURLToPath(new URL('../android/aosp/build-host/', import.meta.url));
  const bytes = fs.readFileSync(path.join(directory, 'manifest.json')), manifest = JSON.parse(bytes);
  if (digest(fs.readFileSync(path.join(directory, manifest.patch))) !== manifest.patchSha256) throw Error(`AOSP build patch ${bundle} hash mismatch`);
  return {name:bundle, manifest, manifestSha256:digest(bytes)};
}
