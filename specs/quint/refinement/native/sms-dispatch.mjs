// Partial source-contract regression: authenticated extracted production members execute
// with controlled ports; this is not whole-file implementation refinement.
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces, qmap, qset} from '../check-traces.mjs';
import {app, directory, javaTraceCampaign, root} from './java.mjs';
import {smsMembers, smsPlatform} from './sms-dispatch-platform.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {prepareNativeFixture} from '../../../../test/fixtures/native-source.mjs';
import {upstreamNativeSource} from '../../../../scripts/upstream-native-source.ts';
import {verifyNativePatchReceipt} from '../../../../scripts/prepare-patched-native.ts';
import {materializeHistoricalSources} from '../../legacy/core/formal-source-inventory.mjs';

const model='NativeSmsDispatch';
const modulePath='plugins/plugin-native-messages/android';
const shared=modulePath+'/src/main/java/ai/eliza/plugins/messages/';
const members=['TelephonyPlugin','MmsStore','SmsProviderReader'];
const compiled=['SmsTelephony','SmsTelephonyConfiguration','SmsSendJournal'];
const product=['AlphaTelephony','AlphaTelephonyPlugin','AlphaSmsSendReceiver'].map(name=>app+name+'.java');
const paths=[...members,...compiled].map(name=>shared+name+'.java');
const launcherManifest='android/app/src/launcher/AndroidManifest.xml';
const patchManifest='android/upstream-native-sources.json';
const harness='SmsDispatchTraces.java';
const historicalInventory='specs/quint/refinement/native/mms-historical-sources.json';

function driverInputs(temporary, sourceRoot, resolveSource=path=>join(sourceRoot,path)) {
  const generated={...smsPlatform,...smsMembers(...members.map(name=>readFileSync(resolveSource(shared+name+'.java'),'utf8')))};
  const files=Object.entries(generated).map(([path,contents])=>{
    const file=join(temporary,'driver',path);
    mkdirSync(dirname(file),{recursive:true});
    writeFileSync(file,contents);
    return file;
  });
  return {files,complete:compiled.map(name=>resolveSource(shared+name+'.java'))};
}

function runScenarios(scenarios, {files,complete}, historical=false) {
  return javaTraceCampaign(harness,[...product,...complete,...files],scenarios.map(mode=>historical?[mode,'historical']:[mode]),'ai.eliza.plugins.messages.SmsDispatchTraces');
}

/** Reproduce only the historical raw-pin regression with authenticated immutable bytes. */
export function historicalSmsSourceTraces(scenarios) {
  const temporary=mkdtempSync(join(tmpdir(),'quint-sms-dispatch-'));
  try {
    const history=materializeHistoricalSources(root,paths.map(path=>'vendor/eliza/'+path),historicalInventory);
    const hashes=captureInputs(history.sources);
    try {return runScenarios(scenarios,driverInputs(temporary,null,path=>history.resolveSource('vendor/eliza/'+path)),true);}
    finally {assert.deepEqual(captureInputs(history.sources),hashes,'Historical SMS inputs changed during replay');}
  }
  finally {rmSync(temporary,{recursive:true,force:true});}
}

