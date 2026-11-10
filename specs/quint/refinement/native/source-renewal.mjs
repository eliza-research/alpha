import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces,qmap,qset} from '../check-traces.mjs';
import {app,directory,javaTraceCampaign,root} from './java.mjs';
import {renewalBridge,renewalOwner,sourceRenewalPlatform} from './source-renewal-platform.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {upstreamNativeSource} from '../../../../scripts/upstream-native-source.ts';

const model='NativeSourceRenewal';
const harness='SourceRenewalTraces.java';
const product=['SourceRenewalNotices','SourceRenewalHost','HostedNoticePoster','HostedResultNotices','PluginWorkers'].map(name=>app+name+'.java');
const scenarios=['two-taps-and-purpose','cross-source-exact-token','owner-switch','revision-exact-clear','unverifiable-retry',
  'revoked-after-reserve','post-write-refusal','post-final-write-report','post-admission-flip','failed-clear-and-withdraw','notification-refusal'];

export async function checkNativeSourceRenewal(extraSources=[]) {
  const temporary=mkdtempSync(join(tmpdir(),'quint-native-source-renewal-'));
  try {
    const ports=sourceRenewalPlatform(temporary);
    const core='vendor/eliza/'+renewalOwner;
    const nativeManifest='patches/eliza/native-manifest.json';
    const sources=[...product,core,renewalBridge,app+'NativeDigestHost.java',app+'NativeDigestSources.java',
      nativeManifest,'upstream.lock.json','scripts/upstream-native-source.ts','test/fixtures/jvm-tools.mjs',
      join(directory,harness),join(directory,'Trace.java'),join(directory,'java.mjs'),join(directory,'source-renewal-platform.mjs'),
      fileURLToPath(import.meta.url),...(jsonJar?[jsonJar]:[]),...ports,...extraSources];
    const driverHashes=captureInputs(sources);
    const manifest=JSON.parse(readFileSync(join(root,nativeManifest),'utf8'));
    assert.ok(manifest.modules.includes('plugins/plugin-native-notifications/android'));
    assert.ok(manifest.patches.every(patch=>patch.targets.every(target=>target.path!==renewalOwner)));
    const pinned=upstreamNativeSource(root).read(renewalOwner).get(renewalOwner);
    assert.equal(driverHashes[join(root,core)],pinned.sha256);
    const traces=javaTraceCampaign(harness,[...product,core,...ports],scenarios.map(name=>[name]));
    for(const trace of traces)for(const {expect} of [trace,...trace.steps]){
      expect['s.rows']=qmap(expect['s.rows']);
      expect['s.visible']=qset(expect['s.visible']);
      expect['s.routes']=qset(expect['s.routes']);
    }
    const receipt=await checkTraces({model,sources,driverHashes,generatedSources:ports,traces,scope:'bounded-orchestration',assumptions:[
      'Actual SourceRenewalNotices, SourceRenewalHost, HostedNoticePoster and selected renewal intent/pending/settle bridge members.',
      'Four exact synthetic owner/revision/source bindings. Runtime token UUIDs are projected by observed durable equality classes.',
      'Credential-slot reports, resident describe replies, Android notification manager, and PendingIntent identity are closed ports. The actual builder creates only synthetic alerts.',
      'The handoff replays a copied intent identity without launching an Android Activity. WorkManager scheduling and provider reads remain external.',
    ]});
    return {receipt,obligations:[
      {model,obligation:'Installed notification and scheduling effects',
        reason:'Host replay does not establish WorkManager latency, Android grant or PendingIntent enforcement, platform timeout/auto-dismiss, or resident provider access.'},
      {model,obligation:'Cancellation versus failed journal save',
        reason:'Clear and owner withdrawal can cancel the platform alert and routes before a journal save reports failure.'},
    ]};
  } finally {rmSync(temporary,{recursive:true,force:true});}
}
