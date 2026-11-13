import {canonicalNotesFixture,openCanonicalNotes} from './helpers/canonical-notes';
import {test,expect,type Page,type TestInfo} from '@playwright/test';
import {installCloudVoiceFixture} from './cloud-voice-fixture';
async function storedAudio(page:Page){
 return page.evaluate(async()=>{
  const note=(window as any).canonicalNotesFixture.state.notes.find((row:any)=>row.title==='Browser audio journey');
  const {audioRecord}=await import('/src/browser/note-audio-store.ts'),row=await audioRecord(note.format.data.audio.audioId);
  const bytes=await row.blob.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes);
  const decoded=await new OfflineAudioContext(1,1,24000).decodeAudioData(bytes.slice(0));
  return {sha256:Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join(''),bytes:bytes.byteLength,
   mimeType:row.blob.type,durationMs:row.durationMs,decodedSeconds:decoded.duration,channels:decoded.numberOfChannels};
 });
}
async function audioJourney(page:Page,info:TestInfo,unsupported=false){
 if(unsupported)await page.addInitScript(()=>Object.defineProperty(window,'MediaRecorder',{configurable:true,value:undefined}));
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.addInitScript(()=>{const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){this.muted=true;return play.call(this);};});
 await canonicalNotesFixture(page);
 await installCloudVoiceFixture(page,'A recorded note saved through the real Notes interface.');
 // The synthetic signal goes only to the recording stream, never the speakers. Resume on
 // the actual Record click, since a prior navigation click need not unlock background Web Audio.
 await page.bringToFront();
 await page.evaluate(async()=>{
  const ctx=new AudioContext(),osc=ctx.createOscillator(),gain=ctx.createGain(),sink=ctx.createMediaStreamDestination();gain.gain.value=.1;osc.connect(gain);gain.connect(sink);osc.start();
  document.addEventListener('click',()=>{void ctx.resume();},{capture:true});
  const f=(window as any).fixture={ctx,osc,binding:null};
  const {BrowserVoice}=await import('/src/browser/voice.ts'),start=BrowserVoice.prototype.startNoteRecording;
  BrowserVoice.prototype.startNoteRecording=async function(binding){f.binding=structuredClone(binding);return start.call(this,binding);};
  const Original=window.MediaRecorder;(window as any).recordedBytes=0;
  if(Original)window.MediaRecorder=class extends Original{constructor(stream:MediaStream,options?:MediaRecorderOptions){super(stream,options);this.addEventListener('dataavailable',event=>{(window as any).recordedBytes+=event.data.size;});}};
  Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{await ctx.resume();return sink.stream;}},configurable:true});
 });
 await openCanonicalNotes(page);await page.bringToFront();
 const captures=await page.evaluate(()=>typeof MediaRecorder==='function');
 const recorder=page.locator('[data-alpha-subview="notes-recorder"]');
 await page.getByRole('button',{name:'Record voice note',exact:true}).click();
 let encodedSha256:string|undefined;
 if(captures){
  info.annotations.push({type:'evidence',description:'Real browser MediaRecorder capture from a synthetic oscillator.'});
  await expect.poll(()=>page.evaluate(()=>(window as any).fixture.ctx.state)).toBe('running');
  await expect(recorder).toHaveAttribute('data-recorder-state','recording');
  await expect.poll(()=>page.evaluate(()=>(window as any).recordedBytes)).toBeGreaterThan(0);
  await expect(recorder.getByText(/Record up to|Nothing is uploaded|Waveform levels/)).toHaveCount(0);
  await recorder.getByRole('button',{name:'Pause',exact:true}).click();
  await expect(recorder).toHaveAttribute('data-recorder-state','paused');
  await recorder.getByRole('button',{name:'Resume',exact:true}).click();
  await expect(recorder).toHaveAttribute('data-recorder-state','recording');
  await recorder.getByRole('button',{name:'Stop recording',exact:true}).click();
 }else{
  info.annotations.push({type:'evidence',description:'MediaRecorder unavailable: capture refusal plus encoded PCM audio recovery/storage; no capture claimed.'});
  await expect(recorder).toHaveAttribute('data-recorder-state','failed');
  await expect(recorder.getByRole('alert')).toHaveText('Mic unavailable');
  expect(await page.evaluate(()=>(window as any).canonicalNotesFixture.state.notes)).toEqual([]);
  expect(await page.evaluate(async()=>{const {pendingAudio}=await import('/src/browser/note-audio-store.ts');await pendingAudio();const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('alpha.browser.audio.v1');r.onsuccess=()=>resolve(r.result);});const count=await new Promise<number>(resolve=>{const r=db.transaction('audio').objectStore('audio').count();r.onsuccess=()=>resolve(r.result);});db.close();return count;})).toBe(0);
  await recorder.getByRole('button',{name:'Discard recording',exact:true}).click();await expect(recorder).toHaveCount(0);
  encodedSha256=await page.evaluate(async()=>{
   // A valid three-second, mono PCM WAV. This represents retained bytes from an earlier
   // capable client, not a MediaRecorder replacement or fabricated recording result.
   const rate=24000,samples=rate*3,bytes=new ArrayBuffer(44+samples*2),view=new DataView(bytes),text=(at:number,value:string)=>{for(let i=0;i<value.length;i++)view.setUint8(at+i,value.charCodeAt(i));};
   text(0,'RIFF');view.setUint32(4,bytes.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,samples*2,true);
   for(let sample=0;sample<samples;sample++)view.setInt16(44+sample*2,Math.round(Math.sin(2*Math.PI*440*sample/rate)*3276),true);
   const {retainPendingAudio}=await import('/src/browser/note-audio-store.ts');
   await retainPendingAudio('encoded-audio-storage-fixture',(window as any).fixture.binding,{blob:new Blob([bytes],{type:'audio/wav'}),durationMs:3000},'');
   return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
  });
  // Recover through the real recorder journal and canonical claim/save; do not create a note by hand.
  await page.getByRole('button',{name:'Record voice note',exact:true}).click();
  await expect(recorder).toHaveAttribute('data-recorder-state','stopped');
  await recorder.getByRole('button',{name:'Save recording',exact:true}).click();
 }
 await expect(recorder).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).cloudVoiceFixture.transcriptions.length)).toBe(0);
 await expect(page.getByRole('button',{name:'Play recording',exact:true})).toBeVisible();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Browser audio journey');
 // Reload only after asynchronous title autosave reaches the durable document.
 await expect.poll(()=>page.evaluate(()=>(window as any).canonicalNotesFixture.state.notes.some((note:any)=>note.title==='Browser audio journey'&&note.body===''&&!!note.format?.data.audio?.audioId))).toBe(true);
 const stored=await storedAudio(page);expect(stored.bytes).toBeGreaterThan(44);expect(stored.decodedSeconds).toBeGreaterThan(0);expect(stored.channels).toBeGreaterThan(0);
 if(encodedSha256){expect(stored.sha256).toBe(encodedSha256);expect(stored.durationMs).toBe(3000);expect(stored.decodedSeconds).toBe(3);expect(stored.channels).toBe(1);}
 await info.attach('audio-storage-bytes',{body:JSON.stringify({capture:captures,...stored}),contentType:'application/json'});
 await page.evaluate(async()=>{const {ctx,osc}=(window as any).fixture;osc.stop();await ctx.close();});
 // The canonical transport is closed fixture state, not server persistence proof.
 // Rebind its unchanged records after a real client reload; audio stays in real IndexedDB.
 const kept=await page.evaluate(()=>(window as any).canonicalNotesFixture.state.notes);
 await canonicalNotesFixture(page,{notes:kept});await openCanonicalNotes(page);await page.getByRole('button',{name:'Open Browser audio journey',exact:true}).click();
 await expect(page.getByRole('button',{name:'Play recording',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Generate transcript',exact:true})).toBeVisible();
 expect(await storedAudio(page)).toEqual(stored);
 const activity=page.getByRole('img',{name:'Recording playback activity',exact:true});
 await expect(activity.locator('[data-alpha-voice-bar]')).toHaveCount(35);
 await expect.poll(()=>activity.locator('[data-alpha-voice-bar]').first().evaluate(bar=>{
  const bounds=bar.getBoundingClientRect();return bounds.width>0&&bounds.height>0;
 })).toBe(true);
 const note=await page.evaluate(()=>{const row=(window as any).canonicalNotesFixture.state.notes.find((n:any)=>n.title==='Browser audio journey');return {...row,audio:{...row.format.data.audio,noteId:row.id}};});
 const replay=await page.evaluate(async(note)=>{
  const {registerPlugin}=await import('/src/platform-plugins.ts');const voice=registerPlugin<any>('AlphaVoiceCloud');
  const result=await voice.saveRecording({recordingId:note.audio.audioId,noteId:note.id,transcript:note.body});
  let wrongOwner=false;try{await voice.saveRecording({recordingId:note.audio.audioId,noteId:'different-note',transcript:note.body});}catch{wrongOwner=true;}
  const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('alpha.browser.audio.v1');r.onsuccess=()=>resolve(r.result);});
  const count=await new Promise<number>(resolve=>{const r=db.transaction('audio').objectStore('audio').count();r.onsuccess=()=>resolve(r.result);});db.close();return {audioId:result.audioId,wrongOwner,count};
 },note);
 expect(replay).toEqual({audioId:note.audio.audioId,wrongOwner:true,count:1});
 await page.getByRole('button',{name:'Play recording',exact:true}).click();
 await expect(page.getByRole('button',{name:'Stop recording playback',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Play recording',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('dialog',{name:'Note actions'}).getByRole('button',{name:'Delete',exact:true}).click();
 await expect(page.getByText('Deleted',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>({notes:(window as any).canonicalNotesFixture.state.notes.length,trash:(window as any).canonicalNotesFixture.state.trash.length}))).toEqual({notes:0,trash:1});
 expect(await page.evaluate(async(id)=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return (await registerPlugin<any>('AlphaNoteAudio').describe({audioId:id})).noteId;},note.audio.audioId)).toBe(note.id);
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await expect.poll(()=>page.evaluate(async(id)=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return (await registerPlugin<any>('AlphaNoteAudio').describe({audioId:id})).deletedAt;},note.audio.audioId)).toBeUndefined();
 await page.getByRole('button',{name:'Open Browser audio journey',exact:true}).click();
 await page.getByRole('button',{name:'Play recording',exact:true}).click();await expect(page.getByRole('button',{name:'Stop recording playback',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Stop recording playback',exact:true}).click();
 await expect(page.getByRole('button',{name:'Play recording',exact:true})).toBeVisible();
 expect(await storedAudio(page)).toEqual(stored);
 await page.screenshot({path:info.outputPath('restored-voice-note.png')});
}

test('canonical Notes saves audio before transcription, keeps it across client reload and restores the same recording',async({page},info)=>audioJourney(page,info));
test('unsupported capture writes nothing and recovers encoded audio through reload, playback and Undo',async({page},info)=>audioJourney(page,info,true));
