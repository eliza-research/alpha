import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

// Cuttlefish is an explicit x86_64 image target; a fat APK never selects the ABI.
export function cuttlefishOptions({target, source, factory}: {target: string | null; source: string | null; factory: string | null}) {
  if (target !== 'cuttlefish') return false;
  if (!source) throw Error('Cuttlefish staging requires --aosp-source');
  if (factory) throw Error('--factory-image belongs only to --target pixel10a');
  return true;
}

export function writeCuttlefishNatives({root, output, apk, module}: {root: string; output: string; apk: string; module: string}) {
  execFileSync('python3', [path.join(root, 'scripts/stage-aosp-native.py'), '--apk', path.resolve(apk),
    '--output', output, '--module', module, '--target', 'cuttlefish'], {stdio:'inherit'});
  fs.appendFileSync(path.join(output, 'product.mk'),
    '\n# Admitted x86_64 resident JNI executable modes for the Cuttlefish image.\nTARGET_FS_CONFIG_GEN += vendor/alphaphone/config.fs\n');
}
