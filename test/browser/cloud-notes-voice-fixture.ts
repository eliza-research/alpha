import {openLegacyNotes} from './helpers/legacy-notes';
import {expect,type Page} from '@playwright/test';
// Closed media/Cloud ports. No microphone, speech model, audio playback or provider HTTP.
export async function cloudNotesVoiceFixture(page:Page,signed=true,development=false){
 const foreign:string[]=[];
 await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,async route=>{foreign.push(route.request().url());await route.abort();});
 await page.addInitScript(()=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  const f=(window as any).cloudNotesVoice={owner:'a',mic:0,plays:0,starts:0,stops:0,uploads:0,local:0,paired:0,syntheses:0,cancels:0,active:null,clip:null,hold:false,billing:false,failureCode:null,denied:false,empty:false,transcript:'Closed Cloud transcript',requests:[]};
  Object.defineProperty(window,'AudioContext',{configurable:true,value:class{state='suspended';resume=async()=>{};close=async()=>{};}});
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{f.mic++;throw Error('Physical media forbidden');}}});
  HTMLMediaElement.prototype.play=async()=>{f.plays++;throw Error('Physical playback forbidden');};if(window.speechSynthesis)window.speechSynthesis.speak=()=>{f.plays++;throw Error('Local speech forbidden');};
 });
 await page.goto(development?'/?mode=dev':'/');
 await page.evaluate(async signed=>{
  const {BrowserVoice}=await import('/src/browser/voice.ts'),{connectionController:c}=await import('/src/runtime/connection-ui.tsx');const f=(window as any).cloudNotesVoice;
  c.getCloudEnvironment=()=>signed?'production':null;c.getCloudClient=()=>signed?{sessionId:'fixture-account-'+f.owner,credentialId:'fixture-credential-'+f.owner,client:{}} as any:null;
  BrowserVoice.prototype.localSpeechStatus=async()=>{f.local++;throw Error('Local preparation forbidden');};
  BrowserVoice.prototype.synthesizeLocal=async()=>{f.local++;throw Error('Local synthesis forbidden');};
  BrowserVoice.prototype.startRecording=async function(){f.starts++;if(f.denied)throw new DOMException('Denied','NotAllowedError');const recordingId=crypto.randomUUID();f.clip=recordingId;f.active=recordingId;(this as any).capture.clips.set(recordingId,{blob:new Blob(['closed-fixture'],{type:'audio/webm'}),durationMs:1000});return {recordingId,maxDurationMs:59000};};
  BrowserVoice.prototype.stopRecording=async()=>{f.stops++;f.active=null;return {recordingId:f.clip,durationMs:1000};};
  BrowserVoice.prototype.cancelRecording=async()=>{f.active=null;f.cancels++;};
  BrowserVoice.prototype.transcribeRecording=async(input:any)=>{f.uploads++;f.requests.push(input);if(f.hold)await new Promise<void>(resolve=>{f.release=resolve;});if(f.billing)throw Object.assign(Error('Synthetic billing refusal'),{code:'voice-http-402'});if(f.failureCode)throw Object.assign(Error('PRIVATE_TRANSCRIPTION_SENTINEL'),{code:f.failureCode,...(f.failureData?{data:f.failureData}:{})});return {text:f.empty?'':f.transcript,local:false};};
  BrowserVoice.prototype.transcribePairedRecording=async()=>{f.paired++;throw Error('Paired transcription forbidden');};
  BrowserVoice.prototype.synthesize=async()=>{f.syntheses++;return {playbackId:crypto.randomUUID()};};
  BrowserVoice.prototype.play=async function(input:any){queueMicrotask(()=>void (this as any).notifyListeners('playbackEnded',{playbackId:input.playbackId}));};
  BrowserVoice.prototype.stopPlayback=async()=>{};BrowserVoice.prototype.cancel=async()=>{f.cancels++;};
  // The Notes recorder (no length limit) runs on its own capture: a closed one-segment recording.
  const {BrowserAudioCapture}=await import('/src/browser/audio-capture.ts');const capture=BrowserAudioCapture.prototype as any;
  capture.start=async function(input:any){f.starts++;if(f.denied)throw new DOMException('Denied','NotAllowedError');const recordingId=crypto.randomUUID();f.clip=recordingId;f.active=recordingId;this.fixture={recordingId};return {recordingId,maxDurationMs:input?.unlimited?Infinity:59000};};
  capture.stop=async function(){const recordingId=this.fixture?.recordingId;f.stops++;f.active=null;this.clips.set(recordingId,{blob:new Blob(['closed-fixture'],{type:'audio/webm'}),durationMs:1500});return {recordingId,durationMs:1500};};
  capture.pause=function(){};capture.resume=function(){};
  capture.elapsed=function(id:string){return this.fixture?.recordingId===id?1500:0;};
  capture.metrics=function(id:string){return {recordingId:id,peak:0};};
  capture.cancel=function(){if(this.fixture){f.active=null;f.cancels++;}this.fixture=undefined;};
 },signed);
 return {foreign};
}
export const notesRecorder=(page:Page)=>page.locator('[data-alpha-subview="notes-recorder"]');
export async function openNotesRecorder(page:Page){await openLegacyNotes(page);await page.getByRole('button',{name:'Record and transcribe',exact:true}).click();}
/** The recorder starts at once; Done stops it, transcribes its segment and saves the voice note. */
export async function recordAndFinish(page:Page){const panel=notesRecorder(page);await expect(panel).toHaveAttribute('data-recorder-state','recording');await panel.getByRole('button',{name:'Done',exact:true}).click();}
export const savedVoiceNotes=(page:Page)=>page.evaluate(async()=>JSON.parse((await(await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())||'{"records":[]}').records.filter((n:any)=>n.kind==='voice'));
export async function noPhysicalOrLocalVoice(page:Page){expect(await page.evaluate(()=>{const f=(window as any).cloudNotesVoice;return {mic:f.mic,plays:f.plays,local:f.local,paired:f.paired};})).toEqual({mic:0,plays:0,local:0,paired:0});}
