import {browserLocalSpeechStatus,transcribeWithSelectedBrowserAgent} from './local-transcription';
import {devSurfacesEnabled} from '../build-flags';
import {browserCloudVoice,browserCloudCredential} from './cloud-connection';
import type {LocalAgentProtocol} from '../runtime/local-agent';
import {browserSpeechConnection as connectionController} from './agent-speech';
import {recordingPcmWav} from '../../../../.eliza/client-features/packages/voice/src/browser-capture/recording-pcm.ts';
import {browserMediaVolume} from './audio-settings';
import {audioRecord,audioMetadata,retainAudio,changeAudioDeleted,audioDeletionStatus,migrateAudio,purgeAudio} from './note-audio-store';
import { speechError, speechCancelled, type SpeechRequestKind, type SpeechCancelReason } from './speech-errors';
import { BrowserAudioCapture } from './audio-capture';
import { WebPlugin } from '@capacitor/core';
// Recordings stay local until transcription is requested. The selected Cloud or
// explicit local/development route owns processing; provider credentials stay off-page.
// There is no in-browser speech engine: local recognition and Paradee-8M playback run on the
// private local agent, which uses the native llama.cpp-based libelizainference stack.
/** Recorded time per Notes segment in the browser, as the native recorder bounds its segments. */
const NOTE_SEGMENT_MS=25_000;
export class BrowserVoice extends WebPlugin {
 private connection=Promise.resolve(connectionController).then(connectionController=>{
  const selected=()=>JSON.stringify([connectionController.getSnapshot().session?.sessionId,connectionController.getCloudEnvironment(),connectionController.getCloudClient()?.sessionId,connectionController.getCloudClient()?.credentialId,connectionController.getSnapshot().residentInference,connectionController.getSnapshot().providerStatus?.revision]);
  let binding=selected();
  connectionController.subscribe(()=>{const next=selected();if(next!==binding){binding=next;void this.releaseLocalSpeech();}});
  return connectionController;
 });
 private speechRequests=new Map<SpeechRequestKind,{controller:AbortController;requestId?:string}>();
 private capture=new BrowserAudioCapture(event=>{void this.notifyListeners('recordingStopped',event);});
 // Notes recording: its own capture, unlimited and paused only by the user. Leaving the page
 // does not end it. Like the native recorder it finishes a segment of at most 25 s of recorded
 // time as it goes (each fits every transcription request bound); the whole recording is kept
 // for the saved note.
 private noteCapture=new BrowserAudioCapture(event=>{const note=this.note;if(note&&event.recordingId===note.recordingId&&note.state!=='stopped'){note.state='stopped';note.stopReason='error';this.noteChanged();}});
 private note?:{recordingId:string;binding:import('../prototype/note-recorder').NoteRecordingBinding;state:'recording'|'paused'|'stopped';stopReason?:string;durationMs:number;segments:{segmentId:string;durationMs:number;text?:string}[]};
 private noteSegments=new Map<string,{blob:Blob;durationMs:number}>();
 private clip(id:string){return this.capture.get(id)??this.noteCapture.get(id)??this.noteSegments.get(id);}
 private noteChanged(){void this.notifyListeners('noteRecordingChanged',this.noteStatus());}
 private noteStatus(){
  const note=this.note;if(!note)return {state:'idle'};
  const live=note.state!=='stopped';
  let peak=0;if(note.state==='recording')try{peak=this.noteCapture.metrics(note.recordingId).peak;}catch{/* Not sampled yet. */}
  return {state:note.state,recordingId:note.recordingId,binding:{...note.binding},recovered:false,...(note.stopReason?{stopReason:note.stopReason}:{}),durationMs:live?this.noteCapture.elapsed(note.recordingId):note.durationMs,segments:note.segments.map(segment=>({...segment})),peak};
 }
 private ownedNote(recordingId:string){const note=this.note;if(!note||note.recordingId!==recordingId)throw Error('Recording changed.');return note;}
 async startNoteRecording(binding:import('../prototype/note-recorder').NoteRecordingBinding){
  if(this.note)throw Error('A recording is already open.');
  if(!binding||!/^[a-f0-9]{64}$/.test(binding.ownerDigest)||binding.folderId!==null&&!/^f-[A-Za-z0-9_-]{1,64}$/.test(binding.folderId))throw Error('Invalid recording ownership');
  this.noteSegments.clear();
  let recordingId='';
  const started=await this.noteCapture.start({unlimited:true,segmentMs:NOTE_SEGMENT_MS,onSegment:segment=>{
   const note=this.note;if(!note||note.recordingId!==recordingId)return;
   const segmentId=`${recordingId}-s${segment.index}`;this.noteSegments.set(segmentId,{blob:segment.blob,durationMs:segment.durationMs});
   note.segments.push({segmentId,durationMs:segment.durationMs});if(note.state!=='stopped')this.noteChanged();
  }});
  recordingId=started.recordingId;
  this.note={recordingId:started.recordingId,binding:{...binding},state:'recording',durationMs:0,segments:[]};this.noteChanged();return this.noteStatus();
 }
 async noteRecordingStatus(){return this.noteStatus();}
 async pauseNoteRecording(input:{recordingId:string}){const note=this.ownedNote(input.recordingId);if(note.state==='recording'){this.noteCapture.pause();note.state='paused';this.noteChanged();}return this.noteStatus();}
 async resumeNoteRecording(input:{recordingId:string}){const note=this.ownedNote(input.recordingId);if(note.state==='paused'){this.noteCapture.resume();note.state='recording';this.noteChanged();}else if(note.state==='stopped')throw Error('This recording has ended.');return this.noteStatus();}
 async stopNoteRecording(input:{recordingId:string}){
  const note=this.ownedNote(input.recordingId);
  if(note.state!=='stopped'){const clip=await this.noteCapture.stop();if(this.note!==note)throw Error('Recording changed.');note.durationMs=clip.durationMs;if(!note.segments.length)note.segments=[{segmentId:clip.recordingId,durationMs:clip.durationMs}];note.state='stopped';note.stopReason='user';this.noteChanged();}
  return this.noteStatus();
 }
 async discardNoteRecording(input:{recordingId?:string}){if(this.note&&(!input.recordingId||this.note.recordingId===input.recordingId)){this.noteCapture.cancel();this.noteSegments.clear();this.note=undefined;this.noteChanged();}return this.noteStatus();}
 async setNoteSegmentText(input:{recordingId:string;segmentId:string;text:string}){const segment=this.ownedNote(input.recordingId).segments.find(s=>s.segmentId===input.segmentId);if(!segment||typeof input.text!=='string')throw Error('Recording changed.');segment.text=input.text;}
 async saveNoteRecording(input:{recordingId:string;noteId:string;transcript:string}){
  const note=this.ownedNote(input.recordingId);if(note.state!=='stopped'||!note.segments.length)throw Error('Stop the recording first.');
  // Repeatable until discarded: the renderer discards once the note itself is saved.
  return this.saveRecording({recordingId:note.recordingId,noteId:input.noteId,transcript:input.transcript});
 }
 private speech=new Map<string,{text:string;requestId?:string}>();
 private agentAudio=new PreparedAudio();
 private audio?:HTMLAudioElement;
 private audioId?:string;
 private pendingAudioId?:string;
 private audioChanges=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('alpha.browser.audio.changes'):undefined;
 private playbackGeneration=0;
 private playbackAbort?:AbortController;
 private activeSpeechId?:string;
 private activeSpeechRequestId?:string;
 constructor(){super();
  window.addEventListener('alpha:device-settings',()=>{if(this.audio)this.audio.volume=browserMediaVolume();});
  if(this.audioChanges)this.audioChanges.onmessage=event=>{if(event.data?.deleted&&[this.audioId,this.pendingAudioId].includes(event.data.audioId))void this.stopPlayback();};
  void migrateAudio().catch(()=>{});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)void this.cancel(undefined,'hidden');});
  window.addEventListener('pagehide',()=>{void this.cancel(undefined,'pagehide');});
  window.addEventListener('alpha:device-state',()=>{void this.cancel(undefined,'device-state');});
 }
 async localSpeechStatus(){return this.withAgentSpeech('status',async signal=>{
  // The entrypoint binds this facade after browser factories have registered.
  const connectionController=await this.connection;signal.throwIfAborted();
  if(connectionController.getBrowserSpeechAgent())return browserLocalSpeechStatus(()=>connectionController.getBrowserSpeechAgent(),signal);
  // No agent speech yet: the browser never loads a model, inference runtime or Web Speech voice
  // itself (speech runs only through the agent's libelizainference). Replies are read as text.
  return {ready:false,playback:false,execution:'browser',route:'local-agent',reason:['starting','recovering'].includes(connectionController.getSnapshot().kind??'')?'local-agent-starting':'local-agent-required'};
 });}
 getRecordingMetrics(input:{recordingId:string}){return Promise.resolve(this.capture.metrics(input.recordingId));}
 startRecording(input:{maxDurationMs?:number}={}){return this.capture.start(input);}
 stopRecording(){return this.capture.stop();}
 async cancelRecording(){this.capture.cancel();}
 async transcribeLocalRecording(input:{recordingId:string;requestId?:string}){
  const requestId=input.requestId;
  const clip=this.clip(input.recordingId);if(!clip)throw Error('Record a clip first.');
  return this.withAgentSpeech('stt',async signal=>{
   const connectionController=await this.connection;signal.throwIfAborted();
   // No silent fallback to Cloud or to an in-browser engine; the recording stays in this app.
   if(!connectionController.getBrowserSpeechAgent())throw speechError('local-agent-required','Connect the local agent to transcribe on this computer.');
   return transcribeWithSelectedBrowserAgent(()=>connectionController.getBrowserSpeechAgent(),()=>recordingPcmWav(clip.blob,signal),signal);
  },requestId);
 }

 private async cloudBinding(input:{environment:string;credentialId:string}) {
  if(!devSurfacesEnabled)throw Error('Cloud voice requires the native app or a development host.');
  const connection=await this.connection,binding=connection.getCloudClient();
  if(!binding||connection.getCloudEnvironment()!==input.environment||binding.credentialId!==input.credentialId)throw Object.assign(Error('Sign in to Cloud before using voice.'),{code:'voice-http-401'});
  const current=()=>{const next=connection.getCloudClient();if(document.hidden||connection.getCloudEnvironment()!==input.environment||next?.sessionId!==binding.sessionId||next.credentialId!==binding.credentialId)throw new DOMException('Cloud account changed','AbortError');};
  current();return {sessionId:binding.sessionId,current};
 }
 async transcribeRecording(input:{recordingId:string;requestId:string;environment:string;credentialId:string}){
  if(!devSurfacesEnabled)throw Error('Cloud voice requires the native app or a development host.');
  return this.withAgentSpeech('stt',async signal=>{
   const binding=await this.cloudBinding(input),clip=this.clip(input.recordingId);if(!clip)throw Error('Record a clip first.');
   const response=await browserCloudVoice(input,'stt',clip.blob,signal),result=await response.json();signal.throwIfAborted();binding.current();
   if(result.local!==false||typeof result.text!=='string'||!result.text.trim())throw Error('Cloud returned no usable transcript.');
   return {text:result.text,local:false};
  },input.requestId);
 }
 async synthesize(input:{text:string;requestId:string;environment:string;credentialId:string;replace?:boolean}){
  if(!devSurfacesEnabled)throw Error('Cloud voice requires the native app or a development host.');
  if(input.replace===false&&(this.activeSpeechId||this.audio||this.pendingAudioId||this.speechRequests.has('stt')||this.speechRequests.has('tts')))throw Object.assign(Error('Playback is busy.'),{code:'playback-busy'});
  return this.withAgentSpeech('tts',async signal=>{
   const binding=await this.cloudBinding(input),response=await browserCloudVoice(input,'tts',input.text,signal),blob=await response.blob();signal.throwIfAborted();binding.current();
   if(!blob.size||blob.size>8*1024*1024||!['audio/mpeg','audio/mp3','audio/wav'].includes(blob.type.split(';')[0]))throw Error('Cloud returned no usable speech.');
   const playbackId=crypto.randomUUID();this.agentAudio.set(playbackId,{blob,requestId:input.requestId,sessionId:binding.sessionId,cloud:{environment:input.environment,credentialId:input.credentialId}});
   while(this.agentAudio.size>8)this.agentAudio.delete(this.agentAudio.keys().next().value!);
   return {playbackId};
  },input.requestId);
 }
 async transcribeDevelopmentCloudRecording(input:{recordingId:string;requestId:string;route?:'cloud'|'direct'}){
  const clip=this.clip(input.recordingId);if(!clip)throw Error('Record a clip first.');
  return this.withAgentSpeech('stt',async signal=>{const connection=await this.connection,agent=connection.getBrowserSpeechAgent(),snapshot=connection.getSnapshot(),route=input.route??'cloud',session=agent?.session,revision=snapshot.providerStatus?.revision;
   if(!agent||!session)throw Error('Connect the resident agent first.');
   const current=()=>{signal.throwIfAborted();const now=connection.getSnapshot();if(agent!==connection.getBrowserSpeechAgent()||agent.session!==session||(route==='direct'?(now.residentInference!=='direct'||now.providerStatus?.voiceConfigured!==true||now.providerStatus?.revision!==revision):now.residentInference==='direct'))throw new DOMException('Voice selection changed','AbortError');};
   current();const audio=await recordingPcmWav(clip.blob,signal);current();const result=await agent.developmentCloudSpeech({kind:'asr',audio},signal,route);current();if(!('local' in result))throw Error('Transcription returned no text.');return result;},input.requestId);
 }
 async synthesizeDevelopmentCloud(input:{text:string;requestId:string;replace?:boolean;route?:'cloud'|'direct'}){
  if(input.replace===false&&(this.activeSpeechId||this.audio||this.pendingAudioId||this.speechRequests.has('stt')||this.speechRequests.has('tts')))throw Object.assign(Error('Playback is busy.'),{code:'playback-busy'});
  return this.withAgentSpeech('tts',async signal=>{const connection=await this.connection,agent=connection.getBrowserSpeechAgent(),sessionId=agent?.session?.sessionId;if(!agent||!sessionId)throw Error('Connect the developer agent first.');
   // Cloud read-aloud arrives as a stream that plays while it downloads. Without MediaSource it is
   // buffered whole, as before streaming; a direct route's WAV is always whole.
   let audio=await agent.developmentCloudSpeech({kind:'tts',text:input.text},signal,input.route??'cloud');
   try{
    if(audio instanceof ReadableStream&&!streamedSpeechSupported())audio=new Blob([await new Response(audio).arrayBuffer()],{type:'audio/mpeg'});
    signal.throwIfAborted();if(agent!==connection.getBrowserSpeechAgent()||agent.session?.sessionId!==sessionId||!(audio instanceof Blob||audio instanceof ReadableStream))throw new DOMException('Voice selection changed','AbortError');
   }catch(error){if(audio instanceof ReadableStream)void audio.cancel(error).catch(()=>{});throw error;}
   const playbackId=crypto.randomUUID();this.agentAudio.set(playbackId,{...(audio instanceof Blob?{blob:audio}:{stream:new StreamedSpeech(audio)}),requestId:input.requestId,agent,sessionId});while(this.agentAudio.size>8)this.agentAudio.delete(this.agentAudio.keys().next().value!);return {playbackId};},input.requestId);
 }
 async synthesizeLocal(input:{text:string;requestId?:string}){
  const {text,requestId}=input;
  if(typeof text!=='string'||!text.trim()||text.length>16000)throw Error('Choose text between 1 and 16000 characters.');
  return this.withAgentSpeech('tts',async signal=>{
  const connectionController=await this.connection;signal.throwIfAborted();
  const agent=connectionController.getBrowserSpeechAgent();
  if(agent){
   const sessionId=agent.session?.sessionId;if(!sessionId)throw Error('Connect the local agent first.');
   const blob=await agent.synthesizeSpeech(text,signal);signal.throwIfAborted();
   if(connectionController.getBrowserSpeechAgent()!==agent||agent.session?.sessionId!==sessionId)throw new DOMException('Voice selection changed','AbortError');
   const playbackId=crypto.randomUUID();this.agentAudio.set(playbackId,{blob,requestId,agent,sessionId});
   while(this.agentAudio.size>8)this.agentAudio.delete(this.agentAudio.keys().next().value!);
   return {playbackId,execution:'browser'};
  }
  // No Web Speech fallback: without agent speech the reply is read as text.
  const starting=['starting','recovering'].includes(connectionController.getSnapshot().kind??'');
  throw speechError(starting?'local-agent-starting':'local-agent-required',starting?'Your agent is starting. Read the reply as text.':'Speech needs the local agent on this computer. Read the reply as text.');
  },requestId);
 }
 private releaseAudio(audio:HTMLAudioElement){
  audio.onended=null;audio.onerror=null;audio.pause();const url=audio.src;audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);
  if(this.audio===audio){this.audio=undefined;this.audioId=undefined;}
 }
 async play(input:{playbackId?:string;audioId?:string;replace?:boolean}){
  if(input.replace===false){
   if(document.hidden||document.documentElement.dataset.devBackground==='true'||Array.from(document.querySelectorAll('[aria-label="Unlock with fingerprint"], [aria-label="Wake"]')).some(element=>element.getClientRects().length))throw new DOMException('Playback cancelled','AbortError');
   if(this.activeSpeechId||this.audio||this.pendingAudioId)throw Object.assign(Error('Playback is busy.'),{code:'playback-busy'});
  }
  void this.stopPlayback();const generation=this.playbackGeneration,abort=new AbortController();this.playbackAbort=abort;
  const current=()=>generation===this.playbackGeneration&&!abort.signal.aborted;
  try{
  if(document.hidden)throw new DOMException('Playback cancelled','AbortError');
  if(!!input.playbackId===!!input.audioId)throw Error('Choose one recording or prepared speech.');
  if(input.playbackId){
   this.activeSpeechId=input.playbackId;
   const prepared=this.agentAudio.get(input.playbackId);
   this.activeSpeechRequestId=prepared?.requestId??this.speech.get(input.playbackId)?.requestId;
   if(prepared){
    const connectionController=await this.connection;
    if(!current())throw new DOMException('Playback cancelled','AbortError');
    if(prepared.cloud){if(!devSurfacesEnabled)throw Error('Cloud voice requires a development host.');await browserCloudCredential(prepared.cloud.environment,prepared.cloud.credentialId,abort.signal);if(!current())throw new DOMException('Playback cancelled','AbortError');}
    const cloud=connectionController.getCloudClient();
    const stale=prepared.cloud ? connectionController.getCloudEnvironment()!==prepared.cloud.environment||cloud?.credentialId!==prepared.cloud.credentialId||cloud?.sessionId!==prepared.sessionId : !prepared.agent||connectionController.getBrowserSpeechAgent()!==prepared.agent||prepared.agent.session?.sessionId!==prepared.sessionId;
    if(stale){this.agentAudio.delete(input.playbackId);throw new DOMException('Voice selection changed','AbortError');}
    // A streamed clip starts on its first frames; Stop (abort) ends its download with the playback.
    const source=prepared.stream?streamedSpeechSource(prepared.stream,abort.signal):undefined;
    const url=source?.url??URL.createObjectURL(prepared.blob!);let audio:HTMLAudioElement;
    try{audio=new Audio(url);audio.volume=browserMediaVolume();}catch(error){URL.revokeObjectURL(url);throw error;}
    this.audio=audio;
    const finish=(event:'playbackEnded'|'playbackFailed')=>{if(!current()||this.audio!==audio)return;this.releaseAudio(audio);this.activeSpeechId=undefined;this.activeSpeechRequestId=undefined;this.agentAudio.delete(input.playbackId!);void this.notifyListeners(event,{playbackId:input.playbackId});};
    audio.onended=()=>finish('playbackEnded');audio.onerror=()=>finish('playbackFailed');
    // A clip whose download fails part way is a failed reading, never a finished one.
    void source?.fed.catch(()=>finish('playbackFailed'));
    try{const playing=audio.play();void playing.then(()=>{if(!current())audio.pause();},()=>{});await playbackWait(playing,abort.signal);if(!current())throw new DOMException('Playback cancelled','AbortError');return;}
    catch(error){if(this.audio===audio)finish('playbackFailed');throw error;}
   }
   throw Error('Prepare speech first.');
  }
  this.pendingAudioId=input.audioId;
  const row=await playbackWait(audioRecord(input.audioId!),abort.signal);
  if(!current())throw new DOMException('Playback cancelled','AbortError');
  const url=URL.createObjectURL(row.blob);let audio:HTMLAudioElement;
  try{audio=new Audio(url);audio.volume=browserMediaVolume();}catch(error){URL.revokeObjectURL(url);throw error;}
  this.audio=audio;this.audioId=input.audioId;this.pendingAudioId=undefined;
  const finish=(event:'playbackEnded'|'playbackFailed')=>{if(!current()||this.audio!==audio)return;this.releaseAudio(audio);void this.notifyListeners(event,{audioId:input.audioId});void this.notifyListeners(event==='playbackEnded'?'ended':'failed',{audioId:input.audioId});};
  audio.onended=()=>finish('playbackEnded');audio.onerror=()=>finish('playbackFailed');
  try{
   const playing=audio.play();
   void playing.then(()=>{if(!current())audio.pause();},()=>{});
   await playbackWait(playing,abort.signal);
   if(!current())throw new DOMException('Playback cancelled','AbortError');
   const receipt={audioId:input.audioId,playing:!audio.paused,positionMs:audio.currentTime*1000};void this.notifyListeners('started',receipt);return receipt;
  }catch(error){if(this.audio===audio)finish('playbackFailed');throw error;}
  }catch(error){if(current()){const playbackId=this.activeSpeechId;this.activeSpeechId=undefined;if(playbackId)void this.notifyListeners('playbackFailed',{playbackId,message:error instanceof Error?error.message:'Speech playback failed.'});await this.stopPlayback();}throw error;}
 }
 async stopPlayback(input?:{playbackId?:string;requestId?:string}){
  if(input?.playbackId&&this.activeSpeechId!==input.playbackId){
   const prepared=this.agentAudio.get(input.playbackId)??this.speech.get(input.playbackId);
   if(input.requestId!==undefined&&prepared?.requestId===input.requestId){this.agentAudio.delete(input.playbackId);this.speech.delete(input.playbackId);}
   return;
  }
  if(input?.requestId!==undefined&&(!this.activeSpeechId||this.activeSpeechRequestId!==input.requestId))return;
  const stopped=this.activeSpeechId;this.activeSpeechId=undefined;this.activeSpeechRequestId=undefined;
  if(stopped&&input?.requestId!==undefined){this.agentAudio.delete(stopped);this.speech.delete(stopped);}
  ++this.playbackGeneration;this.pendingAudioId=undefined;this.playbackAbort?.abort();this.playbackAbort=undefined;
  if(this.audio)this.releaseAudio(this.audio);
  if(stopped)void this.notifyListeners('playbackStopped',{playbackId:stopped});
 }
 stop(){return this.stopPlayback();}
 async state(){return {playing:!!this.audio&&!this.audio.paused&&!this.audio.ended,audioId:this.audioId,positionMs:(this.audio?.currentTime||0)*1000};}
 async saveRecording(input:{recordingId:string;noteId:string;transcript:string}){
  if(!input.recordingId||input.recordingId.length>128||!input.noteId||input.noteId.length>128||typeof input.transcript!=='string')throw Error('Invalid recording destination.');
  const saved=await retainAudio(input.recordingId,input.noteId,input.transcript,this.clip(input.recordingId));
  return {audioId:saved.audioId,noteId:saved.noteId,durationMs:saved.durationMs,transcript:input.transcript};
 }
 async describe(input:{audioId:string}){return audioMetadata(await audioRecord(input.audioId,true));}
 migrationStatus(){return migrateAudio();}
 async deletionStatus(input:{audioId:string;noteId:string;operationId:string}){return audioDeletionStatus(input.audioId,input.noteId,input.operationId);}
 async remove(input:{audioId:string;noteId:string;operationId:string}){const result=await changeAudioDeleted(input.audioId,input.noteId,true,input.operationId);if(result.status==='removed'){if([this.audioId,this.pendingAudioId].includes(input.audioId))await this.stopPlayback();this.audioChanges?.postMessage({audioId:input.audioId,deleted:true});}return result;}
 async restore(input:{audioId:string;noteId:string;operationId:string}){return changeAudioDeleted(input.audioId,input.noteId,false,input.operationId);}
 async purge(input:{audioId:string;noteId:string;operationId:string}){if([this.audioId,this.pendingAudioId].includes(input.audioId))await this.stopPlayback();return purgeAudio(input.audioId,input.noteId,input.operationId);}
 // Only a newer request of the same kind supersedes: a readiness check never cancels transcription or synthesis.
 private async withAgentSpeech<T>(kind:SpeechRequestKind,run:(signal:AbortSignal)=>Promise<T>,requestId?:string){
  this.abortSpeech(kind,'superseded');const request={controller:new AbortController(),requestId};this.speechRequests.set(kind,request);
  try{const result=await run(request.controller.signal);request.controller.signal.throwIfAborted();return result;}finally{if(this.speechRequests.get(kind)===request)this.speechRequests.delete(kind);}
 }
 private abortSpeech(kind:SpeechRequestKind,reason:SpeechCancelReason){
  const request=this.speechRequests.get(kind);if(!request)return;this.speechRequests.delete(kind);
  // DEV trace, enums only: which trigger cancelled an in-flight speech request.
  if(import.meta.env.DEV)console.warn('[Alpha speech]',{kind,reason});
  request.controller.abort(speechCancelled(kind,reason));
 }
 async cancel(input?:{requestId?:string},reason:SpeechCancelReason='stopped'){
  const requestId=input?.requestId;
  if(requestId!==undefined){
   for(const [kind,request] of [...this.speechRequests])if(request.requestId===requestId)this.abortSpeech(kind,'cancelled');
   await this.stopPlayback({requestId});
   for(const [id,audio] of this.agentAudio)if(audio.requestId===requestId)this.agentAudio.delete(id);
   for(const [id,speech] of this.speech)if(speech.requestId===requestId)this.speech.delete(id);
   return;
  }
  for(const kind of [...this.speechRequests.keys()])this.abortSpeech(kind,reason);this.capture.cancel();await this.stopPlayback();
  // A streamed clip, played or not, leaves with its download, so none outlives a global cancel.
  // A Blob clip stays playable, as before streaming.
  for(const [id,audio] of this.agentAudio)if(audio.stream)this.agentAudio.delete(id);
 }
 async releaseLocalSpeech(){await this.cancel(undefined,'released');this.speech.clear();this.agentAudio.clear();this.capture.clear();}
}
/** Prepared speech by playback id. A streamed clip stops downloading when its entry leaves. */
class PreparedAudio extends Map<string,{blob?:Blob;stream?:StreamedSpeech;requestId?:string;agent?:LocalAgentProtocol;sessionId:string;cloud?:{environment:string;credentialId:string}}> {
 override delete(id:string){this.get(id)?.stream?.cancel();return super.delete(id);}
 override clear(){for(const entry of this.values())entry.stream?.cancel();super.clear();}
}
function playbackWait<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  let settled=false;
  const finish=(error:unknown,value?:T)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);error?reject(error):resolve(value!);};
  const cancel=()=>finish(new DOMException('Playback cancelled','AbortError'));
  const timer=setTimeout(()=>finish(Error('Audio did not start. Try again.')),5000);
  signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
  work.then(value=>finish(null,value),error=>finish(error));
 });
}
/** Cloud read-aloud arrives as audio/mpeg chunks from the paired agent (local-agent-dev-bridge.ts). */
const SPEECH_TYPE='audio/mpeg';

