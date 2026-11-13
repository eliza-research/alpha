// Partial source-contract regression: authenticated extracted production members execute
// with controlled ports; this is not whole-file implementation refinement.
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces, qmap, qset} from '../check-traces.mjs';
import {app, directory, javaTraceCampaign, root} from './java.mjs';
import {mmsPlatform} from './mms-dispatch-platform.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {prepareNativeFixture} from '../../../../test/fixtures/native-source.mjs';
import {upstreamNativeSource} from '../../../../scripts/upstream-native-source.ts';
import {verifyNativePatchReceipt} from '../../../../scripts/prepare-patched-native.ts';
import {materializeHistoricalSources} from '../../legacy/core/formal-source-inventory.mjs';

const model='NativeMmsDispatch';
const shared='plugins/plugin-native-messages/android/src/main/java/ai/eliza/plugins/messages/';
const extracted=['TelephonyPlugin','MmsStore','SmsProviderReader'];
const compiled=['SmsTelephony','SmsTelephonyConfiguration','SmsSendJournal','MmsPdu'];
const product=['AlphaTelephony','AlphaTelephonyPlugin','AlphaSmsSendReceiver'].map(name=>app+name+'.java');
const paths=[...extracted,...compiled].map(name=>shared+name+'.java');
const launcherManifest='android/app/src/launcher/AndroidManifest.xml';
const harness='MmsDispatchTraces.java';
const historicalInventory='specs/quint/refinement/native/mms-historical-sources.json';
const scenarios=[
  'mms-attachment-conflict','sms-first-mms-receives-sms','mms-first-sms-rejected','exact-review',
  'preflight-revalidates-reviewed-tuple','pruned-exact-review','pruned-conflicting-review','group-carrier-confirm',
  'preview-invalid-size-and-cancel','carrier-changed-after-review','sim-changed-after-review','begin-refusal-cleans-pdu',
  'part-refusal-cleans-outbox','radio-refusal-before-handoff','uncertain-radio-handoff','interrupted-durable-dispatch',
  'role-loss-before-callback','volatile-callback-evidence','committed-callback-refusal','boot-without-receipt',
];

async function campaign(scenarios, extraSources, check, {historicalProbe=false} = {}) {
  const temporary=realpathSync(mkdtempSync(join(tmpdir(),'quint-mms-dispatch-')));
  try {
    const staged=prepareNativeFixture(root,temporary);
    const history=historicalProbe?materializeHistoricalSources(root,paths.map(path=>'vendor/eliza/'+path),historicalInventory):null;
    const resolveSource=path=>history?history.resolveSource('vendor/eliza/'+path):join(staged.root,path);
    const read=name=>readFileSync(resolveSource(shared+name+'.java'),'utf8');
    const files=Object.entries(mmsPlatform(...extracted.map(read))).map(([path,contents])=>{
      const target=join(temporary,'driver',path);
      mkdirSync(dirname(target),{recursive:true});writeFileSync(target,contents);return target;
    });
    const receiptPath=join(staged.root,'.source.json');
    const generatedSources=[...paths.map(path=>join(staged.root,path)),receiptPath,...files,...(history?paths.map(path=>resolveSource(path)):[])];
    const sources=[...product,...paths.map(path=>'vendor/eliza/'+path),launcherManifest,'android/consumer-host.json',
      'android/upstream-native-sources.json','upstream.lock.json',
      'scripts/prepare-patched-native.ts','scripts/upstream-native-source.ts','test/fixtures/native-source.mjs','test/fixtures/jvm-tools.mjs',
      app+'AlphaImageCapability.java',join(directory,harness),join(directory,'Trace.java'),join(directory,'java.mjs'),
      join(directory,'sms-dispatch-platform.mjs'),join(directory,'mms-dispatch-platform.mjs'),fileURLToPath(import.meta.url),
      historicalInventory,'specs/quint/legacy/core/formal-source-inventory.mjs',
      ...(jsonJar?[jsonJar]:[]),...generatedSources,...(history?.sources??[]),...extraSources];
    const driverHashes=captureInputs(sources);
    verifyNativePatchReceipt(readFileSync(receiptPath,'utf8'),staged);
    const pinned=upstreamNativeSource(root).read(shared);
    for(const path of paths){
      assert.equal(driverHashes[join(root,'vendor/eliza',path)],pinned.get(path).sha256);
      assert.equal(driverHashes[join(staged.root,path)],staged.files[path]);
    }
    // The reviewed upstream source now includes the former local MMS repair.
    for(const path of paths)assert.equal(staged.files[path],pinned.get(path).sha256);
    const host=JSON.parse(readFileSync(join(root,'android/consumer-host.json'),'utf8'));
    assert.deepEqual(host.profile.modules.find(module=>module.name==='eliza-messages'),{
      name:'eliza-messages',source:{root:'patchedNative',path:'plugins/plugin-native-messages/android'},relocateBuild:true,
    });
    assert.match(readFileSync(join(root,launcherManifest),'utf8'),/<receiver\s+android:name="\.AlphaSmsSendReceiver"\s+android:exported="false"/);
    const complete=compiled.map(name=>resolveSource(shared+name+'.java'));
    let traces;
    try {traces=javaTraceCampaign(harness,[...product,...complete,...files],scenarios.map(name=>historicalProbe?[name,'historical']:[name]),'ai.eliza.plugins.messages.MmsDispatchTraces');}
    finally {assert.deepEqual(captureInputs(sources),driverHashes,'MMS inputs changed during replay');}
    for(const trace of traces)for(const {expect} of [trace,...trace.steps]){
      const events=expect['s.events'];
      expect['s.events']={listeners:qset(events.listeners),deliveries:qmap(events.deliveries)};
    }
    return await check({model,sources,driverHashes,generatedSources,traces});
  } finally {rmSync(temporary,{recursive:true,force:true});}
}

export function mmsSourceProbe(selected, options) {
  return campaign(selected,[],({traces})=>traces,options);
}

export function checkNativeMmsDispatch(extraSources=[]) {
  return campaign(scenarios,extraSources,async evidence=>{
    const receipt=await checkTraces({...evidence,scope: 'partial-source-contract',assumptions:[
      'Actual product wrapper, staged SMS/MMS core, extracted native review and outbox members, and exact JVM PDU codec.',
      'One installed ID shared by two reviews. Synthetic Android telephony, provider, preview, and credential storage ports. Temporary PDU custody uses real file operations.',
      'Both live bridge registrations and exact per-bridge operation-ID notification counts are observed. Process reconstruction replaces all old registrations; the immediate Handler port does not qualify arbitrary held UI-queue retirement races.',
    ]});
    return {receipt,obligations:[
      {model,obligation:'Installed MMS effect and callback authority',
        reason:'Installed provider/role checks, URI grants, Android delivery and carrier response remain platform obligations.'},
    ]};
  });
}
