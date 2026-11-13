import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {directory, javaTraces} from '../specs/quint/refinement/native/java.mjs';
import {currentNativeSource, nativePatchInputs} from '../specs/quint/refinement/native/current-sources.mjs';

const recognizerAvailabilityScenarios=['installed','absent','unanswered','late-recovery','newer-answer','newer-unanswered','newer-expired-answer','nonanswer-keeps-installed','temporary-demote','extend-demote','permanent-demote','expired-demote-late-answer','independent-languages','global-demote'];
async function checkRecognizerAvailability(extraSources=[]){
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

test('actual recognizer availability preserves timed and ticketed cache authority', {timeout:180000},async()=>{
 const result=await checkRecognizerAvailability(['test/quint-recognizer-availability.test.mjs']);
 assert.equal(result.passed,true);
 assert.equal(result.traces,recognizerAvailabilityScenarios.length);
 assert.equal(result.driverInputsBound,true);
 assert.equal(result.inputsUnchanged,true);
 for(const action of ['beginProbe','completeProbe','lateAnswer','cached','recordNow','advance','demote','demoteAll'])assert.ok(result.actions[action]>0,action);
});