/** True when this browser can play audio/mpeg through MediaSource. Otherwise the clip is buffered
 * whole into a Blob and played after its last byte, as before streaming. */
function streamedSpeechSupported():boolean {
 try{return typeof MediaSource!=='undefined'&&MediaSource.isTypeSupported(SPEECH_TYPE);}catch{return false;}
}

/** A prepared clip that is still downloading. The body is read from preparation on, so the download
 * continues while playback is admitted. Every chunk is kept so playback appends the clip from its
 * start. cancel() stops the download. */
export class StreamedSpeech {
 private chunks:Uint8Array<ArrayBuffer>[]=[];
 private outcome?:{error?:unknown};
 private waiters=new Set<()=>void>();
 private reader:ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>;
 constructor(body:ReadableStream<Uint8Array<ArrayBuffer>>){this.reader=body.getReader();void this.pump();}
 private async pump(){
  try{for(;;){const part=await this.reader.read();if(part.done)break;this.chunks.push(part.value);this.wake();}this.settle({});}
  catch(error){this.settle({error});}
 }
 private settle(outcome:{error?:unknown}){this.outcome??=outcome;this.wake();}
 private wake(){const waiters=[...this.waiters];this.waiters.clear();for(const resume of waiters)resume();}
 cancel(reason:unknown=new DOMException('Speech cancelled','AbortError')){this.settle({error:reason});void this.reader.cancel(reason).catch(()=>{});}
 /** Every chunk received so far, then each later one. Throws when the download fails or `signal` aborts. */
 async *read(signal:AbortSignal):AsyncGenerator<Uint8Array<ArrayBuffer>> {
  for(let index=0;;){
   signal.throwIfAborted();
   if(index<this.chunks.length){yield this.chunks[index++];continue;}
   if(this.outcome){if('error' in this.outcome)throw this.outcome.error;return;}
   await new Promise<void>(resolve=>{const resume=()=>{signal.removeEventListener('abort',resume);this.waiters.delete(resume);resolve();};this.waiters.add(resume);signal.addEventListener('abort',resume,{once:true});});
  }
 }
}

