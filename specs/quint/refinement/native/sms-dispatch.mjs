import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces, qmap, qset} from '../check-traces.mjs';
import {app, directory, javaTraceCampaign, root} from './java.mjs';
import {smsMembers, smsPlatform} from './sms-dispatch-platform.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {upstreamNativeSource} from '../../../../scripts/upstream-native-source.mjs';

const model='NativeSmsDispatch';
const shared='plugins/plugin-native-messages/android/src/main/java/ai/eliza/plugins/messages/';
const members=['TelephonyPlugin','MmsStore','SmsProviderReader'];
const compiled=['SmsTelephony','SmsTelephonyConfiguration','SmsSendJournal'];
const product=['AlphaTelephony','AlphaTelephonyPlugin','AlphaSmsSendReceiver'].map(name=>app+name+'.java');
const paths=[...members,...compiled].map(name=>shared+name+'.java');
const manifest='android/app/src/launcher/AndroidManifest.xml';
const harness='SmsDispatchTraces.java';

export function smsSourceTraces(scenarios) {
  const temporary=mkdtempSync(join(tmpdir(),'quint-sms-dispatch-'));
  try{
    const pinned=upstreamNativeSource(root).read(shared);
    const generated={...smsPlatform,...smsMembers(...members.map(name=>pinned.get(shared+name+'.java').bytes.toString('utf8')))};
    const files=Object.entries(generated).map(([path,contents])=>{
      const file=join(temporary,path);
      mkdirSync(dirname(file),{recursive:true});
      writeFileSync(file,contents);
      return file;
    });
    const complete=compiled.map(name=>'vendor/eliza/'+shared+name+'.java');
    return javaTraceCampaign(harness,[...product,...complete,...files],scenarios.map(mode=>[mode]),'ai.eliza.plugins.messages.SmsDispatchTraces');
  } finally {rmSync(temporary,{recursive:true,force:true});}
}

export async function checkNativeSmsDispatch(extraSources = []) {
  const sources=[...product,...paths.map(path=>'vendor/eliza/'+path),manifest,'android/consumer-host.json',
    app+'AlphaImageCapability.java',join(directory,harness),join(directory,'Trace.java'),join(directory,'java.mjs'),
    join(directory,'sms-dispatch-platform.mjs'),fileURLToPath(import.meta.url),'test/fixtures/jvm-tools.mjs',
    'upstream.lock.json','scripts/upstream-native-source.mjs',...(jsonJar?[jsonJar]:[]),...extraSources];
  const driverHashes=captureInputs(sources);
  assert.match(readFileSync(join(root,manifest),'utf8'),/<receiver\s+android:name="\.AlphaSmsSendReceiver"\s+android:exported="false"/);
  const host=JSON.parse(readFileSync(join(root,'android/consumer-host.json'),'utf8'));
  assert.match(JSON.stringify(host),/"name":"eliza-messages","source":\{"root":"upstream","path":"plugins\/plugin-native-messages\/android"\}/);
  const pinned=upstreamNativeSource(root).read(shared);
  for(const path of paths)assert.equal(driverHashes[join(root,'vendor/eliza',path)],pinned.get(path).sha256);
  const traces=smsSourceTraces([
    'cross-dialog-binding','exact-dialog-replay','exact-cancel-and-retired-button','background-cancellation',
    'screen-off-cancellation','initial-permission-denied','carrier-replaced-before-approval','per-recipient-sim-change',
    'partial-radio-throw','radio-refused-before-acceptance','begin-save-before-refusal','begin-commit-then-failed-report',
    'end-write-failure-and-process-recovery','end-committed-before-failure-report','callback-evidence-is-volatile-before-save',
    'callback-evidence-durable-before-failure-report','immutable-receiver-and-newest-listener','boot-retirement-of-missing-receipts',
    'provider-readback-requires-unique-row-and-report','multipart-provider-cannot-prove-delivery','expired-provider-attribution',
    'default-role-outbox','provider-insert-refused','retired-role-outbox',
  ]);
  for(const trace of traces)for(const {expect} of [trace,...trace.steps]){
    for(const field of ['foreground','closed','outbox','sentRows','failedRows'])expect['s.'+field]=qset(expect['s.'+field]);
    expect['s.reviews']=qmap(expect['s.reviews']);
    for(const view of ['memory','disk'])for(const field of ['sent','failed','reported','delivered','deliveryFailed','rows'])
      expect['s.'+view][field]=qset(expect['s.'+view][field]);
  }
  const receipt=await checkTraces({model,sources,driverHashes,traces,scope:'bounded-orchestration',assumptions:[
    'The exact product telephony plugin, receiver and configuration run with the pinned SMS dispatch/journal and extracted exact review and provider members.',
    'Synthetic radio, provider, dialog, Android image/permissions and encrypted-slot ports execute no device or real SMS operations.',
  ]});
  return {receipt,obligations:[
    {model,obligation:'Exact native receipt on a conflicting second review',
      reason:'Current pinned positive recovery returns the existing operation by ID alone after its own dispatch is refused. The baseline proves zero duplicate radio calls and reproduces the foreign binding.'},
    {model,obligation:'Installed AOSP and carrier authority',
      reason:'The JVM controls OS admission, telephony, PendingIntent and provider effects. Installed carrier/role/delivery semantics and arbitrary Android lifecycle remain separate.'},
  ]};
}
