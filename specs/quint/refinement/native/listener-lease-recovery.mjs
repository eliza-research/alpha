import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {directory,javaTraces} from './java.mjs';
import {currentNativeSource,nativePatchInputs} from './current-sources.mjs';
import {listenerServicePlatform} from './listener-service-platform.mjs';

/** Instrument only the primitive input port; all service/store/lease code is compiled whole. */
export async function checkListenerLeaseRecovery(extraSources=[]){
 const platform=listenerServicePlatform(),state=mkdtempSync(join(tmpdir(),'quint-listener-current-capture-'));
 try{
  const audio=platform.paths.find(path=>path.endsWith('/android/media/AudioRecord.java'));
  const original=readFileSync(audio,'utf8');
  const declaration='public static final int STATE_INITIALIZED=1,READ_BLOCKING=0;';
  const read='public int read(short[] buffer,int offset,int size,int mode){';
  assert.equal(original.split(declaration).length,2);assert.equal(original.split(read).length,2);
  writeFileSync(audio,original.replace(declaration,declaration+'public static final java.util.concurrent.atomic.AtomicInteger readCalls=new java.util.concurrent.atomic.AtomicInteger();public static final java.util.concurrent.CountDownLatch readEntered=new java.util.concurrent.CountDownLatch(1);')
   .replace(read,read+'readCalls.incrementAndGet();readEntered.countDown();'));
  const inputs=['ListeningService','Listener','ListenerStore','ListeningEpoch','IndicatorLease','ListenerPolicy','CrashLoopBreaker','SpeechGate','WakePhrase','SenseConfig'].map(currentNativeSource)
   .concat(directory+'/StorePorts.java',directory+'/ServicePorts.java',platform.paths);
  const sources=[...inputs,...nativePatchInputs,directory+'/ListenerLeaseRecoveryTraces.java',directory+'/listener-service-platform.mjs',directory+'/listener-store-platform.mjs',directory+'/current-sources.mjs',directory+'/Trace.java',directory+'/java.mjs',fileURLToPath(import.meta.url),...extraSources];
  const driverHashes=captureInputs(sources);
  const actual=javaTraces('ListenerLeaseRecoveryTraces.java',inputs,[state],'ai.eliza.sense.ListenerLeaseRecoveryTraces');
  const receipt=await checkTraces({model:'ListenerLeaseRecovery',sources,driverHashes,generatedSources:platform.paths,traces:actual.traces,scope:'bounded-orchestration',assumptions:[
   'Whole current ListeningService, Listener, ListenerStore and IndicatorLease classes execute against controlled Android, durable-preference, AudioRecord and ASR ports. Durable writes succeed; no JNI or device audio executes.',
   'Current private worker identity, input-read entry, AudioRecord identity, microphoneHeld and unsilencedSince are observed separately from the stored open-session marker. Restoring a marker and consent alone cannot create a capture worker.',
   'The input port blocks the actual worker before delivering audio, then stops it through the real service lifecycle. Lease verdict and capture identity are qualified; arbitrary audio content and accepted-frame effects are outside this projection.',
   'One worker and one recording allocation per process; two fresh JVMs cover a restored marker and attribution grace at2499/2500ms. The existing component campaign separately covers lease generations, visibility and crash-history boundaries.'
  ]});
  return {receipt,observations:actual.observations};
 }finally{platform.close();rmSync(state,{recursive:true,force:true});}
}
