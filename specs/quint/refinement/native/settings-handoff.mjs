import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {app,directory,javaTraceCampaign,root} from './java.mjs';
import {settingsCallSource,settingsDeviceSource,settingsHandoffPlatform,settingsPagesPath} from './settings-handoff-platform.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {prepareNativeFixture} from '../../../../test/fixtures/native-source.mjs';
import {verifyNativePatchReceipt} from '../../../../scripts/prepare-patched-native.ts';
import {upstreamNativeSource} from '../../../../scripts/upstream-native-source.ts';

const model='NativeSettingsHandoff';
const harness='SettingsHandoffTraces.java';
const modulePath='plugins/plugin-native-system/android';
const provider=app+'PasswordProviderSupport.java';
const scenarios=['all-pages-launcher','all-pages-standalone','fallback-launcher','fallback-standalone',
  'invalid','absent-host','retired-host-launcher','provider-launcher','provider-standalone'];

export async function checkNativeSettingsHandoff(extraSources=[]) {
  const temporary=mkdtempSync(join(tmpdir(),'quint-native-settings-handoff-'));
  try {
    const staged=prepareNativeFixture(root,temporary);
    const core=join(staged.root,settingsPagesPath);
    const sourceReceipt=join(staged.root,'.source.json');
    const ports=settingsHandoffPlatform(temporary);
    const generatedSources=[core,sourceReceipt,...ports];
    const sources=[provider,settingsDeviceSource,settingsCallSource,'vendor/eliza/'+settingsPagesPath,
      ...['Plugin.java','Bridge.java','BridgeActivity.java'].map(name=>join(dirname(settingsCallSource),name)),
      'android/consumer-host.json','upstream.lock.json','android/upstream-native-sources.json',
      'test/fixtures/native-source.mjs','test/fixtures/jvm-tools.mjs',
      'scripts/prepare-patched-native.ts','scripts/upstream-native-source.ts',
      join(directory,harness),join(directory,'Trace.java'),join(directory,'java.mjs'),join(directory,'settings-handoff-platform.mjs'),
      fileURLToPath(import.meta.url),...(jsonJar?[jsonJar]:[]),...generatedSources,...extraSources];
    const driverHashes=captureInputs(sources);
    const pinned=upstreamNativeSource(root).read(modulePath).get(settingsPagesPath);
    const host=JSON.parse(readFileSync(join(root,'android/consumer-host.json'),'utf8'));
    assert.deepEqual(host.profile.modules.find(module=>module.name==='eliza-system'),{
      name:'eliza-system',source:{root:'patchedNative',path:modulePath},relocateBuild:true,
    });
    verifyNativePatchReceipt(readFileSync(sourceReceipt,'utf8'),staged);
    assert.equal(driverHashes[join(root,'vendor/eliza',settingsPagesPath)],pinned.sha256);
    assert.equal(driverHashes[core],staged.files[settingsPagesPath]);
    const traces=javaTraceCampaign(harness,[provider,core,...ports],scenarios.map(name=>[name]));
    const receipt=await checkTraces({model,sources,driverHashes,generatedSources,traces,scope:'bounded-orchestration',assumptions:[
      'Exact AlphaDevicePlugin members and PasswordProviderSupport plus the authenticated installed SystemSettingsPages source.',
      'Android Settings constants are distinct closed-port symbols. Explicit string actions, package URIs, package extra, flags, attempts and native result fields are observed.',
      'A single pending request per trace position. Synthetic Activity outcomes execute no installed settings, provider, permission or external launch.',
      'Absent and retired Activity outcomes describe controlled ports. The installed Capacitor BridgeActivity binds its constructor Activity to a final Bridge context.',
    ]});
    return {receipt,obligations:[
      {model,obligation:'Android Activity acceptance and external Settings behavior',
        reason:'Host replay checks requested intents and reply classification. Android package visibility, dispatch, task placement, Settings UI and permission changes are external.'},
    ]};
  } finally {rmSync(temporary,{recursive:true,force:true});}
}
