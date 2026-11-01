import {test,expect,type Page} from '@playwright/test';
import {button} from './flag-off-android';
import {setupNativeSpeech} from './native-speech-fixture';
import {setupLiveAssistant} from './voice-assistant-fixture';
// Source-served synthetic API checks, NOT production-bundle UI or phone acceptance.
// Preserved from native-speech.production: append reviewed text, cancel late ASR,
// unavailable capture, background retirement (four cases). Preserved from
// voice-assistant.production: live dictation versus assistant submission and lost
// capture recovery (two cases); interruptSpeech accounting is retained separately.
// Dictation's public component API is retained but there is no chat dictation button.
// Override only the source build-flags module to exercise local/native branches; no shipped hooks.
test.beforeEach(async({page})=>{await page.route('**/src/build-flags.ts*',route=>route.fulfill({contentType:'application/javascript',body:'export const testMocksEnabled=false;export const devSurfacesEnabled=false;export const cloudRuntimeEnabled=false;export const privateLocalPreviewEnabled=false;export const updateChannelCheckEnabled=false;'}));});
async function captureApi(page:Page){
 await page.evaluate(async()=>{const {Component}=await import('/src/prototype/model.js'),{connectionController:c}=await import('/src/runtime/connection-ui.tsx');const render=Component.prototype.renderVals;Component.prototype.renderVals=function(){(window as any).dictationApiFixture=this;return render.call(this);};c.close();});
 await expect.poll(()=>page.evaluate(()=>!!(window as any).dictationApiFixture)).toBe(true);
}
async function setupNative(page:Page){const foreign=await setupNativeSpeech(page);await captureApi(page);return foreign;}
async function setupLive(page:Page){
 const foreign=await setupLiveAssistant(page);await captureApi(page);
 // Observe the actual shared controller, not an obsolete renderer callback.
 await page.evaluate(async()=>{const {VoiceAssistantSession}=await import('/src/runtime/voice-assistant.ts');const start=VoiceAssistantSession.prototype.start;VoiceAssistantSession.prototype.start=function(){(window as any).live.sharedVoiceSession=this;return start.call(this);};});
 return foreign;
}
async function invokeDictation(page:Page){await page.evaluate(()=>(window as any).dictationApiFixture.startTranscription());}
const voice=(page:Page)=>page.getByRole('region',{name:'Voice conversation',exact:true});
async function noCloud(page:Page,foreign:string[]){expect(await page.evaluate(()=>(window as any).nativeSpeech.forbidden)).toEqual([]);expect(foreign).toEqual([]);}
const live=<T,>(page:Page,read:(f:any)=>T)=>page.evaluate(`(${read.toString()})(window.live)`) as Promise<T>;
async function say(page:Page,text:string){
 await page.evaluate(text=>{const f=(window as any).live,t=Date.now();f.finals.push(text);f.frames([t-64,t-32,t],[{type:'speech-start',timestampMs:t-64}]);},text);
 await page.waitForTimeout(150);
 await page.evaluate(()=>{const f=(window as any).live,t=Date.now();f.frames([t],[{type:'speech-end',timestampMs:t}]);});
}
const posts=(page:Page)=>page.evaluate(()=>(window as any).flagOff.posts.map((text:string)=>text.split('[USER MESSAGE]\n').at(-1))) as Promise<string[]>;
async function clean(page:Page,foreign:string[]){expect(await live(page,f=>f.forbidden)).toEqual([]);expect(foreign).toEqual([]);}
const transcription=(page:Page)=>page.getByRole('region',{name:'Voice transcription',exact:true});
test('API dictation: Transcribe stops into editable local text and appends only to the unsent draft',async({page},info)=>{
 const foreign=await setupNative(page);const composer=page.locator('textarea[data-alpha-composer]');await composer.fill('Existing unsent text');await invokeDictation(page);await expect(transcription(page)).toHaveAttribute('data-voice-state','recording');await button(page,'Stop recording').click();await expect(transcription(page)).toHaveAttribute('data-voice-state','review');await page.getByRole('textbox',{name:'Review transcript',exact:true}).fill('Edited local transcript');await page.screenshot({path:info.outputPath('transcription-review.png')});await button(page,'Use in draft').click();await expect(transcription(page)).toHaveCount(0);await expect(page.locator('textarea[data-alpha-composer]')).toHaveValue('Existing unsent text\nEdited local transcript');expect(await page.evaluate(()=>(window as any).flagOff.posts)).toEqual([]);expect(await page.evaluate(()=>(window as any).nativeSpeech.transcripts)).toBe(1);await noCloud(page,foreign);
});
test('API dictation: Transcribe cancellation discards late ASR and preserves the original draft',async({page})=>{
 const foreign=await setupNative(page);await page.locator('textarea[data-alpha-composer]').fill('Keep this draft');await page.evaluate(()=>(window as any).nativeSpeech.holdTranscript=true);await invokeDictation(page);await expect(transcription(page)).toHaveAttribute('data-voice-state','recording');await button(page,'Stop recording').click();await expect(transcription(page)).toHaveAttribute('data-voice-state','transcribing');await button(page,'Cancel transcription').click();await expect(transcription(page)).toHaveCount(0);await page.evaluate(()=>(window as any).nativeSpeech.releaseTranscript());await expect(page.locator('textarea[data-alpha-composer]')).toHaveValue('Keep this draft');expect(await page.evaluate(()=>(window as any).flagOff.posts)).toEqual([]);expect(await page.evaluate(()=>(window as any).nativeSpeech.starts)).toBe(1);await noCloud(page,foreign);
});
test('API dictation: unavailable Transcribe retains keyboard and never starts a capture',async({page})=>{
 const foreign=await setupNative(page);await page.evaluate(()=>(window as any).nativeSpeech.ready=false);await invokeDictation(page);await expect(transcription(page)).toContainText('On-device speech is unavailable');await button(page,'Switch to keyboard').click();await expect(transcription(page)).toHaveCount(0);await expect(page.locator('textarea[data-alpha-composer]')).toBeVisible();expect(await page.evaluate(()=>(window as any).nativeSpeech.starts)).toBe(0);await noCloud(page,foreign);
});
test('API dictation: leaving foreground during Transcribe discards late output without changing the draft',async({page})=>{
 const foreign=await setupNative(page);await page.locator('textarea[data-alpha-composer]').fill('Original draft');await page.evaluate(()=>(window as any).nativeSpeech.holdTranscript=true);await invokeDictation(page);await expect(transcription(page)).toHaveAttribute('data-voice-state','recording');await button(page,'Stop recording').click();await expect(transcription(page)).toHaveAttribute('data-voice-state','transcribing');await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await expect(transcription(page)).toHaveCount(0);await page.evaluate(()=>(window as any).nativeSpeech.releaseTranscript());await expect(page.locator('textarea[data-alpha-composer]')).toHaveValue('Original draft');expect(await page.evaluate(()=>(window as any).flagOff.posts)).toEqual([]);await noCloud(page,foreign);
});

