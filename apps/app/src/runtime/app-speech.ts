import {testMocksEnabled} from '../build-flags';
import {speechCleanupNotice} from './voice-states';
import {speechRoute,noteNetworkSpeechFailure} from './voice-selection';
import {createOnDeviceVoice} from './local-voice';
import {speakCloudText} from './cloud-voice';
import {confirmSpeechRetirement} from '../local-speech-playback';
import {connectionController} from './connection-ui';
import {markTtsPlaybackStarted,markTtsPlaybackEnded} from '../../../../.eliza/client-features/packages/ui/src/voice/tts-playback-activity.ts';
let retirement:Promise<void>=Promise.resolve();
function appSpeechError(error: unknown): unknown {
 const notice = speechCleanupNotice(error);
 return notice ? Object.assign(new Error(notice, {cause: error}), {code: 'speech-cleanup-unconfirmed'}) : error;
}
/** Reviewed app/workflow text follows the run-time speech route (voice-selection.ts): Cloud or the
 * owner's Cartesia key when available, otherwise this phone. A network request that fails before
 * any audio plays is spoken on this phone instead; its error is kept only when that is unavailable too. */
export async function speakAppText(text:string,signal:AbortSignal,onStarted?:()=>void,queue=false,assertCurrent?:()=>void){
 const network=speechRoute()!=='device';let networkFailure:unknown;
 if(network||testMocksEnabled){
  let audible=false;
  try{await speakCloudText(text,signal,()=>{audible=true;onStarted?.();},queue,assertCurrent);return;}
  catch(error){if(!network||audible||signal.aborted||!noteNetworkSpeechFailure(error))throw appSpeechError(error);networkFailure=error;}
 }
 const owned=new AbortController(),cancel=()=>owned.abort(signal.reason),retire=()=>owned.abort(new DOMException('Voice review changed','AbortError'));
 const current=()=>{owned.signal.throwIfAborted();assertCurrent?.();if(document.hidden||connectionController.getSnapshot().open||document.documentElement.dataset.devBackground==='true')throw new DOMException('Voice review changed','AbortError');};
 signal.addEventListener('abort',cancel,{once:true});window.addEventListener('alpha:device-state',retire);window.addEventListener('pagehide',retire);if(signal.aborted)cancel();
 const previous=retirement;let admitted=false;
 const interrupted=new Promise<never>((_,reject)=>owned.signal.addEventListener('abort',()=>{if(!admitted)reject(owned.signal.reason);},{once:true}));void interrupted.catch(()=>{});
 const pending=(async()=>{
  current();const voice=createOnDeviceVoice();await confirmSpeechRetirement(previous);current();admitted=true;
  if(!voice||!await voice.playbackReady(owned.signal))throw networkFailure??Error('On-device speech is unavailable. Retry local speech or read the text.');
  current();let marked=false;
  try{await voice.speak(text,owned.signal,()=>{current();marked=true;markTtsPlaybackStarted();onStarted?.();},true,{queue,assertCurrent:current});current();}
  finally{if(marked)markTtsPlaybackEnded();}
 })();
 retirement=pending.catch(error=>{if(error?.code==='speech-cleanup-unconfirmed')throw error;});void retirement.catch(()=>{});
 try{await Promise.race([pending,interrupted]);}catch(error){throw appSpeechError(error);}finally{signal.removeEventListener('abort',cancel);window.removeEventListener('alpha:device-state',retire);window.removeEventListener('pagehide',retire);}
}
