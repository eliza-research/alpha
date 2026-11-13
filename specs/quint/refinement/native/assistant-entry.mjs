// Partial source-contract regression: authenticated extracted production members execute
// with controlled ports; this is not whole-file implementation refinement.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces,qmap} from '../check-traces.mjs';
import {app,directory,javaTraceCampaign,root} from './java.mjs';
import {assistantAgent,assistantNavigation,assistantEntryPlatform,assistantShared,senseFixtures,systemModule,imageModule,imageCapabilitySource,imageAdmissionSource} from './assistant-entry-platform.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {upstreamNativeSource} from '../../../../scripts/upstream-native-source.ts';

const model='NativeAssistantEntry';
const harness='AssistantEntryTraces.java';
const capacitor='node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/';
const hostPath='android/consumer-host.json';
const patchManifest='android/upstream-native-sources.json';
const appSources=['AlphaAssistActivity','AlphaPowerVoiceActivity','AlphaQuickSettingsTile','MainActivity','RendererRecoveryBudget','NavigationOpenRequest','AlphaSenseAdmission','AlphaImageCapabilities']
  .map(name=>app+name+'.java');
const sharedSources=[...assistantShared.map(path=>'vendor/eliza/'+path),imageCapabilitySource];
const ports=[join(directory,'MainActivityPorts.java')];
const scenarios=[
  ...['cold-listener','cold-system','cold-exact-deadline','cold-expired','cold-rebound','cold-locked',
    'public-same-object','copy-during-load','restored-and-warm','cold-no-bridge','locked-warm',
    'power-exact','power-focus','power-pause','power-destroy','power-expired','power-wrong-account',
    'power-replaced-account','power-replaced-epoch','power-mic-revoked','power-restored','power-locked',
    'power-unprotected','stale-power'].map(name=>[name,'36']),
  ...['no-mic','stopping','mutation','shutdown','unavailable','nonproduction'].map(reason=>['power-denied-'+reason,'36']),
  ...[33,34].map(sdk=>['legacy-caller',String(sdk)]),
  ...[33,34,36].map(sdk=>['tile',String(sdk)]),
  ...['cold-listener-rebound','listener-uid-mismatch','listener-independent-platform',
    'system-independent-listener','stale-power-listener'].map(name=>[name,'36']),
  ...[33,34,36].flatMap(sdk=>['none','listener','foreign','system-uid-mismatch','system']
    .map(caller=>['cold-power-caller-'+caller,String(sdk)])),
  ...[33,34,36].map(sdk=>['warm-power-caller',String(sdk)]),
  ...['launcher','debug','mocks','host-system','provisioned','feature','enabled',
    'companion-system','companion-path','hotword','control'].map(fact=>['image-denied-'+fact,'36']),
];

function mapSurfaces(observation) {
  observation['s.surfaces']=qmap(Object.entries(observation['s.surfaces']).map(([id,view])=>[Number(id),view]));
}

export async function checkNativeAssistantEntry(extraSources=[]) {
  const fixture=assistantEntryPlatform();
  try {
    const sources=[...appSources,imageAdmissionSource,assistantAgent,assistantNavigation,...sharedSources,senseFixtures,
      'android/app/src/main/AndroidManifest.xml',hostPath,patchManifest,'upstream.lock.json',
      capacitor+'BridgeActivity.java',capacitor+'Bridge.java','scripts/upstream-native-source.ts',
      'test/fixtures/jvm-tools.mjs',...(jsonJar?[jsonJar]:[]),...ports,
      ...[harness,'Trace.java','java.mjs','main-activity-platform.mjs','assistant-entry-platform.mjs']
        .map(name=>join(directory,name)),
      fileURLToPath(import.meta.url),...fixture.paths,...extraSources];
    const driverHashes=captureInputs(sources);
    const host=JSON.parse(readFileSync(join(root,hostPath),'utf8'));
    assert.deepEqual(host.profile.modules.find(module=>module.name==='eliza-system'),{
      name:'eliza-system',source:{root:'patchedNative',path:systemModule},relocateBuild:true,
    });
    const patches=JSON.parse(readFileSync(join(root,patchManifest),'utf8')).patches;
    const pinned=upstreamNativeSource(root).read(systemModule);
    for(const path of assistantShared) {
      assert.ok(patches.every(patch=>patch.targets.every(target=>target.path!==path)),`Assistant input has a staged patch: ${path}`);
      assert.equal(driverHashes[join(root,'vendor/eliza',path)],pinned.get(path).sha256);
    }
    const imagePinned=upstreamNativeSource(root).read(imageModule);
    for(const source of [imageCapabilitySource,imageAdmissionSource]) {
      const path=source.slice('vendor/eliza/'.length);
      assert.ok(patches.every(patch=>patch.targets.every(target=>target.path!==path)),`Image input has a staged patch: ${path}`);
      assert.equal(driverHashes[join(root,source)],imagePinned.get(path).sha256);
    }
    const traces=javaTraceCampaign(harness,[...appSources,...sharedSources,...ports,...fixture.paths],scenarios);
    for(const trace of traces) {
      mapSurfaces(trace.expect);
      for(const step of trace.steps) mapSurfaces(step.expect);
    }
    const receipt=await checkTraces({model,sources,driverHashes,generatedSources:fixture.paths,traces,
      scope: 'bounded-orchestration',assumptions:[
        'Actual AlphaSenseAdmission, AlphaImageCapabilities, pinned ImageCapability, assistant and Power Activity subclasses, MainActivity and tile compile with unmodified pinned SenseInvocation, SenseListenerClient and AssistantEntryTile. Exact AlphaLocalAgentPlugin PowerLaunchPin and two legacy readbacks are extracted with closed credential ports.',
        'A controlled Capacitor BridgeActivity supplies bridge assignment and virtual one-argument intent reentry. One adversarial schedule passes a copied object through the same hook. The API 35 port forwards the ComponentCaller overload to the one-argument override. Installed Capacitor bridge-load ordering, Android caller disclosure, signer enforcement, Activity delivery and lifecycle scheduling are external.',
        'Two Activity and bridge identities, one fixed renderer generation, exact and foreign binding classes, checked synthetic account/generation and mutation values, and selected elapsed-time boundaries. Host admission, exact bind/attach/release calls and foreground observations are controlled rather than running the whole Sense plugin.',
        'The image ports expose explicit launcher/debug/test-mocks, provisioning resource and system-install facts; companion feature, source path, system/enabled flags, hotword/control grants and current signer/UID facts. Actual Alpha and pinned shared image admission execute over these facts. Only the exact pinned nominal SmsTelephonyConfiguration.Admission interface is extracted. No image availability is inferred from a caller label.',
        'The Power PackageManager port supplies an exported/enabled permission-protected image component only where the scenario permits. No installed variant availability is established. No app process, capture, permission grant, device Settings or Android launch is performed.',
        'The tile port holds at most one platform unlock callback, models successful delivery and cancellation, and captures explicit launch requests. Android determines real callback delivery and accepts or rejects the requested launch.',
      ]});
    return {receipt,obligations:[
      {model,obligation:'Android authority and delivery of assistant entry',reason:'Closed ports do not prove OS caller disclosure, installed protected component availability, tile unlock/lifecycle delivery or Android task placement.'},
      {model,obligation:'Live Sense/renderer binding and capture',reason:'Host replay uses controlled lease, foreground and credential inputs and performs no audio capture. The port supplies ordinary intent forwarding; installed Capacitor bridge-load and delivery order remain external.'},
    ]};
  } finally {fixture.close();}
}
