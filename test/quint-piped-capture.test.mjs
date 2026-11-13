import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {directory, javaTraces} from '../specs/quint/refinement/native/java.mjs';
import {liveCapturePlatform} from '../specs/quint/refinement/native/live-capture-platform.mjs';
import {liveCaptureSources} from '../specs/quint/refinement/native/live-capture.mjs';
import {nativePatchInputs} from '../specs/quint/refinement/native/current-sources.mjs';

const pipedCaptureScenarios=['normal','final','asr','pipe-error','owner-batch','owner-warm','warm-failure','pause-warm','destroy-warm','call-open','stop-discard','unconfirmed','pause-live','destroy-live'];
async function checkPipedCapture(extraSources=[]){
 const platform=liveCapturePlatform(),state=mkdtempSync(join(tmpdir(),'quint-piped-capture-')),compiled=liveCaptureSources(platform);
 const sources=[...compiled,...nativePatchInputs,directory+'/PipedCaptureTraces.java',directory+'/live-capture-platform.mjs',directory+'/live-capture.mjs',directory+'/shared-recording-platform.mjs',directory+'/shared-recording.mjs',directory+'/note-bridge-platform.mjs',directory+'/note-recording-platform.mjs',directory+'/current-sources.mjs',directory+'/Trace.java',directory+'/java.mjs',fileURLToPath(import.meta.url),...extraSources];
 try{
  const driverHashes=captureInputs(sources);const traces=javaTraces('PipedCaptureTraces.java',compiled,[state,'campaign',...pipedCaptureScenarios]);
  return await checkTraces({model:'NativePipedCapture',sources,driverHashes,generatedSources:platform.paths,traces,scope:'bounded-orchestration',assumptions:[
   'Protected-screen state is fixed inactive in this projection; production protected-surface guards remain present.',
   'The real shared bridge, LiveCaptureController, LiveVoiceCapture and LiveSegmentPipe execute together against controlled Android audio and an owner-bound provider port.',
   'One piped reservation, two forwarded frame events and two transcript results bound this coordinator campaign. Standalone NativeAsrPipe covers its internal queue/cutoff/response partitions.',
   'Physical Android capture, actual resident credentials and IPC delivery remain separate integration obligations.'
  ]});
 }finally{platform.close();rmSync(state,{recursive:true,force:true});}
}

test('actual capture waits for ASR warmup and retains exact pipe cleanup results', {timeout:scaledTimeout(360000)}, async()=>{
  const result=await checkPipedCapture(['test/quint-piped-capture.test.mjs']);
  assert.equal(result.passed,true);
  assert.equal(result.traces,pipedCaptureScenarios.length);
  assert.equal(result.driverInputsBound,true);
  assert.equal(result.inputsUnchanged,true);
  assert.ok(result.actions.warmReply>0);
  assert.ok(result.actions.stopFinishedPipe>0);
  assert.ok(result.actions.destroy>0);
});
