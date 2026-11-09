import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {app,directory,javaTraceCampaign,root} from './java.mjs';
import {gmailBackgroundPlatform,gmailProduct,gmailShared,providerAdmission} from './gmail-background-platform.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {upstreamNativeSource} from '../../../../scripts/upstream-native-source.mjs';

const model='NativeGmailBackground';
const harness='GmailBackgroundTraces.java';
const nativeManifest='patches/eliza/native-manifest.json';
const hostPath='android/consumer-host.json';
const modulePath='plugins/plugin-native-notifications/android';
const scenarios=['continuation','retry','storage','resume-stale','rotation','stopped','reset',
  'withdraw-during-configure','withdraw-current','old-owner','remote-revoked-consume',
  'remote-revoked-release','uncertain','denied'];

export async function checkNativeGmailBackground(extraSources=[]) {
  const fixture=gmailBackgroundPlatform();
  try {
    const compiled=[...gmailProduct,...gmailShared.map(path=>'vendor/eliza/'+path)];
    const sources=[...compiled,'vendor/eliza/'+providerAdmission,app+'AlphaCredentialStore.java',
      hostPath,nativeManifest,'upstream.lock.json','scripts/upstream-native-source.mjs',
      'test/fixtures/jvm-tools.mjs',...(jsonJar?[jsonJar]:[]),...fixture.paths,...extraSources,
      ...[harness,'Trace.java','java.mjs','gmail-background-platform.mjs'].map(name=>join(directory,name)),
      fileURLToPath(import.meta.url)];
    const driverHashes=captureInputs(sources);
    const staged=JSON.parse(readFileSync(join(root,nativeManifest),'utf8'));
    const host=JSON.parse(readFileSync(join(root,hostPath),'utf8'));
    assert.deepEqual(host.profile.modules.find(item=>item.name==='eliza-notifications'),{
      name:'eliza-notifications',source:{root:'patchedNative',path:modulePath},relocateBuild:true,
    });
    const pinned=upstreamNativeSource(root);
    const inventory=pinned.read(modulePath);
    for(const path of [...gmailShared,providerAdmission]) {
      assert.ok(staged.patches.every(patch=>patch.targets.every(target=>target.path!==path)),`Mail fixture needs staged bytes for ${path}`);
      assert.equal(driverHashes[join(root,'vendor/eliza',path)],
        (inventory.get(path)??pinned.read(path).get(path)).sha256);
    }
    const traces=javaTraceCampaign(harness,[...compiled,...fixture.paths],scenarios.map(name=>[name]));
    const receipt=await checkTraces({model,sources,driverHashes,generatedSources:fixture.paths,traces,
      scope:'bounded-orchestration',assumptions:[
        'The app-owned AlphaGmailPlugin, GmailBackground, GmailDeliveryWorker and CloudDeployment run with pinned MailBackgroundDelivery and MailHistoryReconciliation. The exact native verified Cloud identity helper runs over synthetic responses.',
        'Every JVM URL open is intercepted and accepts only the exact constructed Cloud routes. No network request, socket, real credential or provider action is used. One held transport callback and two serial bridge instances exercise owner retirement and readback.',
        'Synthetic WorkManager records request generation, CONNECTED constraint, 15-minute UPDATE, KEEP catch-up and 30-second exponential backoff. WorkManager execution and platform notification delivery are external.',
        'One retained notification identity per active selection, selected decimal history boundaries and page continuations, closed storage outcomes before or after commit, and synthetic active-list evidence. Host credential replacement triggers the actual registered retirement closure before replacing the bytes.',
        'Tap capture enters the actual shared ledger directly with a synthetic opaque key. The actual product bridge resolves status/pending/consume/release. Android intent delivery and installed MailNoticePoster effects are outside the source replay.',
      ]});
    return {receipt,obligations:[
      {model,obligation:'WorkManager and notification effects on Android',reason:'Command recording, stop state, synthetic alert visibility and active-list evidence are controlled. Device timing, reboot, WorkManager deduplication, PendingIntent routing and native notification permission enforcement require installed-platform evidence.'},
      {model,obligation:'Cloud identity, cursor transport and complete mailbox bounds',reason:'The fixture verifies fixed routes and exact cursor continuation against synthetic response bodies. Live owner/grant authority, provider freshness and arbitrary event capacity are separate.'},
    ]};
  } finally {fixture.close();}
}
