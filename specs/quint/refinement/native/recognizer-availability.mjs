import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {directory,javaTraces} from './java.mjs';
import {currentNativeSource,nativePatchInputs} from './current-sources.mjs';
export const recognizerAvailabilityScenarios=['installed','absent','unanswered','late-recovery','newer-answer','newer-unanswered','newer-expired-answer','nonanswer-keeps-installed','temporary-demote','extend-demote','permanent-demote','expired-demote-late-answer','independent-languages','global-demote'];
export async function checkRecognizerAvailability(extraSources=[]){
 const modelPath='specs/quint/native/NativeRecognizerAvailability.qnt';
 const compiled=[currentNativeSource('RecognizerAvailability.java')];
 const sources=[modelPath,...compiled,...nativePatchInputs,directory+'/RecognizerAvailabilityTraces.java',directory+'/Trace.java',directory+'/java.mjs',directory+'/current-sources.mjs',fileURLToPath(import.meta.url),...extraSources];
 const driverHashes=captureInputs(sources);
 const traces=javaTraces('RecognizerAvailabilityTraces.java',compiled,recognizerAvailabilityScenarios,'ai.eliza.voice.RecognizerAvailabilityTraces');
 return checkTraces({model:'NativeRecognizerAvailability',modelPath,sources,driverHashes,traces,scope:'bounded-component',assumptions:[
  'Actual per-language cache and concurrent compute execute. Controlled probes report ticket identity through the real callback, and can settle out of order.',
  'Two languages, up to four tickets, monotonic clock thresholds and timed/permanent/global demotion classes are bounded. Long.MAX_VALUE deadlines project to -1.',
  'Actual Android recognition support callbacks, installed model availability, arbitrary clocks and transcript generation remain separate obligations.'
 ]});
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkRecognizerAvailability(),null,2));
