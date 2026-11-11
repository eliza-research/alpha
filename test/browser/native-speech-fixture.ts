import {type Page} from '@playwright/test';
import {flagOffAndroid,residentHome,fenceNetwork} from './flag-off-android';
// Synthetic native ports: routing and lifecycle evidence only.
// offline: Android reports no active network (ElizaSystem.getNetworkStatus, AlphaSystemPlugin), the
// fact the renderer uses on Android instead of WebView's navigator.onLine hint.
export async function setupNativeSpeech(page:Page,options:{offline?:boolean}={}){
 const foreign=await fenceNetwork(page);await flagOffAndroid(page);
 await page.addInitScript((options:{offline?:boolean})=>{
  const w=window as any,c=w.Capacitor,prior=c.nativePromise;
  if(options.offline)c.PluginHeaders.find((p:any)=>p.name==='ElizaSystem').methods.push({name:'getNetworkStatus',rtype:'promise'});
  // This fixture exercises the supported local route: Text keys selected, no Cartesia key,
  // and no saved Cloud account. The production renderer chooses its route normally.
  delete w.flagOff.slots['cloud:production'];w.flagOff.persist();
  const provider={mode:'own',revision:'synthetic-local-speech-provider-r1',persistence:'native-secure-store',keys:{text:{configured:true},voice:{configured:false}},provider:'cerebras',configured:true,selected:true,model:'qwen-3.8-27b',voiceConfigured:false};
  // Voice replies require correlated durable message identities; the generic text-chat
  // fixture omits them. Supply the provider's completed reply fields at its stream port.
  const emit=w.flagOff.emit;w.flagOff.emit=(plugin:string,event:string,value:any)=>{
   if(plugin==='Agent'&&event==='alphaAgentStream'&&value.event?.type==='chunk'){
    const raw=atob(value.event.dataBase64),data=JSON.parse(raw.slice(6));
    if(data.type==='done')value={...value,event:{...value.event,dataBase64:btoa('data: '+JSON.stringify({...data,messageId:'11111111-1111-4111-8111-111111111111',userMessageId:'22222222-2222-4222-8222-222222222222'})+'\n\n')}};
   }
   return emit(plugin,event,value);
  };
  const f=w.nativeSpeech={ready:true,peak:0,starts:0,stops:0,transcripts:0,delivered:0,spoken:[] as string[],plays:0,cancels:[] as string[],stopped:0,forbidden:[] as string[],active:null as string|null,holdTranscript:false,stages:[] as string[],turns:[] as Array<string|undefined>,captureStartedAt:0,sampledActivity:[] as Array<{at:number;peak:number}>};
  const events:Array<{event:string;callback:(value:any)=>void}>=[];
  const header=c.PluginHeaders.find((p:any)=>p.name==='AlphaVoiceCloud');
  header.methods=[...['checkPermissions','localSpeechStatus','startRecording','stopRecording','getRecordingMetrics','cancelRecording','transcribeLocalRecording','synthesizeLocal','play','stopPlayback','cancel','releaseLocalSpeech','markVoiceTurn'].map(name=>({name,rtype:'promise'})),{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'callback'}];
  const callback=c.nativeCallback;c.nativeCallback=(plugin:string,method:string,input:any,fn:any)=>{if(plugin==='AlphaVoiceCloud'&&method==='addListener'){events.push({event:input.eventName,callback:fn});return String(events.length);}return callback(plugin,method,input,fn);};
  c.nativePromise=async(plugin:string,method:string,input:any)=>{
   if(plugin==='Agent'&&method==='providerStatus')return provider;
   if(options.offline&&plugin==='ElizaSystem'&&method==='getNetworkStatus')return {connected:false};
   if(plugin!=='AlphaVoiceCloud')return prior(plugin,method,input);
   if(method==='checkPermissions')return {microphone:'granted'};
   if(method==='localSpeechStatus')return {ready:f.ready,execution:'device'};
   if(method==='startRecording'){f.active='clip-'+ ++f.starts;f.captureStartedAt=performance.now();f.sampledActivity=[];return {recordingId:f.active,maxDurationMs:29000};}
   if(method==='getRecordingMetrics'){f.sampledActivity.push({at:performance.now(),peak:f.peak});return {recordingId:input.recordingId,peak:f.peak,rms:f.peak};}
   if(method==='stopRecording'){f.stops++;const recordingId=f.active;f.active=null;return {recordingId,durationMs:1500};}
   if(method==='cancelRecording'){f.active=null;return {};}
   if(method==='transcribeLocalRecording'){f.transcripts++;if(f.holdTranscript)await new Promise(resolve=>f.releaseTranscript=resolve);f.delivered++;return {text:'Local spoken request',local:true,execution:'device'};}
   // Issue #395: the native collector binds renderer stages to one live turn id (ids only, no text).
   if(method==='markVoiceTurn'){f.stages.push(input.stage+(input.voiceTurnId?':linked':''));return {marked:true,voiceTurnId:'7d3c1a52-6d5e-4e0f-9a43-5c1d2e3f4a5b'};}
   if(method==='synthesizeLocal'){f.spoken.push(input.text);f.turns.push(input.voiceTurnId);return {playbackId:'play-'+f.spoken.length,execution:'device'};}
   if(method==='play'){f.plays++;return {};}
   if(method==='stopPlayback'){f.stopped++;return {};}
   if(method==='cancel'){f.cancels.push(input.requestId);return {};}
   if(method==='releaseLocalSpeech'||method==='removeListener')return {};
   f.forbidden.push(method);throw Error('No network speech allowed: '+method);
  };
 },options);await residentHome(page);return foreign;
}
