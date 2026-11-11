import {testMocksEnabled} from '../build-flags';
import {registerPlugin} from '../platform-plugins';
import {playOwnedSpeech} from '../local-speech-playback';
import {createOnDeviceVoice} from './local-voice';
import {createPairedVoice} from './paired-voice';
import {connectionController} from './connection-ui';
const native=registerPlugin<any>('AlphaVoiceCloud');
/** Approved page text stays native; the renderer passes only its one-use token.
 * Resident reading plays with Paradee-8M; it gates on playbackReady, which today waits for full speech readiness
 * because native prepares recognition and playback together.
 * Page text is never sent to Cloud or a provider, whatever the speech route (voice-selection.ts):
 * every build packages the on-device voice, so page reading always uses it. */
export function createNativeReadingVoice(){
 const resident=connectionController.getResidentReadingBinding();
 if(resident){
  const voice=createOnDeviceVoice();if(!voice)return null;
  const binding={...resident,expiresAt:Date.now()+120000};
  const isCurrent=()=>JSON.stringify(connectionController.getResidentReadingBinding())===JSON.stringify(resident);
  const check=()=>{if(!isCurrent()||document.hidden||connectionController.getSnapshot().open)throw new DOMException('Reading selection changed','AbortError');};
  return {binding,isCurrent,ready:voice.playbackReady,async speak(readingToken:string,signal:AbortSignal){
   check();const owned=new AbortController(),cancel=()=>owned.abort(new DOMException('Reading cancelled','AbortError'));
   const unsubscribe=connectionController.subscribe(()=>{try{check();}catch{cancel();}});
   const hidden=()=>{if(document.hidden)cancel();};document.addEventListener('visibilitychange',hidden);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
   try{await playOwnedSpeech(native,owned.signal,async requestId=>{const result=await native.synthesizeLocalBrowserReading({...binding,readingToken,requestId});if(result.execution!=='device')throw Error('Invalid local reading execution');return result;},check);}
   finally{unsubscribe();signal.removeEventListener('abort',cancel);document.removeEventListener('visibilitychange',hidden);}
  }};
 }
 if(!testMocksEnabled)return null;
 const binding=connectionController.getPairedVoiceBinding(),voice=createPairedVoice();if(!binding||!voice)return null;
 return {binding,isCurrent:()=>JSON.stringify(connectionController.getPairedVoiceBinding())===JSON.stringify(binding),ready:voice.ready,speak:(token:string,signal:AbortSignal)=>voice.speak('',signal,token)};
}