test('API dictation and assistant stay distinct: draft editing never sends, voice conversation submits',async({page})=>{
 const foreign=await setupLive(page);
 await expect(button(page,'Transcribe')).toHaveCount(0);
 await expect(button(page,'Talk')).toHaveAttribute('title','Voice assistant');
 await page.locator('textarea[data-alpha-composer]').fill('Existing text');
 await invokeDictation(page);
 await expect(transcription(page)).toHaveAttribute('data-voice-state','recording');
 expect(await live(page,f=>f.captures.map((c:any)=>c.echoCancel))).toEqual([false]);
 await say(page,'Pick up the dry cleaning');
 // Stop: one frame read before the tap is still in flight; one stamped after it must not be used.
 await page.evaluate(()=>{const f=(window as any).live;f.onStop=(id:string)=>{const t=Date.now();f.emit('liveCaptureFrames',{captureId:id,frames:[f.frame(t-1000),f.frame(t+400)],vad:[],peak:.2});f.finals.push('and the mail');f.onStop=null;};});
 await page.evaluate(()=>{const f=(window as any).live,t=Date.now();f.frames([t],[{type:'speech-start',timestampMs:t}]);});
 await button(page,'Stop recording').click();
 await expect(transcription(page)).toHaveAttribute('data-voice-state','review');
 await expect(page.getByRole('textbox',{name:'Review transcript',exact:true})).toHaveValue('Pick up the dry cleaning and the mail');
 const routes=await live(page,f=>f.routes);
 const stopAt=Math.max(...routes.flatMap((r:any)=>r.vad??[]).filter((e:any)=>e.type==='speech-end').map((e:any)=>e.timestampMs));
 expect(routes.flatMap((r:any)=>(r.frames??[]).map((x:any)=>x.timestamp)).every((t:number)=>t<=stopAt)).toBe(true);
 expect(routes.at(-1).close).toBe(true);
 await page.getByRole('textbox',{name:'Review transcript',exact:true}).fill('Pick up the dry cleaning and the mail today');
 await button(page,'Use in draft').click();
 await expect(page.locator('textarea[data-alpha-composer]')).toHaveValue('Existing text\nPick up the dry cleaning and the mail today');
 expect(await posts(page)).toEqual([]);

 await page.locator('textarea[data-alpha-composer]').fill('');
 await expect(button(page,'Talk')).toBeVisible();
 await button(page,'Talk').click();
 await expect(voice(page)).toHaveAttribute('data-voice-state','listening');
 expect(await live(page,f=>f.captures.map((c:any)=>c.echoCancel))).toEqual([false,true]);
 await expect(voice(page)).toContainText('Listening…');
 await say(page,'What is on my calendar today');
 await expect.poll(()=>posts(page)).toEqual(['What is on my calendar today']);
 await expect(voice(page)).toHaveAttribute('data-voice-state','speaking');
 await button(page,'Stop voice conversation').click();
 await expect(voice(page)).toHaveCount(0);
 await expect.poll(()=>live(page,f=>f.stops.length)).toBe(2);
 await clean(page,foreign);
});

