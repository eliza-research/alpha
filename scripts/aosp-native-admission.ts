import path from 'node:path';
import {execFileSync} from 'node:child_process';
import type {LauncherDescriptor} from '../vendor/eliza/packages/os/scripts/android/stage-launcher-overlay.ts';

/** The caller has already admitted the APK and descriptor together. Shared native staging
 * renders its exact expected blueprint from that descriptor, never from mutable output. */
export function alphaNativeOptions({root, output, apk, moduleName, launcher, target = 'stallion'}: {
 root: string; output: string; apk: string; moduleName: string; launcher: LauncherDescriptor; target?: string;
}) {
 if (!launcher) throw Error('An admitted launcher descriptor is required for native staging');
 const resolvedApk = path.resolve(apk);
 const admission = JSON.parse(execFileSync('python3', [path.join(root, 'scripts/stage-aosp-native.py'),
  '--apk', resolvedApk, '--output', output, '--module', moduleName, '--target', target, '--admission-only'], {encoding:'utf8'}));
 return {apk:resolvedApk, output, moduleName, launcher, target, admission};
}
