import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {directory, javaTraces} from '../specs/quint/refinement/native/java.mjs';
import {currentNativeSource, nativePatchInputs} from '../specs/quint/refinement/native/current-sources.mjs';

const speechGateScenarios=['minimum','short','ring-wrap','opening-gap','mid-turn','max-length','max-trim','reset-active','adaptive','level-classes','invalid'];
async function checkSpeechGate(extraSources=[]){
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

test('actual listener speech gate preserves adaptive thresholds and bounded PCM order', {timeout:scaledTimeout(180000)},async()=>{
 const result=await checkSpeechGate(['test/quint-speech-gate.test.mjs']);
 assert.equal(result.passed,true);
 assert.equal(result.traces,speechGateScenarios.length);
 assert.equal(result.driverInputsBound,true);
 assert.equal(result.inputsUnchanged,true);
 for(const action of ['accept','reset','invalidFrame'])assert.ok(result.actions[action]>0,action);
});
