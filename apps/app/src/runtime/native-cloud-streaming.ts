import {Capacitor, type PluginListenerHandle} from '@capacitor/core';
import {registerPlugin} from '../platform-plugins';
import type {AssistantCapture, AssistantListenHandlers} from './voice-assistant';

export interface CloudStreamEvent {
  sessionId?: unknown;
  type?: unknown;
  text?: unknown;
  final?: unknown;
  peak?: unknown;
  utteranceId?: unknown;
  code?: unknown;
}
export interface CloudStreamPort {
  startCloudSpeech(input:{sessionId:string;environment:string;credentialId:string}):Promise<{sessionId:string;sampleRate:number;echoCancelled:boolean}>;
  stopCloudSpeech(input:{sessionId:string}):Promise<unknown>;
  setCloudSpeechMuted(input:{sessionId:string;muted:boolean}):Promise<unknown>;
  speakCloudSpeech(input:{sessionId:string;utteranceId:string;text:string}):Promise<unknown>;
  cancelCloudSpeech(input:{sessionId:string;utteranceId:string}):Promise<unknown>;
  addListener(event:'cloudSpeechEvent',callback:(event:CloudStreamEvent)=>void):Promise<PluginListenerHandle>;
}
const plugin=registerPlugin<CloudStreamPort>('AlphaCloudSpeechStream');
export const nativeCloudStreamingAvailable=()=>Capacitor.isNativePlatform()&&Capacitor.isPluginAvailable('AlphaCloudSpeechStream');
const cancelled=()=>new DOMException('Cloud speech stopped','AbortError');

