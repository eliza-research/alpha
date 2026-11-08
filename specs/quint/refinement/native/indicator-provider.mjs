import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {directory,javaTraces} from './java.mjs';
import {currentNativeSource,nativePatchInputs} from './current-sources.mjs';
import {indicatorProviderPlatform} from './indicator-provider-platform.mjs';
const source='vendor/eliza/packages/app/platforms/android/sense/src/main/java/ai/eliza/sense/';
function compiled(platform){return [currentNativeSource('IndicatorLeaseProvider.java'),source+'IndicatorLease.java',source+'ListenerPolicy.java',directory+'/ProviderPorts.java',...platform.paths];}
export const indicatorProviderScenarios=['replace','unlink-failure','same-token','dead-token','revoke','expired','boot','invalid-expired','missing-token','missing-renew','unknown','denied-permission','denied-signature','denied-package','denied-shared-uid','denied-user','denied-low-uid','denied-missing-package','visible','hidden','chip_hidden','off','aod','fullscreen','shade','transition','unknown-report'];
export function probeIndicatorProvider(){
 const platform=indicatorProviderPlatform();
 try{return javaTraces('IndicatorProviderProbe.java',compiled(platform),[],'ai.eliza.sense.IndicatorProviderProbe');}
 finally{platform.close();}
}
export async function checkIndicatorProvider(extraSources=[]){
 const platform=indicatorProviderPlatform(),inputs=compiled(platform);
 const sources=[...inputs,...nativePatchInputs,directory+'/IndicatorProviderTraces.java',directory+'/IndicatorProviderProbe.java',directory+'/indicator-provider-platform.mjs',directory+'/current-sources.mjs',directory+'/Trace.java',directory+'/java.mjs',fileURLToPath(import.meta.url),...extraSources];
 try{
  const driverHashes=captureInputs(sources);
  const traces=javaTraces('IndicatorProviderTraces.java',inputs,['campaign',...indicatorProviderScenarios],'ai.eliza.sense.IndicatorProviderTraces');
  return await checkTraces({model:'NativeIndicatorProvider',sources,driverHashes,traces,scope:'bounded-orchestration',assumptions:[
   'Actual IndicatorLeaseProvider and IndicatorLease execute. Android caller identity, Binder death registration and the Listener convergence target are controlled primitive ports.',
   'Three lease generations and three token identities bound the state space. Report classes cover visible, hidden, chip-hidden, explained pauses and unknown display. Full attribution/clock policy has its own ListenerLeaseRecovery evidence.',
   'The separate held-monitor race regression executes two competing public calls32 times and checks the real lease generation against the actual linked death callback. No runtime-source observer is inserted.',
   'The full ListeningService convergence, real Binder and package-manager authority, SystemUI surface visibility and installed Android scheduling remain integration obligations.'
  ]});
 }finally{platform.close();}
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(process.argv.includes('--probe')?probeIndicatorProvider():await checkIndicatorProvider(),null,2));