/** Plays `speech` through a MediaSource while it downloads: the element can start on the first
 * frames. The playback owns the download from here. `fed` resolves once the whole clip is appended.
 * It rejects when the download fails, `signal` aborts, an append fails or the element lets the media
 * go (sourceclose, as when its source is reset), and each of those also cancels the download. When
 * feeding ends either way, the object URL is revoked and every listener removed. */
export function streamedSpeechSource(speech:StreamedSpeech,signal:AbortSignal):{url:string;fed:Promise<void>} {
 const media=new MediaSource(),url=URL.createObjectURL(media),stop=new AbortController();
 const aborted=()=>stop.abort(signal.reason),detached=()=>stop.abort(Error('Speech audio could not be played.'));
 signal.addEventListener('abort',aborted,{once:true});media.addEventListener('sourceclose',detached);if(signal.aborted)aborted();
 const fed=(async()=>{
  try{
   if(media.readyState!=='open')await mediaEvent(media,'sourceopen',stop.signal);
   const buffer=media.addSourceBuffer(SPEECH_TYPE);
   for await(const chunk of speech.read(stop.signal)){buffer.appendBuffer(chunk);await mediaEvent(buffer,'updateend',stop.signal);}
   if(media.readyState==='open')media.endOfStream();
  }catch(error){speech.cancel(error);throw error;}
  finally{signal.removeEventListener('abort',aborted);media.removeEventListener('sourceclose',detached);URL.revokeObjectURL(url);}
 })();
 void fed.catch(()=>{});
 return {url,fed};
}
function mediaEvent(target:MediaSource|SourceBuffer,type:'sourceopen'|'updateend',signal:AbortSignal):Promise<void> {
 return new Promise((resolve,reject)=>{
  // A failed append fires error, and one cut short (the SourceBuffer was removed) fires abort, each before updateend.
  const failures=['error','abort'];
  const finish=(error?:unknown)=>{target.removeEventListener(type,done);for(const name of failures)target.removeEventListener(name,failed);signal.removeEventListener('abort',aborted);if(error)reject(error);else resolve();};
  const done=()=>finish(),failed=()=>finish(Error('Speech audio could not be played.')),aborted=()=>finish(signal.reason??new DOMException('Playback cancelled','AbortError'));
  target.addEventListener(type,done);for(const name of failures)target.addEventListener(name,failed);signal.addEventListener('abort',aborted);
  if(signal.aborted)aborted();
 });
}
