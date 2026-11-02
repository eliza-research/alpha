import type {Page} from '@playwright/test';

/** Actual Cloud controller with closed synthesis/playback ports; no provider or media. */
export async function genericCloudSpeechFixture(page:Page,stateName='speechTest'){
 await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,route=>route.abort());
 await page.evaluate(async name=>{
  const {BrowserVoice}=await import('/src/browser/voice.ts'),{connectionController:c}=await import('/src/runtime/connection-ui.tsx'),state=(window as any)[name];
  c.getCloudEnvironment=()=> 'production';c.getCloudClient=()=>({sessionId:'synthetic-cloud-account',credentialId:'synthetic-cloud-credential',client:{}} as any);
  const prepared=new Map<string,{text:string;requestId:string}>(),original=BrowserVoice.prototype.play;
  BrowserVoice.prototype.synthesize=async function(input:any){
   if(input.replace===false&&((this as any).activeSpeechId||(this as any).audio||(this as any).pendingAudioId||(this as any).speechRequests.has('stt')||(this as any).speechRequests.has('tts')))throw Object.assign(Error('Synthetic speaker busy'),{code:'playback-busy'});
   return (this as any).withAgentSpeech('tts',async(signal:AbortSignal)=>{
    if(state.holdSynthesis)await new Promise<void>((resolve,reject)=>{state.releaseSynthesis=resolve;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});signal.throwIfAborted();
    if(state.billing)throw Object.assign(Error('Synthetic billing refusal'),{code:'voice-http-402'});
    const playbackId=crypto.randomUUID();prepared.set(playbackId,{text:input.text,requestId:input.requestId});(this as any).agentAudio.set(playbackId,{requestId:input.requestId});return {playbackId};
   },input.requestId);
  };
  BrowserVoice.prototype.play=async function(input:any){
   const selected=prepared.get(input.playbackId);if(!selected)return original.call(this,input);
   if(input.replace===false&&((this as any).activeSpeechId||(this as any).audio||(this as any).pendingAudioId))throw Object.assign(Error('Synthetic speaker busy'),{code:'playback-busy'});
   await this.stopPlayback();const own=this as any;own.activeSpeechId=input.playbackId;own.activeSpeechRequestId=selected.requestId;
   const player={src:'',onended:null,onerror:null,pause:()=>state.cancelled++,removeAttribute(){},load(){}};own.audio=player;
   const finish=(event:string)=>{if(own.audio!==player||own.activeSpeechId!==input.playbackId)return;own.audio=undefined;own.activeSpeechId=undefined;own.activeSpeechRequestId=undefined;own.agentAudio.delete(input.playbackId);void own.notifyListeners(event,{playbackId:input.playbackId});};
   const control={text:selected.text,onend:()=>finish('playbackEnded'),onerror:()=>finish('playbackFailed')};state.spoken.push(selected.text);state.utterance=control;state.current=control;
  };
 },stateName);
}
