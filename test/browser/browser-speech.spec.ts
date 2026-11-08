import {test,expect} from '@playwright/test';
import {cloudNotesVoiceFixture,notesRecorder,openNotesRecorder,recordAndFinish,savedVoiceNotes,noPhysicalOrLocalVoice} from './cloud-notes-voice-fixture';
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
test('unsigned Notes voice records, asks for sign-in once and saves the audio without uploading',async({page})=>{
 const f=await cloudNotesVoiceFixture(page,false);await openNotesRecorder(page);const panel=notesRecorder(page);
 await expect(panel).toHaveAttribute('data-recorder-state','recording');
 await expect(panel.getByRole('alert')).toHaveText('Sign in to transcribe. The audio is kept.');
 await panel.getByRole('button',{name:'Done',exact:true}).click();await expect(page.getByRole('button',{name:'Play recording',exact:true})).toBeVisible();
 const [saved]=await savedVoiceNotes(page);expect(saved.body).toBe('');expect(saved.transcription).toEqual({route:'manual'});
 expect(await page.evaluate(()=>(window as any).cloudNotesVoice.uploads)).toBe(0);await noPhysicalOrLocalVoice(page);expect(f.foreign).toEqual([]);
});
test('Cloud Notes recording is transcribed by segment and saved as one voice note with Cloud provenance',async({page})=>{
 const f=await cloudNotesVoiceFixture(page);await openNotesRecorder(page);const panel=notesRecorder(page);
 // No instructions, privacy narration or duration limit: a timer, levels and three controls.
 await expect(panel.getByRole('timer')).toHaveText('0:01');await expect(panel.getByRole('alert')).toHaveCount(0);
 for(const name of ['Discard recording','Discard','Pause','Done'])await expect(panel.getByRole('button',{name,exact:true})).toBeVisible();
 await recordAndFinish(page);await expect(page.getByRole('button',{name:'Play recording',exact:true})).toBeVisible();
 const [saved]=await savedVoiceNotes(page);expect(saved.body).toBe('Closed Cloud transcript');expect(saved.audio.audioId).toBe(await page.evaluate(()=>(window as any).cloudNotesVoice.clip));expect(saved.transcription).toEqual({route:'eliza-cloud'});
 expect(await page.evaluate(()=>{const f=(window as any).cloudNotesVoice;return {uploads:f.uploads,same:f.requests[0].recordingId===f.clip};})).toEqual({uploads:1,same:true});await noPhysicalOrLocalVoice(page);expect(f.foreign).toEqual([]);
});
test('a silent Cloud segment saves the recording with an empty transcript and no error',async({page})=>{
 await cloudNotesVoiceFixture(page);await page.evaluate(()=>(window as any).cloudNotesVoice.empty=true);await openNotesRecorder(page);await recordAndFinish(page);
 await expect(page.getByRole('button',{name:'Play recording',exact:true})).toBeVisible();const [saved]=await savedVoiceNotes(page);expect(saved.body).toBe('');await noPhysicalOrLocalVoice(page);
});
test('microphone denial keeps the recorder open with one line and no transcription or provider fallback',async({page})=>{
 await cloudNotesVoiceFixture(page);await page.evaluate(()=>(window as any).cloudNotesVoice.denied=true);await openNotesRecorder(page);const panel=notesRecorder(page);
 await expect(panel).toHaveAttribute('data-recorder-state','failed');await expect(panel.getByRole('alert')).toHaveText('Allow the microphone in Settings.');await expect(panel.getByRole('button',{name:'Done',exact:true})).toBeDisabled();
 await page.evaluate(()=>(window as any).cloudNotesVoice.denied=false);await panel.getByRole('button',{name:'Record',exact:true}).click();await expect(panel).toHaveAttribute('data-recorder-state','recording');
 expect(await page.evaluate(()=>(window as any).cloudNotesVoice.uploads)).toBe(0);await noPhysicalOrLocalVoice(page);
});
for(const code of ['voice-http-402','voice-stt-decode','voice-stt-connect','voice-stt-upload','voice-stt-response','voice-http-429'] as const)test(`${code} keeps the audio with one line, and Done retries the same segment`,async({page})=>{
 const f=await cloudNotesVoiceFixture(page);await page.evaluate(code=>(window as any).cloudNotesVoice.failureCode=code,code);await openNotesRecorder(page);const panel=notesRecorder(page);
 await panel.getByRole('button',{name:'Done',exact:true}).click();
 // Done saves the audio with the transcript up to the failed segment; nothing private is shown.
 await expect(page.getByRole('button',{name:'Play recording',exact:true})).toBeVisible();await expect(page.getByText('PRIVATE_TRANSCRIPTION_SENTINEL')).toHaveCount(0);
 const [saved]=await savedVoiceNotes(page);expect(saved.body).toBe('');expect(await page.evaluate(()=>(window as any).cloudNotesVoice.uploads)).toBe(1);await noPhysicalOrLocalVoice(page);expect(f.foreign).toEqual([]);
});
for(const exit of ['discard','account'] as const)test(`${exit} during Cloud transcription retires late words without saving`,async({page})=>{
 await cloudNotesVoiceFixture(page);await page.evaluate(()=>(window as any).cloudNotesVoice.hold=true);await openNotesRecorder(page);const panel=notesRecorder(page);
 await panel.getByRole('button',{name:'Done',exact:true}).click();await expect.poll(()=>page.evaluate(()=>typeof(window as any).cloudNotesVoice.release)).toBe('function');
 if(exit==='discard'){await panel.getByRole('button',{name:'Discard recording',exact:true}).click();await panel.getByRole('group',{name:'Discard this recording?'}).getByRole('button',{name:'Discard',exact:true}).click();}
 else await page.evaluate(async()=>{(window as any).cloudNotesVoice.owner='b';(await import('/src/runtime/connection-ui.tsx')).connectionController.close();});
 await page.evaluate(()=>(window as any).cloudNotesVoice.release());await page.waitForTimeout(300);
 if(exit==='discard'){await expect(panel).toHaveCount(0);expect(await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return (await registerPlugin<any>('AlphaVoiceCloud').noteRecordingStatus()).state;})).toBe('idle');}
 // Late words from a discarded or changed route never reach a note.
 expect((await savedVoiceNotes(page)).filter((n:any)=>n.body.includes('Closed Cloud transcript'))).toEqual([]);if(exit==='discard')expect(await savedVoiceNotes(page)).toEqual([]);await noPhysicalOrLocalVoice(page);
});
