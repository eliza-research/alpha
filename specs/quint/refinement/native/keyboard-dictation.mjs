import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {directory,javaTraces} from './java.mjs';
export async function checkKeyboardDictation(extraSources=[]){
 const compiled=['android/app/src/main/java/ai/elizaresearch/alphaphone/KeyboardDictationPolicy.java'];
 const sources=[...compiled,directory+'/KeyboardDictationTraces.java',directory+'/Trace.java',directory+'/java.mjs',fileURLToPath(import.meta.url),...extraSources];
 const driverHashes=captureInputs(sources);const traces=javaTraces('KeyboardDictationTraces.java',compiled);
 return checkTraces({model:'KeyboardDictation',sources,driverHashes,traces,scope:'bounded-component',assumptions:[
  'The actual Java policy open/start/stop/finish/close methods execute. State and generation are observed directly, using reflection for the private generation counter.',
  'Five traces cover repeated completion, cancel, replaced capture, wrong ticket, changed field and changed account. Accepted insertion counts the actual finish result at a controlled service port.',
  'The field/account observations are external input. Android InputConnection writes, permissions, provider requests, audio, shutdown scheduling and installed Pixel behavior are separate obligations.'
 ]});
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkKeyboardDictation(),null,2));
