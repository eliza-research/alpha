import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {directory,javaTraces} from './java.mjs';
import {currentNativeSource,nativePatchInputs} from './current-sources.mjs';
export const asrPipeScenarios=['normal','final','immutable','fifo','chars-boundary','chars-over','malformed-frame','rejected','rejected-callback','rejected-cancel','closed-before-start','owner-before-start','queue-bound','oversize',
 'cancel-warm','owner-during-warm','warm-error','warm-asr','warm-invalid','warm-malformed','warm-throw',
 'cutoff-0','cutoff-1','cutoff-2','cutoff-nan','cancel-batch','owner-during-batch','batch-asr','batch-invalid','batch-malformed','batch-error','batch-throw',
 'close-ok','close-final','close-invalid','close-malformed','close-error','close-throw'];
export async function checkAsrPipe(extraSources=[]){
 const compiled=[currentNativeSource('LiveSegmentPipe.java')];
 const sources=[...compiled,...nativePatchInputs,directory+'/AsrPipeTraces.java',directory+'/Trace.java',directory+'/java.mjs',directory+'/current-sources.mjs',fileURLToPath(import.meta.url),...extraSources];
 const driverHashes=captureInputs(sources);
 const traces=javaTraces('AsrPipeTraces.java',compiled,['campaign',...asrPipeScenarios]);
 return checkTraces({model:'NativeAsrPipe',sources,driverHashes,traces,scope:'bounded-component',assumptions:[
  'The real LiveSegmentPipe executes with a controlled serial worker and owner-bound provider responses. No network provider is contacted.',
  'One start, eight queued batches, three dispatched batches and three transcript results bound the campaign. Frame and VAD timestamps have independent early/late membership bits.',
  'Physical native IPC, real provider ownership and the controller join are separate source scopes. JSON payload text is represented by valid, invalid-field, malformed and provider-failure classes.'
 ]});
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkAsrPipe(),null,2));
