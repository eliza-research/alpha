import {tsImport} from '../support/ts-import.mjs';
const {alphaViewPath}=await tsImport(new URL('../../apps/app/src/product/alpha-product.ts',import.meta.url).href,{parentURL:import.meta.url});
const {cloudServiceName}=await tsImport(new URL('../../apps/app/src/runtime/cloud-protocol.ts',import.meta.url).href,{parentURL:import.meta.url});
const {cloudVoiceLimitOf}=await tsImport(new URL('../../apps/app/src/runtime/cloud-voice-limit.ts',import.meta.url).href,{parentURL:import.meta.url});
const {readServiceLimit,retryDuration}=await tsImport(new URL('../../.eliza/client-features/packages/cloud/sdk/src/subscription-entitlement.ts',import.meta.url).href,{parentURL:import.meta.url});
/** Loads the actual Alpha voice views with in-memory ports only.
 * No microphone, MediaRecorder, native plugin, provider, playback or account API is used. */
import vm from 'node:vm';
import {TextEncoder} from 'node:util';
import {build} from 'esbuild';
import path from 'node:path';
import {loadPreparedBatchVoice} from './shared-batch-voice.mjs';

// Compile whole real modules once. Imports are explicit controlled ports in the fixture realm;
// no source slice, import stripping, declaration rewriting or injected product exports.
const moduleFiles = ['runtime/voice-selection.ts',
 '../../../.eliza/client-features/packages/voice/src/voice-turn-timing.ts',
 '../../../.eliza/client-features/packages/voice/src/realtime-voice-timing.ts',
 'runtime/voice-timing.ts','local-speech-playback.ts','runtime/local-speech-text.ts',
 'runtime/cloud-voice.ts','runtime/action-message-presentation.ts',
 '../../../.eliza/client-features/packages/core/src/types/system-notice.ts',
 '../../../.eliza/client-features/packages/voice/src/cloud-speech-chunks.ts',
 'prototype/local-speech-playback.ts','runtime/voice-states.ts','runtime/local-agent-stream.ts',
 'prototype/note-recorder.ts','runtime/note-recorder-driver.ts','runtime/note-default-title.ts',
 'prototype/voice-adapter.ts'];
