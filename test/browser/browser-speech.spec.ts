import {test,expect} from '@playwright/test';
import {cloudNotesVoiceFixture,notesRecorder,openNotesRecorder,recordClosedClip,noPhysicalOrLocalVoice} from './cloud-notes-voice-fixture';
// Default Notes UI is Cloud-only. The browser has no speech engine of its own: local speech
// runs on the local agent (native libelizainference), and without one it is unavailable.

test('without a local agent, local speech is unavailable and no engine, model or worker is loaded',async({page})=>{
 const engine:string[]=[];page.on('request',request=>{const url=new URL(request.url());if(url.pathname.startsWith('/browser-speech/')||/\.wasm$/.test(url.pathname))engine.push(url.pathname);});
 await page.addInitScript(()=>{const counts=(window as any).engineGate={workers:0,wasm:0};const Original=window.Worker;window.Worker=new Proxy(Original,{construct(target,args){counts.workers++;return Reflect.construct(target,args);}});for(const name of ['instantiate','instantiateStreaming','compile','compileStreaming'] as const){const original=(WebAssembly as any)[name];(WebAssembly as any)[name]=(...args:unknown[])=>{counts.wasm++;return original.apply(WebAssembly,args);};}});
 await page.goto('/?tools=1');
 const result=await page.evaluate(async()=>{
  const {BrowserVoice}=await import('/src/browser/voice.ts'),{connectionController}=await import('/src/runtime/connection-ui.tsx'),{voiceFailure}=await import('/src/runtime/voice-states.ts');
  const original=connectionController.getBrowserSpeechAgent;(connectionController as any).getBrowserSpeechAgent=()=>null;
  const voice=new BrowserVoice(),before={...(window as any).engineGate};
  try{
   const status=await voice.localSpeechStatus();
   (voice as any).capture.clips.set('no-agent',{blob:new Blob([new Uint8Array(64)],{type:'audio/wav'}),durationMs:1000});
   const error=await voice.transcribeLocalRecording({recordingId:'no-agent'}).then(()=>null,(reason:any)=>({code:reason.code,message:reason.message}));
   const failure=voiceFailure(error,{transcribing:true,browser:true});
   return {status,error,failure,clipKept:(voice as any).capture.get('no-agent')!==undefined,gate:{workers:(window as any).engineGate.workers-before.workers,wasm:(window as any).engineGate.wasm-before.wasm}};
  }finally{connectionController.getBrowserSpeechAgent=original;await voice.releaseLocalSpeech();}
 });
 // Recognition readiness names the local agent route and never an in-browser engine or model;
 // P-43: no Web Speech read-aloud either; replies are read as text until the agent's speech runs.
 expect(result.status).toEqual({ready:false,playback:false,execution:'browser',route:'local-agent',reason:'local-agent-required'});
 // No silent fallback to Cloud or to an in-browser engine: the clip stays, and the user is told what to connect.
 expect(result.error).toEqual({code:'local-agent-required',message:'Connect the local agent to transcribe on this computer.'});
 expect(result.failure?.kind).toBe('local-agent');expect(result.failure?.message).toMatch(/needs the local agent on this computer.*Your recording is kept/);
 expect(result.clipKept).toBe(true);expect(result.gate).toEqual({workers:0,wasm:0});expect(engine).toEqual([]);
});

