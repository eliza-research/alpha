import { NavigationVoice as SharedNavigationVoice } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/navigation-voice.ts';
import { createOnDeviceVoice } from '../runtime/local-voice';
import { speakAppText } from '../runtime/app-speech';
import { cloudRuntimeEnabled } from '../build-flags';
/**
 * Speech is foreground-only, so a step skipped or cut off while the screen is off is owed, not a
 * failure: voice stays on and only the current step is spoken once the screen is on again.
 * Speaking with the screen off needs a native playback lease the pinned speech bridge lacks.
 * The Cloud QA profile speaks through the app's Cloud route, which carries its disclosure.
 */
export class NavigationVoice extends SharedNavigationVoice {
 private latest?:{key:string;text:string};
 private owed?:string;
 private readonly resume=()=>{
  if(document.hidden)return;
  document.removeEventListener('visibilitychange',this.resume);
  const owed=this.owed,latest=this.latest;this.owed=undefined;
  if(!latest||owed!==latest.key||!this.enabled)return;
  this.pause();this.update(latest.key,latest.text);
 };
 constructor(failed:(error?:unknown)=>void) {
  let failure:unknown,self:NavigationVoice|undefined;
  super(()=>failed(failure),async(text,signal)=>{
   const key=self?.latest?.key;
   if(document.hidden){self?.owe(key);return;}
   try{
    if(cloudRuntimeEnabled){await speakAppText(text,signal);return;}
    const voice=createOnDeviceVoice();if(!voice||!await voice.playbackReady(signal))throw Error('On-device navigation speech is unavailable.');await voice.speak(text,signal);
   }catch(error){if(document.hidden&&!signal.aborted){self?.owe(key);return;}failure=error;throw error;}
  });
  self=this;
 }
 override update(key:string,text:string) { this.latest={key,text};super.update(key,text); }
 override pause() { super.pause();this.latest=undefined;this.owed=undefined;document.removeEventListener('visibilitychange',this.resume); }
 private owe(key?:string) { if(!key)return;this.owed=key;document.addEventListener('visibilitychange',this.resume); }
}
