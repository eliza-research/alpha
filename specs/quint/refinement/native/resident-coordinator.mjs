import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {app, directory, javaTraces} from './java.mjs';
import {residentPlatform} from './resident-platform.mjs';

const sharedRuntime = 'vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/';
export const residentSources = [
  ...['AlphaLocalAgentPlugin.java','LocalAgentProviderAdmission.java','CloudDeployment.java',
    'PluginWorkers.java','ResidentCredentialShutdownRetry.java','ResidentRecoveryReview.java',
    'ResidentScheduleRearm.java','NativeVoiceBinding.java','VoiceEventAdmission.java',
    'InvocationOwnerCache.java','NativeNotificationSession.java','NativeNotificationDiagnostics.java',
    'HostedInbox.java','HostedResultNotices.java','HostedStorageFault.java','PreparedViewNavigation.java'].map(name=>app+name),
  ...['ResidentAttachment.java','NativeProviderAdmission.java','NativeProviderSlot.java',
    'CredentialRequestFence.java','CredentialIntentFence.java','NativeRuntimeEmbeddings.java'].map(name=>sharedRuntime+name),
  'vendor/eliza/plugins/plugin-local-inference/native/android/src/main/java/ai/eliza/voice/BufferedStreamExchange.java',
  'vendor/eliza/plugins/plugin-native-notifications/android/src/main/java/ai/eliza/plugins/notifications/NoticeOwner.java',
  'vendor/eliza/plugins/plugin-native-secure-store/android-nativeonly/src/main/java/ai/eliza/plugins/securestore/nativeonly/CredentialIntentFence.java',
];
export const residentScenarios=['stop','stop-error','late-stop','late-cancel','owned-cancel',
  'attached-cancel','unowned-cancel','lost-pair','last-surface','broadcast-race'];
export function generateResidentCoordinatorTraces(scenario,extraSources=[]){
  const platform=residentPlatform();
  const sources=[...residentSources,`${directory}/ResidentTestPorts.java`,`${directory}/ResidentCoordinatorTraces.java`,
    `${directory}/Trace.java`,`${directory}/java.mjs`,`${directory}/resident-platform.mjs`,fileURLToPath(import.meta.url),...extraSources];
  try {
    const driverHashes=captureInputs(sources);
    const traces=(scenario?[scenario]:residentScenarios).flatMap(name=>javaTraces('ResidentCoordinatorTraces.java',
      [...residentSources,...platform.paths,`${directory}/ResidentTestPorts.java`],[name,platform.directory]));
    const fixtureSha256=createHash('sha256').update(JSON.stringify(platform.sources)).digest('hex');
    return {traces,sources,driverHashes,fixtureSha256};
  }
  finally{platform.close();}
}
export async function checkResidentCoordinator(extraSources=[]){
  const generated=generateResidentCoordinatorTraces(undefined,extraSources);
  return checkTraces({model:'ResidentRuntime',id:'ResidentRuntime-coordinator',scope:'bounded-orchestration',
    sources:generated.sources,driverHashes:generated.driverHashes,traces:generated.traces,assumptions:[
      `Whole AlphaLocalAgentPlugin executes with external Android, Capacitor, vault and service ports (${generated.fixtureSha256}).`,
      'Epoch, phase and launch ownership project observed source fields. The raw plugin and service observations are retained.',
      'Each schedule uses a fresh JVM. Worker execution and response interleavings execute actual source guards.',
      'Real Binder/process lifecycle, runtime packaging, encrypted storage, native HTTP and service startup remain platform obligations.',
    ]});
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  if(process.argv[2])console.log(JSON.stringify(generateResidentCoordinatorTraces(process.argv[2]),null,2));
  else console.log(JSON.stringify(await checkResidentCoordinator(),null,2));
}
