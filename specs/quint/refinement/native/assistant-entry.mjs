import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces,qmap} from '../check-traces.mjs';
import {app,directory,javaTraceCampaign,root} from './java.mjs';
import {assistantAgent,assistantEntryPlatform,assistantShared,senseFixtures,systemModule} from './assistant-entry-platform.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {upstreamNativeSource} from '../../../../scripts/upstream-native-source.ts';

const model='NativeAssistantEntry';
const harness='AssistantEntryTraces.java';
const capacitor='node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/';
const hostPath='android/consumer-host.json';
const patchManifest='patches/eliza/native-manifest.json';
const appSources=['AlphaAssistActivity','AlphaPowerVoiceActivity','AlphaQuickSettingsTile','MainActivity','RendererRecoveryBudget']
  .map(name=>app+name+'.java');
const sharedSources=assistantShared.map(path=>'vendor/eliza/'+path);
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
];

function mapSurfaces(observation) {
  observation['s.surfaces']=qmap(Object.entries(observation['s.surfaces']).map(([id,view])=>[Number(id),view]));
}

export async function checkNativeAssistantEntry(extraSources=[]) {
  const fixture=assistantEntryPlatform();
  try {
    const sources=[...appSources,assistantAgent,...sharedSources,senseFixtures,
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
    const bridge=readFileSync(join(root,capacitor,'BridgeActivity.java'),'utf8');
    const load=bridge.slice(bridge.indexOf('    protected void load()'),bridge.indexOf('    public void registerPlugin('));
    assert.match(load,/bridge = bridgeBuilder[^;]*\.create\(\);[\s\S]*this\.onNewIntent\(getIntent\(\)\);/);
    assert.match(bridge,/protected void onNewIntent\(Intent intent\)[\s\S]*this\.bridge\.onNewIntent\(intent\);/);
    const traces=javaTraceCampaign(harness,[...appSources,...sharedSources,...ports,...fixture.paths],scenarios);
    for(const trace of traces) {
      mapSurfaces(trace.expect);
      for(const step of trace.steps) mapSurfaces(step.expect);
    }
    const receipt=await checkTraces({model,sources,driverHashes,generatedSources:fixture.paths,traces,
      scope:'bounded-orchestration',assumptions:[
        'Actual Alpha assistant and Power Activity subclasses, MainActivity and tile compile with unmodified pinned SenseInvocation, SenseListenerClient and AssistantEntryTile. Exact AlphaLocalAgentPlugin PowerLaunchPin and two legacy readbacks are extracted with closed credential ports.',
        'Closed Capacitor BridgeActivity recreates the installed bridge assignment and virtual one-argument intent reentry. One adversarial schedule passes a copied object through the same hook. The API 35 port forwards the ComponentCaller overload to the one-argument override. Actual Android caller disclosure, signer enforcement, Activity delivery and lifecycle scheduling are external.',
        'Two Activity and bridge identities, one fixed renderer generation, exact and foreign binding classes, checked synthetic account/generation and mutation values, and selected elapsed-time boundaries. Host admission, exact bind/attach/release calls and foreground observations are controlled rather than running the whole Sense plugin.',
        'The Power PackageManager port supplies an exported/enabled permission-protected image component only where the scenario permits. No installed variant availability is established. No app process, capture, permission grant, device Settings or Android launch is performed.',
        'The tile port holds at most one platform unlock callback, models successful delivery and cancellation, and captures explicit launch requests. Android determines real callback delivery and accepts or rejects the requested launch.',
      ]});
    return {receipt,obligations:[
      {model,obligation:'Android authority and delivery of assistant entry',reason:'Closed ports do not prove OS caller disclosure, installed protected component availability, tile unlock/lifecycle delivery or Android task placement.'},
      {model,obligation:'Live Sense/renderer binding and capture',reason:'Host replay uses controlled lease, foreground and credential inputs and performs no audio capture. The exact bridge-load guard and public delivery replay are checked against installed Capacitor call ordering.'},
    ]};
  } finally {fixture.close();}
}
