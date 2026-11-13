// Partial source-contract regression: authenticated extracted production members execute
// with controlled ports; this is not whole-file implementation refinement.
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {appInfoPlatform, appInfoSource, launcherPath, pluginCallSource} from './app-info-handoff-platform.mjs';
import {directory, javaTraces, root} from './java.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {prepareNativeFixture} from '../../../../test/fixtures/native-source.mjs';
import {verifyNativePatchReceipt} from '../../../../scripts/prepare-patched-native.ts';
import {upstreamNativeSource} from '../../../../scripts/upstream-native-source.ts';

const model = 'NativeAppInfoHandoff';
const harness = 'AppInfoHandoffTraces.java';
const modulePath = 'plugins/plugin-native-system/android';

export async function withAppInfoSource(run, extraSources = []) {
  const temporary = mkdtempSync(join(tmpdir(), 'quint-native-app-info-'));
  try {
    const staged = prepareNativeFixture(root, temporary);
    const launcher = join(staged.root, launcherPath);
    const sourceReceipt = join(staged.root, '.source.json');
    const ports = appInfoPlatform(temporary, launcher);
    const generatedSources = [launcher, sourceReceipt, ...ports];
    const sources = [
      appInfoSource, pluginCallSource, 'vendor/eliza/' + launcherPath,
      'android/consumer-host.json', 'upstream.lock.json', 'android/upstream-native-sources.json',
      'test/fixtures/native-source.mjs', 'test/fixtures/jvm-tools.mjs',
      'scripts/prepare-patched-native.ts', 'scripts/upstream-native-source.ts',
      ...['Trace.java', 'java.mjs', 'app-info-handoff-platform.mjs'].map(name => join(directory, name)),
      fileURLToPath(import.meta.url), ...(jsonJar ? [jsonJar] : []), ...generatedSources, ...extraSources,
    ];
    const driverHashes = captureInputs(sources);
    const pinned = upstreamNativeSource(root).read(modulePath).get(launcherPath);
    const host = JSON.parse(readFileSync(join(root, 'android/consumer-host.json'), 'utf8'));
    assert.deepEqual(host.profile.modules.find(module => module.name === 'eliza-system'), {
      name:'eliza-system', source:{root:'patchedNative', path:modulePath}, relocateBuild:true,
    });
    verifyNativePatchReceipt(readFileSync(sourceReceipt, 'utf8'), staged);
    assert.equal(driverHashes[join(root, 'vendor/eliza', launcherPath)], pinned.sha256);
    assert.equal(driverHashes[launcher], staged.files[launcherPath]);
    return await run({sources, driverHashes, generatedSources, javaSources: [appInfoSource, ...ports]});
  } finally {
    rmSync(temporary, {recursive:true, force:true});
  }
}

export async function checkNativeAppInfoHandoff(extraSources = []) {
  return withAppInfoSource(async ({sources, driverHashes, generatedSources, javaSources}) => {
    const traces = javaTraces(harness, javaSources);
    const receipt = await checkTraces({
      model, sources, driverHashes, generatedSources, traces, scope: 'partial-source-contract', assumptions:[
        'The complete AlphaSystemPlugin compiles and openAppInfo runs with exact authenticated SystemLauncherApps validation and codes and the installed Capacitor getData/getString members.',
        'A synthetic installed package and two distinct launcher profiles exercise personal and exact-profile lookup. Disabled packages and paused and locked profiles are fixture inputs.',
        'Only closed ports receive intent and profile dispatch attempts. Each checkpoint represents one completed synchronous Capacitor request or a controlled environment change.',
      ],
    });
    return {receipt, obligations:[{
      model, obligation:'Installed App info dispatch and profile acceptance',
      reason:'Real package visibility, Binder replies, Android Settings resolution and cross-profile task placement remain Android platform behavior.',
    }]};
  }, [join(directory, harness), ...extraSources]);
}
