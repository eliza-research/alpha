import fs from 'node:fs';
import path from 'node:path';
import {sha256 as digest} from './sha256.ts';
import {fileURLToPath} from 'node:url';
import {verifyDeviceSource} from '../vendor/eliza/packages/os/scripts/android/verify-device-source.mjs';
import {soongAppNativePatch} from '../vendor/eliza/packages/os/scripts/android/soong-app-native.mjs';
import {loadProfile, verifyProfileSource} from '../vendor/eliza/packages/os/scripts/android/verify-source-lock.ts';

export const defaultLockPath = fileURLToPath(new URL('../vendor/eliza/packages/os/android/sources/pixel10a-stallion.json', import.meta.url));
const profileLockPath = fileURLToPath(new URL('../vendor/eliza/packages/os/android/aosp.lock.json', import.meta.url));

/** Alpha adapter for upstream's shared Pixel 10a source admission. Fixture locks may
 * be supplied explicitly; production defaults authenticate the shared profile and inventory. */
export interface ReviewedSourcePatch {
  name: string;
  manifest: unknown;
  manifestSha256: string;
}
interface Pixel10aSourceOptions {
  source?: string | null;
  factory?: string | null;
  lock?: string;
  appliedPatches?: ReviewedSourcePatch[];
}
export async function verifyPixel10aSource({source, factory, lock = defaultLockPath, appliedPatches = []}: Pixel10aSourceOptions) {
  if (!source || !factory) throw Error('Pixel 10a staging requires --aosp-source and --factory-image');
  if (path.resolve(lock) === defaultLockPath) {
    const verify = verifyProfileSource as (
      profile: ReturnType<typeof loadProfile>,
      options: {aospRoot: string; archivePath: string; lockPath: string; appliedPatches: ReviewedSourcePatch[]},
    ) => ReturnType<typeof verifyProfileSource>;
    return verify(loadProfile('pixel10a', profileLockPath), {
      aospRoot: source, archivePath: factory, lockPath: profileLockPath, appliedPatches,
    });
  }
  const verify = verifyDeviceSource as (
    options: {source: string; factory: string; lock: string; appliedPatches: ReviewedSourcePatch[];
      expected: {target: string; codename: string; androidRelease: string}},
  ) => ReturnType<typeof verifyDeviceSource>;
  return verify({source, factory, lock, appliedPatches,
    expected: {target:'pixel10a', codename:'stallion', androidRelease:'17'}});
}

/** A reviewed SystemUI bundle ('ops', 'chip' or 'assist') in the form verifyPixel10aSource accepts. */
export {senseSystemuiPatch as listenerSystemuiPatch} from '../vendor/eliza/packages/os/scripts/android/sense-systemui.mjs';

/** Alpha's protected Power route, independent of the optional SystemUI branding patch. */
export function alphaProtectedPowerPatch(): ReviewedSourcePatch {
  return readAlphaSourcePatch('alpha-protected-power', new URL('../android/aosp/branding/power-voice/', import.meta.url));
}

/** Explicit host-build patches; defaults and device source remain unchanged. */
export function aospBuildPatch(bundle: string): ReviewedSourcePatch {
  if (bundle === 'soong-app-native') return soongAppNativePatch();
  if (bundle === 'alpha-sense-policy') return readAlphaSourcePatch(bundle, new URL('../android/aosp/branding/sense-policy/', import.meta.url));
  if (bundle !== 'soong-memory') throw Error(`Unknown AOSP build patch: ${bundle}`);
  return readAlphaSourcePatch(bundle, new URL('../android/aosp/build-host/', import.meta.url));
}

function readAlphaSourcePatch(bundle: string, location: URL): ReviewedSourcePatch {
  const directory = fileURLToPath(location);
  const bytes = fs.readFileSync(path.join(directory, 'manifest.json')), manifest = JSON.parse(bytes.toString('utf8'));
  if (digest(fs.readFileSync(path.join(directory, manifest.patch))) !== manifest.patchSha256) throw Error(`AOSP patch ${bundle} hash mismatch`);
  return {name:bundle, manifest, manifestSha256:digest(bytes)};
}
