import {cloudRuntimeEnabled,testMocksEnabled} from '../build-flags';
import {createOnDeviceVoice} from './local-voice';
import {speakCloudText} from './cloud-voice';
import {confirmSpeechRetirement} from '../local-speech-playback';
import {connectionController} from './connection-ui';
import {markTtsPlaybackStarted,markTtsPlaybackEnded} from '../../../../.eliza/client-features/packages/ui/src/voice/tts-playback-activity.ts';
let retirement:Promise<void>=Promise.resolve();
/** Reviewed app/workflow text uses the selected production runtime profile. */
export async function speakAppText(text:string,signal:AbortSignal,onStarted?:()=>void,queue=false,assertCurrent?:()=>void){
 if(cloudRuntimeEnabled||testMocksEnabled)return speakCloudText(text,signal,onStarted,queue,assertCurrent);
 const owned=new AbortController(),cancel=()=>owned.abort(signal.reason),retire=()=>owned.abort(new DOMException('Voice review changed','AbortError'));
 const current=()=>{owned.signal.throwIfAborted();assertCurrent?.();if(document.hidden||connectionController.getSnapshot().open||document.documentElement.dataset.devBackground==='true')throw new DOMException('Voice review changed','AbortError');};
 signal.addEventListener('abort',cancel,{once:true});window.addEventListener('alpha:device-state',retire);window.addEventListener('pagehide',retire);if(signal.aborted)cancel();
 const previous=retirement;let admitted=false;
 const interrupted=new Promise<never>((_,reject)=>owned.signal.addEventListener('abort',()=>{if(!admitted)reject(owned.signal.reason);},{once:true}));void interrupted.catch(()=>{});
 const pending=(async()=>{
  current();const voice=createOnDeviceVoice();await confirmSpeechRetirement(previous);current();admitted=true;
  if(!voice||!await voice.playbackReady(owned.signal))throw Error('On-device speech is unavailable. Retry local speech or read the text.');
  current();let marked=false;
  try{await voice.speak(text,owned.signal,()=>{current();marked=true;markTtsPlaybackStarted();onStarted?.();},true,{queue,assertCurrent:current});current();}
  finally{if(marked)markTtsPlaybackEnded();}
 })();
 retirement=pending.catch(error=>{if(error?.code==='speech-cleanup-unconfirmed')throw error;});void retirement.catch(()=>{});
 try{await Promise.race([pending,interrupted]);}finally{signal.removeEventListener('abort',cancel);window.removeEventListener('alpha:device-state',retire);window.removeEventListener('pagehide',retire);}
}