test('with a local agent, transcription sends a 16 kHz mono WAV to the agent and reports the agent route',async({page})=>{
 await page.goto('/?tools=1');
 const result=await page.evaluate(async()=>{
  const {BrowserVoice}=await import('/src/browser/voice.ts'),{connectionController}=await import('/src/runtime/connection-ui.tsx');
  // An 8 kHz PCM16 tone the browser decodes and the voice facade resamples before upload.
  const rate=8000,frames=rate,buffer=new ArrayBuffer(44+frames*2),view=new DataView(buffer),text=(at:number,s:string)=>{for(let i=0;i<s.length;i++)view.setUint8(at+i,s.charCodeAt(i));};
  text(0,'RIFF');view.setUint32(4,buffer.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,frames*2,true);
  for(let i=0;i<frames;i++)view.setInt16(44+i*2,Math.round(Math.sin(i/rate*2*Math.PI*440)*12000),true);
  const requests:{bytes?:number;rate?:number;channels?:number;riff?:string}[]=[];
  const agent={session:{sessionId:'synthetic-agent'},speechRequest:async(audio?:Uint8Array)=>{if(!audio){requests.push({});return {ready:true};}const header=new DataView(audio.buffer,audio.byteOffset);requests.push({bytes:audio.length,rate:header.getUint32(24,true),channels:header.getUint16(22,true),riff:String.fromCharCode(...audio.slice(0,4))});return {ready:true,text:'Agent transcript'};}};
  const original=connectionController.getBrowserSpeechAgent;(connectionController as any).getBrowserSpeechAgent=()=>agent;
  const voice=new BrowserVoice();
  try{
   const status=await voice.localSpeechStatus();
   (voice as any).capture.clips.set('agent-clip',{blob:new Blob([buffer],{type:'audio/wav'}),durationMs:1000});
   const transcript=await voice.transcribeLocalRecording({recordingId:'agent-clip',requestId:crypto.randomUUID()});
   return {status,transcript,requests};
  }finally{connectionController.getBrowserSpeechAgent=original;await voice.releaseLocalSpeech();}
 });
 expect(result.status).toEqual({ready:true,execution:'browser',route:'local-agent'});
 expect(result.transcript).toEqual({text:'Agent transcript',local:true,execution:'browser',route:'local-agent',language:'en'});
 expect(result.requests).toEqual([{},{bytes:44+16000*2,rate:16000,channels:1,riff:'RIFF'}]);
});
test('unsigned Notes voice offers Cloud sign-in before any capture or local preparation',async({page})=>{
 const f=await cloudNotesVoiceFixture(page,false);await openNotesRecorder(page);await expect(notesRecorder(page).getByRole('button',{name:'Connect Eliza Cloud',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:/Start recording|Record without transcription|Use browser voice|Use development voice/})).toHaveCount(0);await noPhysicalOrLocalVoice(page);expect(f.foreign).toEqual([]);
});
test('Cloud Notes transcript stays reviewable and saves edited text with Cloud provenance',async({page})=>{
 const f=await cloudNotesVoiceFixture(page);await openNotesRecorder(page);await recordClosedClip(page);expect(await page.evaluate(()=>(window as any).cloudNotesVoice.uploads)).toBe(0);await notesRecorder(page).getByRole('button',{name:'Transcribe with Eliza Cloud',exact:true}).click();const review=notesRecorder(page).getByRole('textbox',{name:'Review transcript',exact:true});await expect(review).toHaveValue('Closed Cloud transcript');await review.fill('Reviewed Cloud transcript.');await notesRecorder(page).getByRole('button',{name:'Save note',exact:true}).click();await expect(page.getByRole('button',{name:'Play recording',exact:true})).toBeVisible();
 const saved=await page.evaluate(async()=>JSON.parse((await(await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())!).records.find((n:any)=>n.kind==='voice'));expect(saved.body).toBe('Reviewed Cloud transcript.');expect(saved.transcription).toMatchObject({route:'eliza-cloud',edited:true});await noPhysicalOrLocalVoice(page);expect(f.foreign).toEqual([]);
});
test('empty Cloud transcript says no speech was heard, retains the recording and offers no typing fallback',async({page})=>{
 await cloudNotesVoiceFixture(page);await page.evaluate(()=>(window as any).cloudNotesVoice.empty=true);await openNotesRecorder(page);await recordClosedClip(page);await notesRecorder(page).getByRole('button',{name:'Transcribe with Eliza Cloud',exact:true}).click();
 // Silence is not a microphone, account or connection failure, and the wording names only controls that are rendered.
 await expect(notesRecorder(page)).toContainText('Eliza Cloud heard no speech. Your recording is kept.');
 await expect(notesRecorder(page)).not.toContainText(/microphone access|connection|type the transcript/i);
 await expect(notesRecorder(page).getByRole('button',{name:'Transcribe with Eliza Cloud',exact:true})).toBeEnabled();await expect(notesRecorder(page).getByRole('button',{name:'Record again',exact:true})).toBeVisible();
 await expect(notesRecorder(page).getByRole('textbox',{name:'Review transcript'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Type transcript instead',exact:true})).toHaveCount(0);
 // The kept clip is the one an explicit retry uploads again.
 await page.evaluate(()=>(window as any).cloudNotesVoice.empty=false);await notesRecorder(page).getByRole('button',{name:'Transcribe with Eliza Cloud',exact:true}).click();await expect(notesRecorder(page).getByRole('textbox',{name:'Review transcript',exact:true})).toHaveValue('Closed Cloud transcript');
 expect(await page.evaluate(()=>{const f=(window as any).cloudNotesVoice;return {uploads:f.uploads,same:f.requests[0].recordingId===f.requests[1].recordingId&&f.requests[0].recordingId===f.clip};})).toEqual({uploads:2,same:true});await noPhysicalOrLocalVoice(page);
});
test('microphone denial is visible without a transcription or provider fallback',async({page})=>{
 await cloudNotesVoiceFixture(page);await page.evaluate(()=>(window as any).cloudNotesVoice.denied=true);await openNotesRecorder(page);await notesRecorder(page).getByRole('button',{name:'Start recording',exact:true}).click();await expect(notesRecorder(page)).toContainText(/microphone/i);expect(await page.evaluate(()=>(window as any).cloudNotesVoice.uploads)).toBe(0);await noPhysicalOrLocalVoice(page);
});
test('Cloud billing refusal retains the clip and an explicit retry uses the same Cloud route',async({page})=>{
 await cloudNotesVoiceFixture(page);await page.evaluate(()=>(window as any).cloudNotesVoice.billing=true);await openNotesRecorder(page);await recordClosedClip(page);await notesRecorder(page).getByRole('button',{name:'Transcribe with Eliza Cloud',exact:true}).click();await expect(notesRecorder(page)).toContainText('Eliza Cloud declined voice for billing. Check your account in Settings.');await expect(page.getByRole('button',{name:/Type transcript instead|Use browser voice|Use development voice/})).toHaveCount(0);await page.evaluate(()=>(window as any).cloudNotesVoice.billing=false);await notesRecorder(page).getByRole('button',{name:'Transcribe with Eliza Cloud',exact:true}).click();await expect(notesRecorder(page).getByRole('textbox',{name:'Review transcript',exact:true})).toHaveValue('Closed Cloud transcript');expect(await page.evaluate(()=>(window as any).cloudNotesVoice.uploads)).toBe(2);await noPhysicalOrLocalVoice(page);
});
for(const [code,message] of [
 ['voice-stt-decode','This recording could not be prepared for transcription. Choose Record again.'],
 ['voice-stt-connect','Eliza Cloud voice could not use your saved account. Sign in again in Settings. Your recording is kept.'],
 ['voice-stt-upload','The recording upload could not be confirmed. Check your connection. Your recording is kept.'],
 ['voice-stt-response','Eliza Cloud voice returned no usable transcript. Your recording is kept.'],
 ['voice-http-400','Eliza Cloud voice couldn’t complete this request. Try again later.'],
 ['voice-http-429',"Eliza Cloud voice reached your plan's request limit. Wait a moment, then try again. Your recording is kept."],
 ['voice-http-503','Eliza Cloud voice couldn’t complete this request. Try again later.'],
] as const)test(`${code} retains the recording and allows only an explicit retry`,async({page})=>{
 const f=await cloudNotesVoiceFixture(page);await page.evaluate(code=>(window as any).cloudNotesVoice.failureCode=code,code);await openNotesRecorder(page);await recordClosedClip(page);
 await notesRecorder(page).getByRole('button',{name:'Transcribe with Eliza Cloud',exact:true}).click();await expect(notesRecorder(page)).toContainText(message);await expect(notesRecorder(page)).not.toContainText('PRIVATE_TRANSCRIPTION_SENTINEL');
 await expect(notesRecorder(page).getByRole('button',{name:'Transcribe with Eliza Cloud',exact:true})).toBeEnabled();await expect(notesRecorder(page).getByRole('button',{name:'Record again',exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).cloudNotesVoice.uploads)).toBe(1);
 await page.evaluate(()=>(window as any).cloudNotesVoice.failureCode=null);await notesRecorder(page).getByRole('button',{name:'Transcribe with Eliza Cloud',exact:true}).click();await expect(notesRecorder(page).getByRole('textbox',{name:'Review transcript',exact:true})).toHaveValue('Closed Cloud transcript');
 expect(await page.evaluate(()=>{const f=(window as any).cloudNotesVoice;return {uploads:f.uploads,same:f.requests[0].recordingId===f.requests[1].recordingId&&f.requests[0].recordingId===f.clip};})).toEqual({uploads:2,same:true});await noPhysicalOrLocalVoice(page);expect(f.foreign).toEqual([]);
});

test('a Cloud speech 429 keeps the clip, shows the retry time and records the account limit',async({page})=>{
 const f=await cloudNotesVoiceFixture(page);
 await page.evaluate(async()=>{const v=(window as any).cloudNotesVoice;v.failureCode='voice-http-429';v.failureData={retryAfterSeconds:42,limitCode:'rate_limited',message:'PRIVATE_PROVIDER_BODY_SENTINEL'};v.limits=[];
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');c.noteCloudServiceLimit=(limit:any,sessionId:any)=>{v.limits.push({kind:limit?.kind,retryAfterMs:limit?.retryAfterMs,sessionId});return true;};});
 await openNotesRecorder(page);await recordClosedClip(page);
 await notesRecorder(page).getByRole('button',{name:'Transcribe with Eliza Cloud',exact:true}).click();
 await expect(notesRecorder(page)).toContainText("Eliza Cloud voice reached your plan's request limit. Try again in about 42 seconds. Your recording is kept.");
 await expect(notesRecorder(page)).not.toContainText('PRIVATE_PROVIDER_BODY_SENTINEL');await expect(notesRecorder(page)).not.toContainText('PRIVATE_TRANSCRIPTION_SENTINEL');
 await expect(notesRecorder(page).getByRole('button',{name:'Transcribe with Eliza Cloud',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>(window as any).cloudNotesVoice.limits)).toEqual([{kind:'rate-limited',retryAfterMs:42_000,sessionId:'fixture-account-a'}]);
 // The kept clip is the one an explicit retry uploads.
 await page.evaluate(()=>{const v=(window as any).cloudNotesVoice;v.failureCode=null;v.failureData=null;});await notesRecorder(page).getByRole('button',{name:'Transcribe with Eliza Cloud',exact:true}).click();
 await expect(notesRecorder(page).getByRole('textbox',{name:'Review transcript',exact:true})).toHaveValue('Closed Cloud transcript');
 expect(await page.evaluate(()=>{const v=(window as any).cloudNotesVoice;return {uploads:v.uploads,same:v.requests[0].recordingId===v.requests[1].recordingId&&v.requests[0].recordingId===v.clip};})).toEqual({uploads:2,same:true});
 await noPhysicalOrLocalVoice(page);expect(f.foreign).toEqual([]);
});

for(const exit of ['cancel','background','account'] as const)test(`${exit} during Cloud transcription retires late words without saving`,async({page})=>{
 await cloudNotesVoiceFixture(page);await page.evaluate(()=>(window as any).cloudNotesVoice.hold=true);await openNotesRecorder(page);await recordClosedClip(page);await notesRecorder(page).getByRole('button',{name:'Transcribe with Eliza Cloud',exact:true}).click();await expect.poll(()=>page.evaluate(()=>typeof(window as any).cloudNotesVoice.release)).toBe('function');
 if(exit==='cancel')await notesRecorder(page).getByRole('button',{name:'Cancel transcription',exact:true}).click();
 else await page.evaluate(async exit=>{if(exit==='background'){Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));}else{(window as any).cloudNotesVoice.owner='b';(await import('/src/runtime/connection-ui.tsx')).connectionController.close();}},exit);
 await page.evaluate(()=>(window as any).cloudNotesVoice.release());await expect(notesRecorder(page).getByRole('textbox',{name:'Review transcript',exact:true})).toHaveCount(0);expect(await page.evaluate(async()=>JSON.parse((await(await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())||'{"records":[]}').records.length)).toBe(0);await noPhysicalOrLocalVoice(page);
});