export async function checkNativeSmsDispatch(extraSources = []) {
  const temporary=mkdtempSync(join(tmpdir(),'quint-sms-dispatch-'));
  try {
    const prepared=prepareNativeFixture(root,temporary);
    const nativeReceipt=join(prepared.root,'.source.json');
    const inputs=driverInputs(temporary,prepared.root);
    const generatedSources=[...paths.map(path=>join(prepared.root,path)),nativeReceipt,...inputs.files];
    const sources=[...product,...paths.map(path=>'vendor/eliza/'+path),launcherManifest,'android/consumer-host.json',
      patchManifest,app+'AlphaImageCapability.java',join(directory,harness),join(directory,'Trace.java'),
      join(directory,'java.mjs'),join(directory,'sms-dispatch-platform.mjs'),fileURLToPath(import.meta.url),
      'test/fixtures/jvm-tools.mjs','test/fixtures/native-source.mjs','upstream.lock.json','scripts/upstream-native-source.ts',
      'scripts/prepare-patched-native.ts',historicalInventory,'specs/quint/legacy/core/formal-source-inventory.mjs',
      ...(jsonJar?[jsonJar]:[]),...generatedSources,...extraSources];
    const driverHashes=captureInputs(sources);
    assert.match(readFileSync(join(root,launcherManifest),'utf8'),/<receiver\s+android:name="\.AlphaSmsSendReceiver"\s+android:exported="false"/);
    const host=JSON.parse(readFileSync(join(root,'android/consumer-host.json'),'utf8'));
    assert.deepEqual(host.profile.modules.find(module=>module.name==='eliza-messages'),{
      name:'eliza-messages',source:{root:'patchedNative',path:modulePath},relocateBuild:true,
    });
    verifyNativePatchReceipt(readFileSync(nativeReceipt,'utf8'),prepared);
    const pinned=upstreamNativeSource(root).read(shared);
    for(const path of paths){
      assert.equal(driverHashes[join(root,'vendor/eliza',path)],pinned.get(path).sha256);
      assert.equal(driverHashes[join(prepared.root,path)],prepared.files[path]);
    }
    // The current reviewed upstream pin includes the former local SMS repair.
    for(const path of paths)assert.equal(prepared.files[path],pinned.get(path).sha256);
    const traces=runScenarios([
      'cross-dialog-binding','exact-dialog-replay','pruned-exact-dialog','pruned-conflicting-dialog',
      'exact-cancel-and-retired-button','empty-parts-retains-denied','background-cancellation','screen-off-cancellation','initial-permission-denied',
      'carrier-replaced-before-approval','per-recipient-sim-change','partial-radio-throw','radio-refused-before-acceptance',
      'begin-save-before-refusal','begin-commit-then-failed-report','end-write-failure-and-process-recovery',
      'end-committed-before-failure-report','callback-evidence-is-volatile-before-save','callback-evidence-durable-before-failure-report',
      'immutable-receiver-and-newest-listener','boot-retirement-of-missing-receipts','provider-readback-requires-unique-row-and-report',
      'multipart-provider-cannot-prove-delivery','expired-provider-attribution','default-role-outbox','provider-insert-refused','retired-role-outbox',
    ],inputs);
    for(const trace of traces)for(const {expect} of [trace,...trace.steps]){
      for(const field of ['foreground','closed','listeners','outbox','sentRows','failedRows'])expect['s.'+field]=qset(expect['s.'+field]);
      expect['s.reviews']=qmap(expect['s.reviews']);
      expect['s.events']=qmap(expect['s.events']);
      for(const view of ['memory','disk'])for(const field of ['sent','failed','reported','delivered','deliveryFailed','rows'])
        expect['s.'+view][field]=qset(expect['s.'+view][field]);
    }
    const receipt=await checkTraces({model,sources,driverHashes,generatedSources,traces,scope: 'partial-source-contract',assumptions:[
      'The exact product telephony plugin and receiver use the authenticated staged SMS dispatch/journal and extracted exact review and provider members.',
      'Synthetic radio, provider, dialog, Android image/permissions and encrypted-slot ports execute no device or real SMS operations.',
      'Exact registered identities and per-bridge opaque operation-ID notifications are observed. The synthetic Handler runs posted work immediately within each macrostep; arbitrary held UI-queue retirement races remain separate.',
    ]});
    return {receipt,obligations:[
      {model,obligation:'Installed AOSP and carrier authority',
        reason:'The JVM controls OS admission, telephony, PendingIntent and provider effects. Installed carrier/role/delivery semantics and arbitrary Android lifecycle remain separate.'},
    ]};
  } finally {rmSync(temporary,{recursive:true,force:true});}
}
