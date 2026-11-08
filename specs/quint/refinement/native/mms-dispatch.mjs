import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {app, directory, javaTraceCampaign, root} from './java.mjs';
import {mmsPlatform} from './mms-dispatch-platform.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {prepareNativeFixture} from '../../../../test/fixtures/native-source.mjs';
import {upstreamNativeSource} from '../../../../scripts/upstream-native-source.mjs';
import {verifyNativePatchReceipt} from '../../../../scripts/prepare-patched-native.mjs';

const model='NativeMmsDispatch';
const shared='plugins/plugin-native-messages/android/src/main/java/ai/eliza/plugins/messages/';
const extracted=['TelephonyPlugin','MmsStore','SmsProviderReader'];
const compiled=['SmsTelephony','SmsTelephonyConfiguration','SmsSendJournal','MmsPdu'];
const product=['AlphaTelephony','AlphaTelephonyPlugin','AlphaSmsSendReceiver'].map(name=>app+name+'.java');
const paths=[...extracted,...compiled].map(name=>shared+name+'.java');
const launcherManifest='android/app/src/launcher/AndroidManifest.xml';
const harness='MmsDispatchTraces.java';
const scenarios=[
  'mms-attachment-conflict','sms-first-mms-receives-sms','mms-first-sms-rejected','exact-review','group-carrier-confirm',
  'preview-invalid-size-and-cancel','carrier-changed-after-review','sim-changed-after-review','begin-refusal-cleans-pdu',
  'part-refusal-cleans-outbox','radio-refusal-before-handoff','uncertain-radio-handoff','interrupted-durable-dispatch',
  'role-loss-before-callback','volatile-callback-evidence','committed-callback-refusal','boot-without-receipt',
];

async function campaign(scenarios, extraSources, check) {
  const temporary=mkdtempSync(join(tmpdir(),'quint-mms-dispatch-'));
  try {
    const staged=prepareNativeFixture(root,temporary);
    const read=name=>readFileSync(join(staged.root,shared+name+'.java'),'utf8');
    const files=Object.entries(mmsPlatform(...extracted.map(read))).map(([path,contents])=>{
      const target=join(temporary,'driver',path);
      mkdirSync(dirname(target),{recursive:true});writeFileSync(target,contents);return target;
    });
    const receiptPath=join(staged.root,'.source.json');
    const generatedSources=[...paths.map(path=>join(staged.root,path)),receiptPath,...files];
    const sources=[...product,...paths.map(path=>'vendor/eliza/'+path),launcherManifest,'android/consumer-host.json',
      'patches/eliza/native-manifest.json','patches/eliza/sms-reviewed-binding.patch','upstream.lock.json',
      'scripts/prepare-patched-native.mjs','scripts/upstream-native-source.mjs','test/fixtures/native-source.mjs','test/fixtures/jvm-tools.mjs',
      app+'AlphaImageCapability.java',join(directory,harness),join(directory,'Trace.java'),join(directory,'java.mjs'),
      join(directory,'sms-dispatch-platform.mjs'),join(directory,'mms-dispatch-platform.mjs'),fileURLToPath(import.meta.url),
      ...(jsonJar?[jsonJar]:[]),...generatedSources,...extraSources];
    const driverHashes=captureInputs(sources);
    verifyNativePatchReceipt(readFileSync(receiptPath,'utf8'),staged);
    const pinned=upstreamNativeSource(root).read(shared);
    for(const path of paths){
      assert.equal(driverHashes[join(root,'vendor/eliza',path)],pinned.get(path).sha256);
      assert.equal(driverHashes[join(staged.root,path)],staged.files[path]);
    }
    const tail=source=>source.split(' // ---- Reviewed native MMS')[1];
    assert.ok(tail(read('TelephonyPlugin')));
    assert.equal(tail(read('TelephonyPlugin')),tail(pinned.get(shared+'TelephonyPlugin.java').bytes.toString('utf8')));
    const host=JSON.parse(readFileSync(join(root,'android/consumer-host.json'),'utf8'));
    assert.deepEqual(host.profile.modules.find(module=>module.name==='eliza-messages'),{
      name:'eliza-messages',source:{root:'patchedNative',path:'plugins/plugin-native-messages/android'},relocateBuild:true,
    });
    assert.match(readFileSync(join(root,launcherManifest),'utf8'),/<receiver\s+android:name="\.AlphaSmsSendReceiver"\s+android:exported="false"/);
    const complete=compiled.map(name=>join(staged.root,shared+name+'.java'));
    const traces=javaTraceCampaign(harness,[...product,...complete,...files],scenarios.map(name=>[name]),'ai.eliza.plugins.messages.MmsDispatchTraces');
    return await check({model,sources,driverHashes,generatedSources,traces});
  } finally {rmSync(temporary,{recursive:true,force:true});}
}

export function mmsSourceProbe(selected=scenarios) {
  return campaign(selected,[],({traces})=>traces);
}

export function checkNativeMmsDispatch(extraSources=[]) {
  return campaign(scenarios,extraSources,async evidence=>{
    const receipt=await checkTraces({...evidence,scope:'bounded-orchestration',assumptions:[
      'Actual product wrapper, staged SMS/MMS core, extracted native review and outbox members, and exact JVM PDU codec.',
      'One installed ID shared by two reviews. Synthetic Android telephony, provider, preview, and credential storage ports. Temporary PDU custody uses real file operations.',
    ]});
    return {receipt,obligations:[
      {model,obligation:'Bind positive MMS recovery to the exact reviewed tuple',
        reason:'The as-built native catch returns an operation record by ID, including a conflicting attachment or a same-ID SMS receipt.'},
      {model,obligation:'Installed MMS effect and callback authority',
        reason:'Installed provider/role checks, URI grants, Android delivery and carrier response remain platform obligations.'},
    ]};
  });
}
