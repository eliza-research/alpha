import type {Page} from '@playwright/test';

/** Synthetic silent microphone and local browser voice. Nothing past getUserMedia/speechSynthesis is mocked. */
export async function silentMicrophone(page:Page){
 await page.evaluate(()=>{
  const w=window as any,ctx=new AudioContext();w.microphone={requests:0};
  document.addEventListener('click',()=>{void ctx.resume();},{capture:true});
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{
   w.microphone.requests++;const sink=ctx.createMediaStreamDestination(),source=ctx.createBufferSource();
   source.buffer=ctx.createBuffer(1,Math.round(ctx.sampleRate*1.5),ctx.sampleRate);source.connect(sink);await ctx.resume();setTimeout(()=>source.start(),100);return sink.stream;
  }}});
 });
}
/** Records utterances instead of producing sound; an utterance ends only when the test says so. */
export async function localBrowserVoice(page:Page){
 await page.evaluate(()=>{
  const f=(window as any).voiceFixture={spoken:[] as string[],cancels:0,utterances:[] as SpeechSynthesisUtterance[]};
  const engine=new EventTarget();
  Object.assign(engine,{getVoices:()=>[{name:'Synthetic local',lang:'en-US',localService:true,default:true,voiceURI:'synthetic'}],speak:(u:SpeechSynthesisUtterance)=>{f.spoken.push(u.text);f.utterances.push(u);},cancel:()=>{f.cancels++;},pause(){},resume(){},speaking:false,pending:false,paused:false});
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:engine});
  // The platform utterance only accepts platform voices; this records the same fields.
  Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class{text:string;voice:unknown=null;volume=1;onend:((e:Event)=>void)|null=null;onerror:((e:Event)=>void)|null=null;constructor(text:string){this.text=text;}}});
  f.finish=()=>{const u=f.utterances.at(-1);u?.onend?.(new Event('end') as SpeechSynthesisEvent);};
 });
}
export const recorder=(page:Page)=>page.locator('[data-alpha-subview="notes-recording"]');
export function agentContext(page:Page){
 return page.evaluate(async()=>{const {alphaClient}=await import('/src/runtime/alpha-client.ts');return JSON.parse(JSON.stringify(alphaClient.getState().context));});
}
/**
 * Agent speech (P-43): the browser reads aloud only through the local agent's libelizainference
 * (Paradee) route. This stubs that agent: synthesizeSpeech records the text and returns a short
 * silent WAV, and media playback is recorded instead of producing sound. `finish()` ends the last
 * playback as the audio element would; `cancels` counts pauses (a stop). Nothing else is mocked.
 */
export async function agentBrowserVoice(page:Page,{ready=true,state}:{ready?:boolean;state?:string}={}){
 await page.evaluate(async({ready,state})=>{
  // `state` shares an existing fixture object (its spoken list and cancelled count) with this agent.
  const w=window as any,f=w.voiceFixture=Object.assign(state&&w[state]?w[state]:{},{spoken:(state&&w[state]?.spoken)||[] as string[],cancels:0,audios:[] as HTMLMediaElement[],ready,finish:()=>{}});
  const wav=()=>{const buffer=new ArrayBuffer(44+3200),view=new DataView(buffer),text=(at:number,s:string)=>{for(let i=0;i<s.length;i++)view.setUint8(at+i,s.charCodeAt(i));};
   text(0,'RIFF');view.setUint32(4,buffer.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,24000,true);view.setUint32(28,48000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,3200,true);return new Blob([buffer],{type:'audio/wav'});};
  const agent={session:{sessionId:'synthetic-agent-speech'},browserSpeechAvailable:true,
   speechRequest:async()=>({ready:f.ready}),
   synthesizeSpeech:async(text:string,signal:AbortSignal)=>{signal.throwIfAborted();
    // holdSynthesis keeps synthesis pending until releaseSynthesis(), as a slow engine would.
    if(f.holdSynthesis)await new Promise<void>((resolve,reject)=>{f.releaseSynthesis=resolve;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});signal.throwIfAborted();
    if(!f.ready)throw Object.assign(Error('Agent speech is unavailable.'),{code:'local-agent-required'});f.spoken.push(text);const blob=wav();texts.set(blob,text);return blob;}};
  // Which text each played audio carries (the object URL is made from the returned blob).
  const texts=new WeakMap<Blob,string>(),urls=new Map<string,string>(),create=URL.createObjectURL.bind(URL);
  URL.createObjectURL=(blob:Blob)=>{const url=create(blob);const text=texts.get(blob);if(text!==undefined)urls.set(url,text);return url;};
  const {connectionController}=await import('/src/runtime/connection-ui.tsx');
  (connectionController as any).getBrowserSpeechAgent=()=>agent;
  const proto=HTMLMediaElement.prototype;
  Object.defineProperty(proto,'play',{configurable:true,value:function(this:HTMLMediaElement){f.audios.push(this);const audio=this;f.current=f.utterance={text:urls.get(audio.src),onend:()=>audio.onended?.(new Event('ended')),onerror:()=>audio.onerror?.(new Event('error'))};Object.defineProperty(this,'paused',{configurable:true,value:false});return Promise.resolve();}});
  Object.defineProperty(proto,'pause',{configurable:true,value:function(this:HTMLMediaElement){f.cancels++;if(typeof f.cancelled==='number')f.cancelled++;Object.defineProperty(this,'paused',{configurable:true,value:true});}});
  f.finish=()=>{const audio=f.audios.at(-1);audio?.onended?.(new Event('ended'));};
 },{ready,state});
}
