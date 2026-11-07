import test from 'node:test';
import assert from 'node:assert/strict';
// The shared native live transport (@elizaos/voice/native-live) that Alpha's native-live-voice.ts binds.
import {createNativeLiveVoice} from '../.eliza/client-features/packages/voice/src/native-live-voice.ts';

for (const nativeTransport of [false, true]) test(`aborting while native start is pending sends Stop before startup resolves (nativeTransport=${nativeTransport})`, async () => {
 const listeners=new Map();let settleStart, captureId, starting=false;const stops=[];
 const plugin={
  async liveCaptureStatus(){return {available:true,nativeTransport};},
  async addListener(name,handler){listeners.set(name,handler);return {remove:async()=>listeners.delete(name)};},
  startLiveCapture(input){captureId=input.captureId;starting=true;return new Promise(resolve=>{settleStart=resolve;});},
  async stopLiveCapture(input){stops.push(input);listeners.get('liveCaptureEnded')?.({captureId});return {captureId,serverClosed:true};},
 };
 const resident={sessionId:'session',ownerId:'owner',request:async()=>({ready:true})};
 const voice=createNativeLiveVoice({port:plugin,available:()=>true,resident:()=>resident,endedTimeoutMs:5});
 const controller=new AbortController();
 const opening=voice.open({signal:controller.signal,echoCancel:false,onSegment(){},onLost(){}});
 for(let i=0;i<20&&!starting;i++)await Promise.resolve();
 assert.equal(typeof settleStart,'function');assert.match(captureId,/^[0-9a-f-]{36}$/);controller.abort();
 await Promise.resolve();assert.equal(stops.length,1,'Stop cannot wait for start acknowledgement');
 if(nativeTransport)assert.equal(stops[0].discard,true,'the native route discards on abort');
 settleStart({captureId,sampleRate:16000,echoCancelled:false,nativeAsr:nativeTransport});
 await assert.rejects(opening,{name:'AbortError'});assert.equal(listeners.size,0);
});
