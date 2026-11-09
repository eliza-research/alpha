import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {directory,javaTraceCampaign,root} from './java.mjs';
import {actionRecoveryPlatform,recoveryBridge,recoveryProduct,recoveryShared,reminderStore} from './action-recovery-platform.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {upstreamNativeSource} from '../../../../scripts/upstream-native-source.mjs';

const model='NativeActionRecovery';
const harness='ActionRecoveryTraces.java';
const nativeManifest='patches/eliza/native-manifest.json';
const hostPath='android/consumer-host.json';
const compiled=[...recoveryProduct,...recoveryShared.map(path=>'vendor/eliza/'+path)];
const cases=[
  ['notice-recovered','notice','unknown'],
  ['notice-exact','notice','applying'],
  ['notice-foreign-receipt','notice','applying'],
  ['notice-changed-content','notice','applying'],
  ['notice-faults','notice','applying'],
  ['notice-no-admission','notice','reserved',false],
  ['notice-no-admission','notice','unknown',false],
  ['notice-uncertain','notice','applying'],
  ...['workflow-read','calendar-read','note-read','note-query','maps-read','reminder-read','reminder-create']
    .map(kind=>['read-shapes',kind,'succeeded']),
  ['wrong-type','maps-read','succeeded'],
  ['missing-entry','notice','absent',false],
  ['reminder-recovered','reminder-read','unknown'],
  ...['reminder-create','reminder-update','reminder-snooze']
    .map(kind=>['reminder-exact',kind,'applying']),
  ['reminder-foreign','reminder-read','applying'],
  ['reminder-cancel-exact','reminder-cancel','applying',true,true],
  ['legacy-missing-binding-settled','reminder-read','succeeded'],
  ['legacy-missing-binding-applying','reminder-read','applying'],
  ['reminder-invalid-result','reminder-create','applying'],
  ['reminder-legacy-no-attempt','reminder-complete','unknown',false],
  ['reminder-no-admission','reminder-complete','reserved',false],
  ['reminder-changed-operation','reminder-complete','applying'],
  ['deletion-recovered','calendar-delete','unknown',true,true],
  ['deletion-mismatches','calendar-delete','applying',true,true],
  ['deletion-no-claim','calendar-delete','applying',true,false],
  ['deletion-failed','calendar-delete','applying',true,true,'undone'],
  ['deletion-failed','calendar-delete','applying',true,true,'conflict'],
  ['deletion-reminder-uncertain','reminder-cancel','applying',true,true],
];
const argumentsFor=([name,kind,phase,attempt=true,claim=false,outcome=''])=>
  [name,kind,phase,String(attempt),String(claim),outcome];

export async function checkNativeActionRecovery(extraSources=[]) {
  const fixture=actionRecoveryPlatform();
  try {
    const sources=[recoveryBridge,...compiled,'vendor/eliza/'+reminderStore,hostPath,nativeManifest,'upstream.lock.json',
      'scripts/upstream-native-source.mjs','test/fixtures/jvm-tools.mjs',...(jsonJar?[jsonJar]:[]),
      ...[harness,'Trace.java','java.mjs','action-recovery-platform.mjs'].map(name=>join(directory,name)),
      fileURLToPath(import.meta.url),...fixture.paths,...extraSources];
    const driverHashes=captureInputs(sources);
    const staged=JSON.parse(readFileSync(join(root,nativeManifest),'utf8'));
    const host=JSON.parse(readFileSync(join(root,hostPath),'utf8'));
    const pinned=upstreamNativeSource(root);
    for(const name of ['action-journal','notifications','reminders']) {
      const module='plugins/plugin-native-'+name+'/android';
      assert.deepEqual(host.profile.modules.find(item=>item.name==='eliza-'+name),{
        name:'eliza-'+name,source:{root:'patchedNative',path:module},relocateBuild:true,
      });
      const inventory=pinned.read(module);
      for(const path of [...recoveryShared,reminderStore].filter(path=>path.startsWith(module+'/'))) {
        assert.ok(staged.patches.every(patch=>patch.targets.every(target=>target.path!==path)),`Recovery input has a staged transform: ${path}`);
        assert.equal(driverHashes[join(root,'vendor/eliza',path)],inventory.get(path).sha256);
      }
    }
    const traces=javaTraceCampaign(harness,[...compiled,...fixture.paths],cases.map(argumentsFor));
    traces.forEach((trace,i)=>{trace.name+=` / ${cases[i][1]} / ${cases[i][2]}`;});
    const receipt=await checkTraces({model,sources,driverHashes,generatedSources:fixture.paths,traces,
      scope:'bounded-orchestration',assumptions:[
        'The exact three product recovery members and product journal policy run on the real pinned ActionJournalPlugin worker, journal and receipt classifiers. WorkflowNoticeDelivery and pinned NoticeDelivery are complete. Exact ReminderStore operationReceipt and canonical hash members use a synthetic envelope.',
        'One selected row, absent or foreign scope/proposal requests, selected result shapes and stored equality classes. The harness observes slot strings, exact bridge responses and both write boundaries. A postcommit refusal leaves the stored string durable in the synthetic port.',
        'Deletion receipt rows, notification active-list match and reminder storage input are synthetic. The poster throws if any admission, dispatch or cancellation effect is requested. The fixture executes no reminder operation, calendar/provider action or device launch.',
      ]});
    return {receipt,obligations:[
      {model,obligation:'Cross-process storage and live platform receipt evidence',reason:'The fixture observes one app worker at a time, with explicit destruction and reconstruction. Android secure-store durability, active notification matching and upstream provider effects remain external.'},
      {model,obligation:'Renderer proposal admission and same-installation actor',reason:'Requests and proof keys are synthetic. The baseline divergence supplied an existing foreign binding and equivalent operation. The repaired boundary checks the selected row before receipt lookup.'},
    ]};
  } finally {fixture.close();}
}