const modules = new Map(await Promise.all(moduleFiles.map(async file => {
 const entry=path.resolve('apps/app/src',file);
 const built=await build({entryPoints:[entry],bundle:true,write:false,format:'iife',globalName:'__alphaVoiceModule',platform:'browser',target:'es2022',logLevel:'silent',plugins:[{
  name:'voice-fixture-controlled-imports',setup(builder){
   builder.onResolve({filter:/.*/},args=>args.kind==='entry-point'?undefined:{path:args.path,namespace:'voice-port'});
   builder.onLoad({filter:/.*/,namespace:'voice-port'},()=>({contents:'module.exports = globalThis;',loader:'js'}));
  }
 }]});
 return [file,built.outputFiles[0].text];
})));
function load(file,box){
 const code=modules.get(file);if(!code)throw Error('Unknown whole voice fixture module: '+file);
 vm.runInNewContext(code,box,{filename:file});Object.assign(box,box.__alphaVoiceModule);
}
export function cloudVoiceViewFixture(options={}){
 const f={account:'cloud-account',credential:'cloud-credential',agent:'agent-session',kind:'resident',platform:'android',native:true,open:false,starts:0,stops:0,uploads:0,cloudSpeech:0,localFactories:0,localSpeech:0,pairedFactories:0,accountOpens:0,sends:0,audioSaves:0,recordingCancels:[],activeRecording:null,lastRecording:null,error:null,peak:0,conversation:'11111111-1111-4111-8111-111111111111',contextRevision:1,sendInputs:[],...options};
 // The speech route is chosen at run time from the signed-in account (voice-selection.ts speechRoute).
 // `cloudProfile:true` keeps the fixture's Cloud account; other scenarios start signed out, on this phone.
 if(options.cloudProfile!==true&&!('account' in options))f.account=null;
 const subscriptions=new Set(),events=new Map();
 const driver={warmSpeechOutput:async()=>{f.speechWarmups=(f.speechWarmups||0)+1;},getRecordingMetrics:async input=>{if(f.metricsError)throw f.metricsError;if(input.recordingId!==f.activeRecording)throw Error('Recording changed');return {recordingId:input.recordingId,peak:f.peak};},startRecording:async()=>{const id='synthetic-clip-'+(++f.starts);const result=f.holdStart?await new Promise(resolve=>f.releaseStart=resolve):{recordingId:id,maxDurationMs:59000};if(f.startError)throw f.startError;f.activeRecording=result.recordingId;f.lastRecording=result.recordingId;return result;},stopRecording:async()=>{f.stops++;f.activeRecording=null;return {recordingId:f.lastRecording,durationMs:1000};},transcribeRecording:async input=>{f.uploads++;f.transcribeInput=input;if(f.error)throw f.error;if(f.holdTranscript)return new Promise(resolve=>f.releaseTranscript=resolve);return {text:f.transcript||'Synthetic Cloud transcript',local:false};},cancelRecording:async()=>{f.recordingCancels.push(f.activeRecording);if(f.holdCaptureCancel)await new Promise(resolve=>f.releaseCaptureCancel=resolve);if(f.captureCancelError)throw f.captureCancelError;f.activeRecording=null;},cancel:async()=>{},stop:async()=>{f.savedAudioStops=(f.savedAudioStops||0)+1;if(f.holdSavedStop)await new Promise(resolve=>f.releaseSavedStop=resolve);if(f.savedStopError)throw f.savedStopError;f.activeSavedAudio=null;},state:async()=>({playing:!!f.activeSavedAudio,audioId:f.activeSavedAudio,positionMs:0}),stopPlayback:async input=>{f.stopPlaybackInputs??=[];f.stopPlaybackInputs.push(input);if(f.holdPlaybackCleanup)await new Promise(resolve=>f.releasePlaybackCleanup=resolve);if(f.playbackCleanupError)throw f.playbackCleanupError;f.activePlayback=null;},synthesize:async input=>{(f.speechInputs??=[]).push(input);f.cloudSpeech++;if(f.error)throw f.error;return {playbackId:'synthetic-'+input.requestId};},play:async input=>{if(input.audioId){f.savedAudioStarts=(f.savedAudioStarts||0)+1;if(f.holdSavedStart)await new Promise(resolve=>f.releaseSavedStart=resolve);f.activeSavedAudio=input.audioId;return;}f.activePlayback=input.playbackId;f.finishPlayback=()=>{f.activePlayback=null;for(const callback of events.get('playbackEnded')||[])callback(input);};if(!f.holdPlayback)queueMicrotask(f.finishPlayback);},addListener:async(name,callback)=>{const callbacks=events.get(name)||new Set();events.set(name,callbacks);callbacks.add(callback);return {remove:async()=>{callbacks.delete(callback);}};},saveRecording:async input=>{f.audioSaves++;return {audioId:input.recordingId,noteId:input.noteId,durationMs:1000,transcript:input.transcript};}};
 const controller={warmInference:()=>{f.prewarms=(f.prewarms||0)+1;},getCloudEnvironment:()=>f.account?(f.environment||'production'):null,getCloudClient:()=>f.account?{sessionId:f.account,credentialId:f.credential}:null,getSnapshot:()=>({kind:f.kind,open:f.open,session:f.agent?{sessionId:f.agent,ownerId:'synthetic-owner',agentId:'synthetic-agent',origin:'https://owned-agent.invalid'}:null}),getPairedVoiceBinding:()=>null,getBrowserSpeechAgent:()=>null,open:()=>{f.agentOpens=(f.agentOpens||0)+1;f.open=true;},openCloudAccount:()=>{f.accountOpens++;f.open=true;},subscribe:callback=>{subscriptions.add(callback);return()=>subscriptions.delete(callback);}};
 const local={ready:async()=>true,playbackReady:async()=>true,speak:async()=>{f.localSpeech++;}};
 const box={openMicrophoneAvailable:()=>f.openMic===true,createLocalReplySpeaker:()=>f.replySpeaker,developmentCloudRealtimeVoiceEnabled:false,developmentCloudVoiceEnabled:false,developmentCartesiaVoiceEnabled:false,testMocksEnabled:false,browserDevProfile:false,Capacitor:{getPlatform:()=>f.platform,isNativePlatform:()=>f.native,isPluginAvailable:()=>true},connectionController:controller,registerPlugin:()=>driver,createOnDeviceVoice:()=>{f.localFactories++;return local;},createPairedVoice:()=>{f.pairedFactories++;return null;},planLocalSpeech:()=>[],recordingLevels:()=>[],localStorage:{getItem:()=>JSON.stringify({kind:f.kind})},document:{hidden:false,documentElement:{dataset:{}},querySelector:selector=>selector==='dialog[open]'?f.reviewOpen||null:f.noteEditor||null,addEventListener(){},removeEventListener(){}},window:{addEventListener(){},removeEventListener(){},dispatchEvent(){},getSelection:()=>({isCollapsed:true})},queueMicrotask,setInterval:options.clock?.setInterval||setInterval,clearInterval:options.clock?.clearInterval||clearInterval,setTimeout:options.clock?.setTimeout||setTimeout,clearTimeout:options.clock?.clearTimeout||clearTimeout,Date:options.clock?.Date||Date,performance:options.clock?.performance,crypto,structuredClone,AbortController,DOMException,Event,TextEncoder,console};
 loadPreparedBatchVoice(box);
 load('runtime/voice-selection.ts',box,['selectVoiceRoute','voiceSendPolicy','speechRoute','noteNetworkSpeechFailure','clearNetworkSpeechHold']);
 // voice-timing.ts configures the shared recorder projected from the pin; it is evaluated in the
 // same realm so its promises keep the view's microtask timing.
 load('../../../.eliza/client-features/packages/voice/src/voice-turn-timing.ts',box,['createVoiceTurnTiming']);
 // The actual projected realtime recorder is evaluated in this realm.
 load('../../../.eliza/client-features/packages/voice/src/realtime-voice-timing.ts',box,['createRealtimeVoiceTiming']);
 load('runtime/voice-timing.ts',box,['beginVoiceTurn','markVoiceTiming','abandonVoiceTurn','finishVoiceTurn','sendVoiceEntry','observeVoiceStartup','runVoiceStartupPreparation','voiceStartupTiming']);
 load('local-speech-playback.ts',box,['playOwnedSpeech']);
 // The real read-aloud refusal; the on-device planner stays a stub.
 load('runtime/local-speech-text.ts',box,['screenSpeechText']);
 load('runtime/cloud-voice.ts',box,['cloudVoiceFailure','createCloudVoice']);
 load('../../../.eliza/client-features/packages/core/src/types/system-notice.ts',box);
 load('runtime/action-message-presentation.ts',box);
 // These scenarios exercise the batch port; native streaming has its own owning drivers.
 box.nativeCloudStreamingAvailable=()=>false;
 load('../../../.eliza/client-features/packages/voice/src/cloud-speech-chunks.ts',box);
 load('prototype/local-speech-playback.ts',box,['installLocalSpeechPlayback','stopLocalSpeechPlayback','currentNoteReading','stopSpeaking','speakNote','readNoteAloud']);
 load('runtime/voice-states.ts',box,['voiceFailure','transcriptProvenance','deniedSettingsChoice','DENIED_SETTINGS_LABEL','MEDIA_UNCONFIRMED_NOTICE','speechCleanupNotice']);
 // Issue #395 native stage bridge: a no-op outside the phone.
 box.installNativeVoiceTurnMarks=()=>{};
 box.alphaViewPath=alphaViewPath;box.cloudServiceName=cloudServiceName;box.cloudVoiceLimitOf=cloudVoiceLimitOf;box.readServiceLimit=readServiceLimit;box.retryDuration=retryDuration;
 load('runtime/local-agent-stream.ts',box);
 // Exercise Notes only when the scenario supplies an owned in-memory recording port.
 load('prototype/note-recorder.ts',box);
 box.createNoteRecorderDriver=()=>({status:async()=>({state:'idle'}),listen:async()=>({remove(){}}),start:async()=>{throw Error('No Notes recording in this fixture');}});
 box.noteSegmentTranscriber=async()=>null;box.setNotesRecorderControl=()=>{};box.openNativeLiveStream=async()=>{throw Error('No live stream in this fixture');};
 if(options.noteRecording){
  Object.assign(driver,options.noteRecording(driver));
  load('runtime/note-recorder-driver.ts',box,['createNoteRecorderDriver','noteSegmentTranscriber']);
  box.setNotesRecorderControl=control=>{f.notesRecorderControl=control;};
 }
 load('runtime/note-default-title.ts',box,['nextDefaultNoteTitle']);
 load('prototype/voice-adapter.ts',box);
 const icons={check:'check',mic:'official-mic-path',stop:'stop',play:'play',x:'close',cloud:'cloud',user:'account'};
 class Shell{
  live=true;state={view:null,chat:'sheet',draft:'',msgs:[{id:'message',from:'agent',text:'Synthetic reply'}]};notes={list:[]};messages=[];
  // Transcript scrolling belongs to the surrounding shell and has its own source-bound campaign.
  beginVoiceScrollFollow(){f.followStarts=(f.followStarts||0)+1;}
  cancelVoiceScrollFollow(){f.followCancels=(f.followCancels||0)+1;}
  S(){return this.state;}setState(patch,callback){const update=()=>{const value=typeof patch==='function'?patch(this.state):patch;if(value)Object.assign(this.state,value);callback?.();};if(f.holdUpdates){(f.updates??=[]).push(update);}else update();}renderVals(){return {msgs:this.state.msgs.map(message=>({text:message.text})),ic:icons};}openView(view,_patch,chat){if(this.state.view==='notes'&&view!=='notes')views.notes.onLeave();this.state.view=view;this.state.chat=chat||'hidden';f.contextRevision++;}goHome(chat){if(this.state.view==='notes')views.notes.onLeave();this.state.view=null;this.state.chat=chat||'input';f.contextRevision++;}back(){this.state.view=null;}toast(message){this.messages.push(message);}vset(_key,patch){if(this.failPersistence)return false;Object.assign(this.notes,patch);return true;}api(){return {get:()=>this.notes,setView:(_key,patch)=>Object.assign(this.notes,patch)};}startVoice(){throw Error('Legacy voice must not run');}send(){f.sends++;}componentWillUnmount(){this.live=false;}
  async prepareVoiceConversation(signal){signal.throwIfAborted();if(!f.agent)throw Error('Connect an agent first.');return {binding:{conversationId:f.conversation,session:controller.getSnapshot().session,connectionEpoch:1},context:{view:this.state.view||'home',revision:f.contextRevision,sensitive:false}};}
  voiceConversationCurrent(prepared){return prepared.binding.conversationId===f.conversation&&prepared.binding.session.sessionId===f.agent&&prepared.context.revision===f.contextRevision&&prepared.context.view===(this.state.view||'home');}
  voiceConversationContext(binding){if(binding.conversationId!==f.conversation||binding.session.sessionId!==f.agent)throw Error('Voice room changed');return {view:this.state.view||'home',revision:f.contextRevision,sensitive:false,...(f.selectedObject?{selectedObject:f.selectedObject}:{})};}
  async sendVoiceTurn(input){this.voiceSendTurnId=input.turnId;input.signal.throwIfAborted();input.assertCurrent();f.sendInputs.push(input);f.sends++;if(f.holdReply)await new Promise(resolve=>f.releaseReply=resolve);input.signal.throwIfAborted();input.assertCurrent();if(f.navigationTarget){f.claims=(f.claims||0)+1;if(f.holdClaim)await new Promise(resolve=>f.releaseClaim=resolve);input.signal.throwIfAborted();input.assertCurrent();const target=f.navigationTarget;const switched=await input.navigation.apply(target,input.assertCurrent,async(chat,onCommitted)=>{if(target==='home')this.goHome(chat);else this.openView(target,undefined,chat);this.componentDidUpdate();onCommitted(this.voiceConversationContext(input.binding));if(f.interposeSelection)queueMicrotask(()=>{f.contextRevision++;this.componentDidUpdate();});return true;});f.acks=(f.acks||0)+1;if(f.holdAck)await new Promise(resolve=>f.releaseAck=resolve);input.navigation.finish(switched&&!f.unknownAck);input.signal.throwIfAborted();input.assertCurrent();}return {requestId:input.turnId,conversationId:f.conversation,userMessageId:crypto.randomUUID(),assistantMessageId:crypto.randomUUID(),text:'Synthetic matching reply.',complete:true,...f.badReply};}
 }
 const views={notes:{render:()=>({ed:{},vo:{bars:[]}}),back:()=>false,onLeave(){}}};box.installPrototypeVoiceAdapter(Shell,views);
 const shell=new Shell(),api={...shell.api('notes'),get:()=>shell.notes,set:patch=>Object.assign(shell.notes,patch),ic:icons};
 if(options.noteRecording)Object.assign(api,{voiceNoteStorage:()=>({mode:'legacy',epoch:1,target:'fixture'}),storageReady:()=>true,saveVoiceNote:patch=>shell.vset('notes',patch)});
 const render=()=>views.notes.render(shell.notes,api);
 render();
 return Object.assign(f,{box,shell,driver,events,flushUpdates:()=>{const updates=f.updates||[];f.updates=[];for(const update of updates)update();},render,renderChat:()=>shell.renderVals().chatRecorder,changed:()=>{for(const callback of subscriptions)callback();},close:()=>{views.notes.onLeave();shell.componentWillUnmount();},tick:()=>new Promise(resolve=>setTimeout(resolve,0))});
}
