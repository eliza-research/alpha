import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {app,directory,javaTraces,root} from './java.mjs';
import {join} from 'node:path';
import {preparePatchedNative} from '../../../../scripts/prepare-patched-native.ts';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {deletionPlatform} from './deletion-platform.mjs';
const deletionProductSources=['NativeDeletionCoordinator.java','NativeOwnerReminderHost.java',
  'NativeDeviceEnrollmentKey.java','NativeNotificationDiagnostics.java','HostedInbox.java',
  'HostedResultNotices.java','HostedStorageFault.java'].map(name=>app+name);
const deletionSharedSources=['DeferredDeletionCoordinator.java','DeferredDeletionJournal.java','DeletionDeadline.java']
  .map(name=>'plugins/plugin-native-action-journal/android/src/main/java/ai/eliza/plugins/actionjournal/deletion/'+name)
  .concat('plugins/plugin-native-notifications/android/src/main/java/ai/eliza/plugins/notifications/NoticeOwner.java');
export const deletionScenarios=['deleted','conflict','permission','unknown','undo','reboot','open','claim-refused',
  'claim-committed-error','outcome-refused','outcome-committed-error','restart','stale-owner','stale-stage','multiple-rows','reminder-open','reminder-undo','reminder-retired','reminder-session-retired','reminder-effects','stage-refused','stage-committed-error','stage-schedule-error'];
export function generateDeletionCoordinatorTraces(scenario,extraSources=[]){
 const platform=deletionPlatform();
 const prepared=preparePatchedNative({root});
 const deletionSources=[...deletionProductSources,...deletionSharedSources.map(name=>join(prepared.root,name))];
 const sources=[...deletionSources,`${directory}/DeletionTestPorts.java`,`${directory}/DeletionCoordinatorTraces.java`,
  `${directory}/Trace.java`,`${directory}/java.mjs`,`${directory}/deletion-platform.mjs`,
  "android/upstream-native-sources.json",fileURLToPath(import.meta.url),...extraSources];
 try{
  const driverHashes=captureInputs(sources);
  const traces=(scenario?[scenario]:deletionScenarios).flatMap(name=>javaTraces('DeletionCoordinatorTraces.java',
   [...deletionSources,...platform.paths,`${directory}/DeletionTestPorts.java`],[name]));
  return {traces,sources,driverHashes,fixtureSha256:createHash('sha256').update(JSON.stringify(platform.sources)).digest('hex')};
 }finally{platform.close();}
}
export async function checkDeletionCoordinator(extraSources=[]){
 const data=generateDeletionCoordinatorTraces(undefined,extraSources);
 return checkTraces({model:'DeletionJournal',id:'DeletionJournal-coordinator',scope:'bounded-orchestration',
  traces:data.traces,sources:data.sources,driverHashes:data.driverHashes,assumptions:[
   `Actual pinned shared DeferredDeletionCoordinator, Alpha host binding, journal and NativeOwnerReminderHost execute with external ports ${data.fixtureSha256}.`,
   'One selected calendar row projects phase and durable dispatch admissions. Actual provider call counts are retained separately and asserted not to replay.',
   'Durable-write observations include failures before replacement and after replacement. Raw stored dispatching state and public unknown receipts are separate checkpoints.',
   'WorkManager, encrypted storage and calendar/reminder providers are controlled boundaries. Android integration and arbitrary multi-row retention remain separate obligations.',
  ]});
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.argv[2])console.log(JSON.stringify(generateDeletionCoordinatorTraces(process.argv[2]),null,2));
 else console.log(JSON.stringify(await checkDeletionCoordinator(),null,2));
}
