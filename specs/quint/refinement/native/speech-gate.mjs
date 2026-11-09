import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {directory,javaTraces} from './java.mjs';
import {currentNativeSource,nativePatchInputs} from './current-sources.mjs';
export const speechGateScenarios=['minimum','short','ring-wrap','opening-gap','mid-turn','max-length','max-trim','reset-active','adaptive','level-classes','invalid'];
export async function checkSpeechGate(extraSources=[]){
 const modelPath='specs/quint/native/NativeSpeechGate.qnt',compiled=[currentNativeSource('SpeechGate.java')];
 const sources=[modelPath,...compiled,...nativePatchInputs,directory+'/SpeechGateTraces.java',directory+'/Trace.java',directory+'/java.mjs',directory+'/current-sources.mjs',fileURLToPath(import.meta.url),...extraSources];
 const driverHashes=captureInputs(sources);
 const traces=javaTraces('SpeechGateTraces.java',compiled,speechGateScenarios,'ai.eliza.sense.SpeechGateTraces');
 return checkTraces({model:'NativeSpeechGate',modelPath,sources,driverHashes,traces,scope:'bounded-component',assumptions:[
  'Actual shared SpeechGate executes fixed 320-sample PCM frames with eight distinct amplitudes. Physical ring slots, utterance samples, speech/silence counters, outputs and zeroed unused storage are observed.',
  'Noise floor and RMS are rounded to millidecibels. The transition permits two millidecibels of rounding uncertainty and only allows ambiguous classification within the threshold band. The Java observer reads source values instead of reproducing the classifier.',
  'Multi-frame macrosteps retain each actual input and measured floor. Source states are observed at boundary checkpoints. Arbitrary raw PCM, floating-point domain completeness and Android capture scheduling are separate obligations.'
 ]});
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkSpeechGate(),null,2));
