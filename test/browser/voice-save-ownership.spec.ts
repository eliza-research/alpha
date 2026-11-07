import {openLegacyNotes} from './helpers/legacy-notes';
import {installCloudVoiceFixture} from './cloud-voice-fixture';
import {test,expect,type Page} from '@playwright/test';
async function audio(page:Page){await page.evaluate(()=>{const w=window as any;w.voiceSave={sources:[],chunks:0,writes:0,held:false,settled:false};const devices=navigator.mediaDevices;Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:devices});devices.getUserMedia=async()=>{const context=new AudioContext(),osc=context.createOscillator(),sink=context.createMediaStreamDestination();osc.connect(sink);osc.start();await context.resume();w.voiceSave.sources.push({context,osc,stream:sink.stream});return sink.stream;};const Original=MediaRecorder;w.MediaRecorder=class extends Original{constructor(stream:MediaStream,options?:MediaRecorderOptions){super(stream,options);this.addEventListener('dataavailable',e=>{if(e.data.size)w.voiceSave.chunks++;});}};});}
// A new voice note (the Notes recorder): Done holds the recording until the note itself is saved.
for(const outcome of ['success','failure'] as const)test(`owned new voice note save ${outcome} keeps the recording until the note is confirmed`,async({page})=>{
 await page.goto('/?mode=dev');await audio(page);await installCloudVoiceFixture(page,'Recorded retained words');await openLegacyNotes(page);await page.getByRole('button',{name:'Record and transcribe',exact:true}).click();
 const recorder=page.locator('[data-alpha-subview="notes-recorder"]');await expect(recorder).toHaveAttribute('data-recorder-state','recording');await expect.poll(()=>page.evaluate(()=>(window as any).voiceSave.chunks)).toBeGreaterThan(0);
 await page.evaluate(async(outcome)=>{const {DocumentNotesStore:NotesStore}=await import('/src/runtime/browser-notes-document.ts');const original=NotesStore.prototype.replace;NotesStore.prototype.replace=async function(...args:any[]){const w=window as any;w.voiceSave.writes++;await original.apply(this,args as any);if(w.voiceSave.held)return;w.voiceSave.held=true;return new Promise<void>((resolve,reject)=>{w.voiceSave.release=()=>{outcome==='failure'?reject(Error('Synthetic lost response')):resolve();};});};},outcome);
 await recorder.getByRole('button',{name:'Done',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).voiceSave.held)).toBe(true);await expect(recorder.getByRole('button',{name:'Done',exact:true})).toBeDisabled();
 await page.evaluate(()=>(window as any).voiceSave.release());
 const status=()=>page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return (await registerPlugin<any>('AlphaVoiceCloud').noteRecordingStatus()).state;});
 if(outcome==='failure'){
  // An unconfirmed Notes write keeps the recording and says so in one line; nothing is discarded.
  await expect(recorder.getByRole('alert')).toHaveText('Couldn’t save. Try Done again.');await expect(recorder).toHaveAttribute('data-recorder-state','stopped');expect(await status()).toBe('stopped');
 }else{await expect(recorder).toHaveCount(0);await expect(page.getByRole('button',{name:'Play recording',exact:true})).toBeVisible();expect(await status()).toBe('idle');}
 const notes=await page.evaluate(async()=>JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())!).records);expect(notes.filter((n:any)=>n.kind==='voice'&&n.body==='Recorded retained words')).toHaveLength(1);
 await page.evaluate(async()=>{for(const s of (window as any).voiceSave.sources){s.osc.stop();await s.context.close();}});
});
