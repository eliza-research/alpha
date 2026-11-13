import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {directory, javaTraces} from '../specs/quint/refinement/native/java.mjs';
import {currentNativeSource, nativePatchInputs} from '../specs/quint/refinement/native/current-sources.mjs';

const asrPipeScenarios=['normal','final','immutable','fifo','chars-boundary','chars-over','malformed-frame','rejected','rejected-callback','rejected-cancel','closed-before-start','owner-before-start','queue-bound','frame-bound','oversize',
 'cancel-warm','owner-during-warm','warm-error','warm-asr','warm-invalid','warm-malformed','warm-throw',
 'cutoff-0','cutoff-1','cutoff-2','cutoff-nan','cancel-batch','owner-during-batch','batch-asr','batch-invalid','batch-malformed','batch-error','batch-throw',
 'close-ok','close-final','close-invalid','close-malformed','close-error','close-throw'];
async function checkAsrPipe(extraSources=[]){
 const compiled=[currentNativeSource('LiveSegmentPipe.java')];
 const sources=[...compiled,...nativePatchInputs,directory+'/AsrPipeTraces.java',directory+'/Trace.java',directory+'/java.mjs',directory+'/current-sources.mjs',fileURLToPath(import.meta.url),...extraSources];
 const driverHashes=captureInputs(sources);
 const traces=javaTraces('AsrPipeTraces.java',compiled,['campaign',...asrPipeScenarios]);
 return checkTraces({model:'NativeAsrPipe',sources,driverHashes,traces,scope:'bounded-component',assumptions:[
  'The real LiveSegmentPipe executes with a controlled serial worker and owner-bound provider responses. No network provider is contacted.',
  'One start, eight queued batches, three dispatched batches and three transcript results bound the campaign. The byte-bound trace fills eight exact 128KiB batches (1MiB) before rejection; the independent frame-bound trace fills seven sixteen-frame batches plus thirteen (125 frames) before rejecting the 126th frame. Frame and VAD timestamps have independent early/late membership bits.',
  'Physical native IPC, real provider ownership and the controller join are separate source scopes. JSON payload text is represented by valid, invalid-field, malformed and provider-failure classes.'
 ]});
}

test('actual ASR pipe preserves cutoff, owner retirement and terminal futures', {timeout:scaledTimeout(360000)}, async()=>{
  const receipt=await checkAsrPipe(['test/quint-asr-pipe.test.mjs']);
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,asrPipeScenarios.length);
  assert.equal(receipt.driverInputsBound,true);
  assert.equal(receipt.inputsUnchanged,true);
  assert.ok(receipt.actions.warmReply>0);
  assert.ok(receipt.actions.closeReply>0);
  assert.ok(receipt.actions.ownership>0);
});
