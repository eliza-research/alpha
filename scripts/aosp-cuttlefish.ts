import fs from 'node:fs';
import path from 'node:path';
import {stageAndroidNative, finalizeAndroidNative} from '../vendor/eliza/packages/os/scripts/android/android-native-admission.mjs';
import type {LauncherDescriptor} from '../vendor/eliza/packages/os/scripts/android/stage-launcher-overlay.ts';
import {alphaNativeOptions} from './aosp-native-admission.ts';

// Cuttlefish is an explicit x86_64 image target; a fat APK never selects the ABI.
export function cuttlefishOptions({target, source, factory}: {target: string | null; source: string | null; factory: string | null}) {
  if (target !== 'cuttlefish') return false;
  if (!source) throw Error('Cuttlefish staging requires --aosp-source');
  if (factory) throw Error('--factory-image belongs only to --target pixel10a');
  return true;
}

export function writeCuttlefishNatives({root, output, apk, module, launcher}: {root: string; output: string; apk: string; module: string; launcher: LauncherDescriptor}) {
  const options = alphaNativeOptions({root, output, apk, moduleName:module, launcher, target:'cuttlefish'});
  stageAndroidNative(options);
  finalizeAndroidNative(options);
  fs.appendFileSync(path.join(output, 'product.mk'),
    '\n# Admitted x86_64 resident JNI executable modes for the Cuttlefish image.\nTARGET_FS_CONFIG_GEN += vendor/alphaphone/config.fs\n');
}
