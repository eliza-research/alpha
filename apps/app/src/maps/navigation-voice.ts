import { NavigationVoice as SharedNavigationVoice } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/navigation-voice.ts';
import { createOnDeviceVoice } from '../runtime/local-voice';
import { speakAppText } from '../runtime/app-speech';
import { connectionController } from '../runtime/connection-ui';
import { speechRoute } from '../runtime/voice-selection';

type Instruction = {key:string;text:string;current:()=>boolean};
/** Screen-off guidance waits for foreground playback; only the current instruction may resume. */
export class NavigationVoice extends SharedNavigationVoice {
 private latest?:Instruction;
 private owed?:Instruction;
 private readonly resume=()=>{
  if(document.hidden)return;
  document.removeEventListener('visibilitychange',this.resume);
  const owed=this.owed,latest=this.latest;this.owed=undefined;
  if(!this.canSpeak()){this.pause();return;}
  if(!latest||owed!==latest||!this.enabled||!latest.current())return;
  this.pause();this.update(latest.key,latest.text);
 };
 constructor(failed:(error?:unknown)=>void,private readonly canSpeak:()=>boolean=()=>true) {
  let failure:unknown,self:NavigationVoice|undefined;
  super(()=>failed(failure),async(text,signal)=>{
   if(!canSpeak())return;
   const instruction=self?.latest;
   if(document.hidden){self?.owe(instruction);return;}
   let hiddenDuringSpeech=false;
   const hidden=()=>{if(document.hidden)hiddenDuringSpeech=true;};
   document.addEventListener('visibilitychange',hidden);
   try{
    // Network speech goes through the app speaker, which falls back to this phone.
    if(speechRoute()!=='device'){await speakAppText(text,signal);return;}
    const voice=createOnDeviceVoice();
    if(!voice||!await voice.playbackReady(signal))throw Error('On-device navigation speech is unavailable.');
    if(signal.aborted)return;
    if(!canSpeak()){if(self&&self.latest===instruction)self.pause();return;}
    await voice.speak(text,signal);
   }catch(error){
    // Visibility interruption is resumable, but account changes, explicit Stop and provider failures are not.
    if(hiddenDuringSpeech&&(error as {name?:string})?.name==='AbortError'&&(error as {code?:unknown})?.code!=='speech-cleanup-unconfirmed'&&!signal.aborted&&instruction?.current()){
     self?.owe(instruction);return;
    }
    failure=error;throw error;
   }finally{document.removeEventListener('visibilitychange',hidden);}
  });
  self=this;
 }
 override update(key:string,text:string) {
  if(!this.canSpeak()){this.pause();return;}
  if(this.latest?.key!==key||this.latest.text!==text){
   const selected=connectionController.getSnapshot(),binding=connectionController.getCloudClient(),environment=connectionController.getCloudEnvironment(),mode=document.documentElement.dataset.connectionMode;
   const session=selected.session,inference=selected.residentInference,providerRevision=selected.providerStatus?.revision,sessionId=binding?.sessionId,credentialId=binding?.credentialId;
   this.latest={key,text,current:()=>{
    const now=connectionController.getSnapshot(),cloud=connectionController.getCloudClient();
    return !now.open&&session===now.session&&inference===now.residentInference&&providerRevision===now.providerStatus?.revision&&environment===connectionController.getCloudEnvironment()&&sessionId===cloud?.sessionId&&credentialId===cloud?.credentialId&&mode===document.documentElement.dataset.connectionMode;
   }};
  }
  super.update(key,text);
 }
 override pause() { super.pause();this.latest=undefined;this.owed=undefined;document.removeEventListener('visibilitychange',this.resume); }
 override toggle() {
  if(!this.canSpeak()){this.pause();return;}
  super.toggle();if(!this.enabled){this.owed=undefined;document.removeEventListener('visibilitychange',this.resume);}
 }
 private owe(instruction?:Instruction) {
  if(!instruction||instruction!==this.latest||!instruction.current()||!this.enabled||!this.canSpeak())return;
  this.owed=instruction;document.addEventListener('visibilitychange',this.resume);
  if(!document.hidden)queueMicrotask(this.resume);
 }
}