test('API interruptSpeech preserves listening; Mute controls capture with pressed state',async({page})=>{
 const foreign=await setupLive(page);
 await page.evaluate(()=>{(window as any).flagOff.replies.push('Here is a long answer about the weather this week.');});
 await button(page,'Talk').click();
 await expect(voice(page)).toHaveAttribute('data-voice-state','listening');
 const mute=voice(page).getByRole('button',{name:'Mute microphone',exact:true});
 await expect(mute).toHaveAttribute('aria-pressed','false');
 await mute.click();
 await expect(voice(page).getByRole('button',{name:'Unmute microphone',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect.poll(()=>live(page,f=>f.stops.length)).toBe(1);
 await expect(voice(page)).toContainText('Microphone off');
 await voice(page).getByRole('button',{name:'Unmute microphone',exact:true}).click();
 await expect.poll(()=>live(page,f=>f.captures.length)).toBe(2);
 await say(page,'How is the weather');
 await expect(voice(page)).toHaveAttribute('data-voice-state','speaking');
 expect(await page.evaluate(()=>typeof(window as any).dictationApiFixture.renderVals().chatRecorder.interrupt)).toBe('undefined');
 await expect.poll(()=>live(page,f=>typeof f.sharedVoiceSession?.interruptSpeech)).toBe('function');
 expect(await page.evaluate(()=>(window as any).live.sharedVoiceSession.interruptSpeech())).toBe(true);
 await expect(voice(page)).toHaveAttribute('data-voice-state','listening');
 await expect.poll(()=>live(page,f=>f.stopped)).toBeGreaterThan(0);
 expect(await live(page,f=>({starts:f.captures.length,stops:f.stops.length}))).toEqual({starts:2,stops:1});
 await button(page,'Stop voice conversation').click();
 await expect.poll(()=>live(page,f=>f.stops.length)).toBe(2);
 await expect(page.getByText('(Interrupted before this reply was played.)')).toBeVisible();
 expect(await posts(page)).toEqual(['How is the weather']);
 await clean(page,foreign);
});

test('API dictation recovery: without an echo canceller, speech during playback never interrupts; a lost Transcribe capture can start again',async({page})=>{
 const foreign=await setupLive(page);
 await page.evaluate(()=>{const w=window as any;w.live.noCanceller=true;w.flagOff.replies.push('The library closes at six tonight.');});
 await button(page,'Talk').click();
 await expect(voice(page)).toHaveAttribute('data-voice-state','listening');
 await say(page,'When does the library close');
 await expect(voice(page)).toHaveAttribute('data-voice-state','speaking');
 const stopped=await live(page,f=>f.stopped);
 await say(page,'closes at six tonight');
 await page.waitForTimeout(1600);
 expect(await live(page,f=>f.stopped)).toBe(stopped);
 await expect(voice(page)).toHaveAttribute('data-voice-state','speaking');
 expect(await posts(page)).toEqual(['When does the library close']);
 await button(page,'Stop voice conversation').click();
 await expect(voice(page)).toHaveCount(0);
 // Transcribe: the microphone is lost mid-recording; recording again works.
 await invokeDictation(page);
 await expect(transcription(page)).toHaveAttribute('data-voice-state','recording');
 await page.evaluate(()=>{const f=(window as any).live;f.emit('liveCaptureEnded',{captureId:f.active,error:'capture'});f.active=null;});
 await expect(transcription(page)).toHaveAttribute('data-voice-state','ready');
 await button(page,'Start recording').click();
 await expect(transcription(page)).toHaveAttribute('data-voice-state','recording');
 await say(page,'Buy stamps');
 await button(page,'Stop recording').click();
 await expect(page.getByRole('textbox',{name:'Review transcript',exact:true})).toHaveValue('Buy stamps');
 expect(await live(page,f=>f.captures.length)).toBe(3);
 await clean(page,foreign);
});