/** The native socket owns credentials and PCM. Only text, levels and lifecycle events enter the renderer. */
export function createCloudStreamingSpeech(input:{
  environment:string;credentialId:string;assertCurrent():void;onInterim?(text:string):void;
},port:CloudStreamPort=plugin){
  const sessionId=crypto.randomUUID();
  let handle:PluginListenerHandle|undefined,opening:Promise<void>|undefined,stopping:Promise<void>|undefined;
  let opened=false,retired=false,echoCancelled=false,speechActive=false;
  let listening:AssistantListenHandlers|undefined;
  let ownerSignal:AbortSignal|undefined;
  const ownerAborted=()=>{void stop().catch(()=>{});};
  let ended:()=>void=()=>{};
  const utterances=new Map<string,{started:boolean;onStarted():void;resolve():void;reject(error:unknown):void}>();
  const check=()=>{if(retired)throw cancelled();input.assertCurrent();};
  const stop=():Promise<void>=>{
    if(stopping)return stopping;
    retired=true;opened=false;speechActive=false;ended();
    ownerSignal?.removeEventListener('abort',ownerAborted);ownerSignal=undefined;
    for(const pending of utterances.values())pending.reject(cancelled());utterances.clear();
    stopping=(async()=>{try{await port.stopCloudSpeech({sessionId});}finally{await handle?.remove();handle=undefined;}})();
    return stopping;
  };
  const fail=(error:unknown)=>{
    const capture=listening;listening=undefined;
    for(const pending of utterances.values())pending.reject(error);utterances.clear();
    void stop().catch(()=>{});capture?.onEnd(error);
  };
  const receive=(event:CloudStreamEvent)=>{
    if(retired||event.sessionId!==sessionId)return;
    try{
      check();
      if(event.type==='error'){fail(Object.assign(Error('Cloud streaming speech is unavailable.'),{code:typeof event.code==='string'?event.code:'cloud-stream'}));return;}
      if(event.type==='audio-start'||event.type==='audio-end'){
        if(typeof event.utteranceId!=='string')return;
        const pending=utterances.get(event.utteranceId);if(!pending)return;
        if(event.type==='audio-start'){if(!pending.started){pending.started=true;pending.onStarted();}}
        else{utterances.delete(event.utteranceId);pending.started?pending.resolve():pending.reject(Error('Cloud speech ended without audio.'));}
        return;
      }
      const capture=listening;if(!capture||capture.signal.aborted)return;
      if(event.type==='level'&&typeof event.peak==='number'&&Number.isFinite(event.peak)){capture.onLevel?.(Math.max(0,Math.min(1,event.peak)));return;}
      if(event.type==='speech-start'){
        if(!speechActive){speechActive=true;capture.onSpeechStart(Date.now());}return;
      }
      if(event.type==='transcript'&&typeof event.text==='string'&&event.text.length<=16384){input.onInterim?.(event.text);return;}
      if(event.type==='speech-end'&&typeof event.text==='string'&&event.text.length<=16384){
        // Ink's final endpoint already includes the provider's turn detection.
        // No second local 650/1200 ms silence timer belongs on this path.
        if(!speechActive){speechActive=true;capture.onSpeechStart(Date.now());}
        speechActive=false;capture.onSpeechEnd(Date.now());capture.onSegment(event.text.trim()||null);ended();
      }
    }catch(error){fail(error);}
  };
  const open=()=>opening??=(async()=>{
    try{
      check();const registered=await port.addListener('cloudSpeechEvent',receive);
      if(retired){await registered.remove();throw cancelled();}
      handle=registered;check();
      const result=await port.startCloudSpeech({sessionId,environment:input.environment,credentialId:input.credentialId});check();
      if(result.sessionId!==sessionId||result.sampleRate!==16000)throw Error('Cloud speech session changed.');
      opened=true;echoCancelled=result.echoCancelled===true;
    }catch(error){await stop().catch(()=>{});throw error;}
  })();
  return {
    async listen(handlers:AssistantListenHandlers):Promise<AssistantCapture>{
      check();handlers.signal.throwIfAborted();listening=handlers;
      if(ownerSignal&&ownerSignal!==handlers.signal)throw Error('Cloud speech owner changed.');
      if(!ownerSignal){ownerSignal=handlers.signal;ownerSignal.addEventListener('abort',ownerAborted,{once:true});}
      try{await open();check();handlers.signal.throwIfAborted();await port.setCloudSpeechMuted({sessionId,muted:false});check();}
      catch(error){await stop().catch(()=>{});throw error;}
      return {
        fullDuplex:echoCancelled,
        async close(){
          check();const final=speechActive?new Promise<void>(resolve=>ended=resolve):Promise.resolve();
          await port.setCloudSpeechMuted({sessionId,muted:true});
          let timer:ReturnType<typeof setTimeout>|undefined;
          try{await Promise.race([final,new Promise<void>((_,reject)=>{timer=setTimeout(()=>reject(Error('Cloud transcription did not finish after mute.')),2500);})]);}
          finally{if(timer)clearTimeout(timer);ended=()=>{};if(listening===handlers)listening=undefined;}
        },
        async cancel(){if(listening===handlers)listening=undefined;await stop();},
      };
    },
    async speak(text:string,signal:AbortSignal,onStarted:()=>void):Promise<void>{
      check();signal.throwIfAborted();if(!opened)throw Error('Cloud speech is not connected.');
      const value=text.trim();if(!value)return;
      if(value.length>4096)throw Error('Cloud speech phrase is too long.');
      const utteranceId=crypto.randomUUID();
      let reject!:(error:unknown)=>void;
      const done=new Promise<void>((resolve,failed)=>{reject=failed;utterances.set(utteranceId,{started:false,onStarted,resolve,reject:failed});});
      void done.catch(()=>{});
      let retiring:Promise<unknown>|undefined;
      const abort=()=>{if(retiring)return;retiring=Promise.resolve().then(()=>port.cancelCloudSpeech({sessionId,utteranceId})).catch(()=>{throw Object.assign(Error('Cloud speech cleanup was not confirmed.'),{code:'speech-cleanup-unconfirmed'});});void retiring.then(()=>reject(signal.reason??cancelled()),error=>reject(error));};
      signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
      try{signal.throwIfAborted();check();await port.speakCloudSpeech({sessionId,utteranceId,text:value});await done;signal.throwIfAborted();check();}
      finally{signal.removeEventListener('abort',abort);utterances.delete(utteranceId);await retiring;}
    },
    stop,
  };
}
