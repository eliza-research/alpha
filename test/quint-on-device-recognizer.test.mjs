import test from 'node:test';
import assert from 'node:assert/strict';
import {probeRecognizerRetirement, recognizerPlatformSources} from '../specs/quint/refinement/native/recognizer-retirement.mjs';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {directory, javaTraceCampaign} from '../specs/quint/refinement/native/java.mjs';
import {currentNativeSource, nativePatchInputs} from '../specs/quint/refinement/native/current-sources.mjs';

const onDeviceRecognizerScenarios=['incremental','early-result','no-speech','active-language-error','duplicate-language-error','cancelled-language-error','cancel-before-callback-delivery','other-error','timeout','finish-empty','cancel-pending','cancel-before-open','cancel-after-result','backlog-boundary','cancel-stalled'];
async function checkOnDeviceRecognizer(extraSources=[]){
 const modelPath='specs/quint/native/NativeOnDeviceRecognizer.qnt';
 const compiled=['OnDeviceRecognizer','RecognizerAvailability','RecognizerUnavailable','NativeAsr','VoiceNative'].map(currentNativeSource).concat(recognizerPlatformSources);
 const sources=[modelPath,...compiled,...nativePatchInputs,directory+'/OnDeviceRecognizerTraces.java',directory+'/recognizer-retirement.mjs',directory+'/Trace.java',directory+'/java.mjs',directory+'/current-sources.mjs',fileURLToPath(import.meta.url),...extraSources];
 const driverHashes=captureInputs(sources);
 const traces=javaTraceCampaign('OnDeviceRecognizerTraces.java',compiled,onDeviceRecognizerScenarios.map(name=>[name]),'ai.eliza.voice.OnDeviceRecognizerTraces');
 return checkTraces({model:'NativeOnDeviceRecognizer',modelPath,sources,driverHashes,traces,scope:'bounded-orchestration',assumptions:[
  'The actual recognizer, cache and worker execute with a controlled Android recognizer and pipe. Each session runs in a fresh JVM with a previously observed installed language.',
  'Macro checkpoints include settled platform closure. Exact backlog at the 64-second limit, retirement with an active stalled writer, and first-answer ownership are observed. Transcript values project to synthetic heard/empty classes.',
  'Android Binder ordering, installed recognition, platform pipe guarantees and arbitrary feed/finish interleavings remain external obligations.'
 ]});
}

test('actual on-device recognition preserves audio bounds and first result authority', {timeout:180000},async()=>{
 const result=await checkOnDeviceRecognizer(['test/quint-on-device-recognizer.test.mjs']);
 assert.equal(result.passed,true);
 assert.equal(result.traces,onDeviceRecognizerScenarios.length);
 assert.equal(result.driverInputsBound,true);
 assert.equal(result.inputsUnchanged,true);
 for(const action of ['feed','stall','finish','callback','timeout','cancel','requestCancel','settleCancel'])assert.ok(result.actions[action]>0,action);
});

test('retired recognition errors preserve availability and an active missing-language result demotes', {timeout:90000},()=>{
 const results=probeRecognizerRetirement();
 assert.deepEqual(results.map(row=>[row.mode,row.availabilityAfterError]),[['answered',true],['cancelled',true],['active',false]]);
 for(const row of results){assert.equal(row.answered,true);assert.equal(row.supportProbes,1);}
});
