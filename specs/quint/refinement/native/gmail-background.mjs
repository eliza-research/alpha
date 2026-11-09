import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {app,directory,javaTraceCampaign,root} from './java.mjs';
import {gmailBackgroundPlatform,gmailProduct,gmailShared,providerAdmission} from './gmail-background-platform.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {upstreamNativeSource} from '../../../../scripts/upstream-native-source.mjs';
import {verifyNativePatchReceipt} from '../../../../scripts/prepare-patched-native.mjs';
import {prepareNativeFixture} from '../../../../test/fixtures/native-source.mjs';

const model='NativeGmailBackground';
const harness='GmailBackgroundTraces.java';
const nativeManifest='android/upstream-native-sources.json';
const hostPath='android/consumer-host.json';
const modulePath='plugins/plugin-native-notifications/android';
const capacitor='node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/';
const scenarios=['continuation','retry','storage','resume-stale','rotation', 'stopped','reset','enqueue-refusal','enqueue-refusal-worker','enqueue-refusal-newer',
  'enqueue-refusal-newer-same','enqueue-refusal-newer-settled',
  'withdraw-during-configure','withdraw-queued','withdraw-queued-other','withdraw-current','withdraw-unrelated','withdraw-empty-other',
  'withdraw-empty-exact','withdraw-global','old-owner','remote-revoked-consume','remote-revoked-release',
  'offline-tap','consume-retoken','consume-locked','consume-owner-retired','uncertain','denied'];

export async function checkNativeGmailBackground(extraSources=[]) {
  const fixture=gmailBackgroundPlatform();
  const temporary=mkdtempSync(join(tmpdir(),'quint-gmail-staged-'));
  try {
    const staged=prepareNativeFixture(root,temporary);
    const stagedReceipt=join(staged.root,'.source.json');
    const stagedSources=gmailShared.map(path=>join(staged.root,path));
    const generatedSources=[...fixture.paths,...stagedSources,stagedReceipt];
    const compiled=[...gmailProduct,...stagedSources];
    const sources=[...compiled,...gmailShared.map(path=>'vendor/eliza/'+path),'vendor/eliza/'+providerAdmission,app+'AlphaCredentialStore.java',
      hostPath,nativeManifest,'upstream.lock.json','scripts/upstream-native-source.mjs',
      capacitor+'Bridge.java',capacitor+'BridgeActivity.java',
      'scripts/prepare-patched-native.mjs','test/fixtures/native-source.mjs',
      'test/fixtures/jvm-tools.mjs',...(jsonJar?[jsonJar]:[]),...generatedSources,...extraSources,
      ...[harness,'Trace.java','java.mjs','gmail-background-platform.mjs'].map(name=>join(directory,name)),
      fileURLToPath(import.meta.url)];
    const driverHashes=captureInputs(sources);
    const bridge=readFileSync(join(root,capacitor,'Bridge.java'),'utf8');
    assert.match(bridge,/HandlerThread\("CapacitorPlugins"\)/);
    assert.match(bridge,/taskHandler\.post\(currentThreadTask\)/);
    assert.match(readFileSync(join(root,capacitor,'BridgeActivity.java'),'utf8'),/public void onDestroy\(\)[\s\S]*bridge\.onDestroy\(\)/);
    const host=JSON.parse(readFileSync(join(root,hostPath),'utf8'));
    assert.deepEqual(host.profile.modules.find(item=>item.name==='eliza-notifications'),{
      name:'eliza-notifications',source:{root:'patchedNative',path:modulePath},relocateBuild:true,
    });
    const pinned=upstreamNativeSource(root);
    const inventory=pinned.read(modulePath);
    verifyNativePatchReceipt(readFileSync(stagedReceipt,'utf8'),staged);
    for(const path of [...gmailShared,providerAdmission]) {
      const digest=(inventory.get(path)??pinned.read(path).get(path)).sha256;
      assert.equal(driverHashes[join(root,'vendor/eliza',path)],digest);
      if(gmailShared.includes(path)) {
        assert.equal(staged.files[path],digest);
        assert.equal(driverHashes[join(staged.root,path)],digest);
      }
    }
    const traces=javaTraceCampaign(harness,[...compiled,...fixture.paths],scenarios.map(name=>[name]));
    const receipt=await checkTraces({model,sources,driverHashes,generatedSources,traces,
      scope:'bounded-orchestration',assumptions:[
        'The app-owned AlphaGmailPlugin, GmailBackground, GmailDeliveryWorker and CloudDeployment run with authenticated staged MailBackgroundDelivery and MailHistoryReconciliation. The exact native verified Cloud identity helper runs over synthetic responses.',
        'Every JVM URL open is intercepted and accepts only the exact constructed Cloud routes. No network request, socket, real credential or provider action is used. One held transport callback and two serial bridge instances exercise owner retirement and readback.',
        'The exact Activity/bridge teardown calls shut the real product executor in one schedule. A second schedule delays execute on a forwarding port backed by the real executor, then lets a later selection reach admission before delivering the older rejection. Accepted worker draining is outside this refusal boundary.',
        'Synthetic WorkManager records request generation, CONNECTED constraint, 15-minute UPDATE, KEEP catch-up and 30-second exponential backoff. WorkManager execution and platform notification delivery are external.',
        'One retained notification identity per active selection, selected decimal history boundaries and page continuations, closed storage outcomes before or after commit, and synthetic active-list evidence. Host credential replacement triggers the actual registered retirement closure before replacing the bytes.',
        'Tap capture enters the actual shared ledger directly with a synthetic opaque key. The actual product bridge resolves status/pending/consume/release. Android intent delivery and installed MailNoticePoster effects are outside the source replay.',
      ]});
    return {receipt,obligations:[
      {model,obligation:'WorkManager and notification effects on Android',reason:'Command recording, stop state, synthetic alert visibility and active-list evidence are controlled. Device timing, reboot, WorkManager deduplication, PendingIntent routing and native notification permission enforcement require installed-platform evidence.'},
      {model,obligation:'Cloud identity, cursor transport and complete mailbox bounds',reason:'The fixture verifies fixed routes and exact cursor continuation against synthetic response bodies. Live owner/grant authority, provider freshness and arbitrary event capacity are separate.'},
    ]};
  } finally {fixture.close();rmSync(temporary,{recursive:true,force:true});}
}
