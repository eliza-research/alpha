import { returnToApps } from './app-navigation';
import {selectLegacyNotes} from './helpers/legacy-notes';
import {test,expect} from '@playwright/test';
for(const mode of ['lost-audio','unknown-audio','lost-notes','large-lost-notes','stale-before','stale-after','stale-recreated','navigate'] as const)test(`voice note deletion ${mode}`,async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await page.evaluate(async(mode)=>{
  const {openBrowserNotes,DocumentNotesStore:NotesStore}=await import('/src/runtime/browser-notes-document.ts');
  const {retainAudio}=await import('/src/browser/note-audio-store.ts');
  const text=mode==='large-lost-notes'?'記'.repeat(32768):'Reviewed text';
  const audio=await retainAudio('delete-audio','delete-note',text,{blob:new Blob(['synthetic'],{type:'audio/wav'}),durationMs:1000});
  const store=await openBrowserNotes();await store.replace([{id:'delete-note',kind:'voice',title:'Delete review',body:text,audio,dur:1,summary:[],actions:[],lines:[{s:'me',at:0,t:text}],pinned:false,when:'Today',customMetadata:{preserved:'verbatim'}}]);
 },mode);
 await page.reload();await selectLegacyNotes(page);await page.getByRole('button',{name:'Open Delete review',exact:true}).click();
 await page.evaluate(async(mode)=>{
  const {BrowserVoice}=await import('/src/browser/voice.ts');const {openBrowserNotes,DocumentNotesStore:NotesStore}=await import('/src/runtime/browser-notes-document.ts');
  const original=BrowserVoice.prototype.remove,execute=NotesStore.prototype.execute;
  (window as any).audioDeletes=0;
  BrowserVoice.prototype.remove=async function(input:any){(window as any).audioDeletes++;if(mode==='navigate')await new Promise<void>(r=>(window as any).releaseDelete=r);await original.call(this,input);if(mode==='lost-audio'||mode==='unknown-audio')throw Error('Lost delete reply');};
  if(mode==='stale-recreated'){const originalNote=JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())!).records[0],describe=BrowserVoice.prototype.describe;BrowserVoice.prototype.describe=async function(input:any){if(!JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())!).records.length)await (await openBrowserNotes()).replace([{...originalNote,body:'Newer revision'}]);return describe.call(this,input);};}
  if(mode==='unknown-audio'){const describe=BrowserVoice.prototype.describe;BrowserVoice.prototype.describe=async function(input:any){if((window as any).audioDeletes)throw Error('Readback unavailable');return describe.call(this,input);};}
  NotesStore.prototype.execute=async function(...args:any[]){if(mode==='stale-after'){const data=JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())!);data.records[0].body='Newer revision';(await (await import('/src/runtime/browser-notes-document.ts')).browserNotesPort.compareExchange((await (await import('/src/runtime/browser-notes-document.ts')).browserNotesPort.read())!,JSON.stringify(data)));}const result=await execute.apply(this,args as any);if(mode==='lost-notes'||mode==='large-lost-notes')throw Error('Lost Notes reply');return result;};
  if(mode==='stale-before'){const data=JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())!);data.records[0].body='Newer revision';(await (await import('/src/runtime/browser-notes-document.ts')).browserNotesPort.compareExchange((await (await import('/src/runtime/browser-notes-document.ts')).browserNotesPort.read())!,JSON.stringify(data)));}
 },mode);
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('dialog',{name:'Note actions'}).getByRole('button',{name:'Delete',exact:true}).click();
 if(mode==='navigate'){await expect.poll(()=>page.evaluate(()=>typeof(window as any).releaseDelete)).toBe('function');await returnToApps(page);await page.evaluate(()=>(window as any).releaseDelete());await expect(page.getByRole('button',{name:'Notes',exact:true})).toBeVisible();}
 if(mode==='lost-audio'||mode==='navigate'){await expect.poll(()=>page.evaluate(()=>(window as any).audioDeletes)).toBe(1);await expect.poll(()=>page.evaluate(async ()=>Object.keys(JSON.parse(JSON.stringify(await (await import('/src/runtime/note-audio-deletions.ts')).pendingAudioDeletions())||'{}')).length)).toBe(0);expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())!).records.length)).toBe(0);}
 else if(mode.startsWith('stale')){await expect(page.getByText(/Deletion is unconfirmed/).first()).toBeVisible();expect(await page.evaluate(()=>(window as any).audioDeletes)).toBe(0);expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())!).records[0].body)).toBe('Newer revision');}
 else {
  await expect(page.getByRole('button',{name:'Check deletion status',exact:true})).toBeVisible();
  const calls=await page.evaluate(()=>(window as any).audioDeletes);await page.getByRole('button',{name:'Check deletion status',exact:true}).click();expect(await page.evaluate(()=>(window as any).audioDeletes)).toBe(calls);
  await page.reload();await selectLegacyNotes(page);
  if(mode==='unknown-audio')await expect(page.getByRole('button',{name:'Check deletion status',exact:true})).toHaveCount(0);
  else {await page.getByRole('button',{name:'Restore note and recording',exact:true}).click();await expect(page.getByRole('button',{name:'Open Delete review',exact:true})).toBeVisible();await expect.poll(()=>page.evaluate(async()=>JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())!).records.some((note:any)=>note.id==='delete-note'))).toBe(true);if(mode==='large-lost-notes'){const restored=await page.evaluate(async ()=>JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())!).records[0]);expect(restored.body).toBe('記'.repeat(32768));expect(restored.lines[0].t).toBe(restored.body);expect(restored.audio.transcript).toBe(restored.body);expect(restored.customMetadata).toEqual({preserved:'verbatim'});}}
 }
});

test('cross-tab restore waits for held audio trash and preserves restored recording',async({page,context})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await page.evaluate(async()=>{
  const {openBrowserNotes,DocumentNotesStore:NotesStore}=await import('/src/runtime/browser-notes-document.ts');const {retainAudio}=await import('/src/browser/note-audio-store.ts');
  const audio=await retainAudio('two-tab-audio','two-tab-note','Text',{blob:new Blob(['synthetic']),durationMs:1000});
  await (await openBrowserNotes()).replace([{id:'two-tab-note',kind:'voice',title:'Two tab',body:'Text',audio,dur:1,lines:[],summary:[],actions:[]}]);
 });
 await page.reload();await selectLegacyNotes(page);await page.getByRole('button',{name:'Open Two tab',exact:true}).click();
 await page.evaluate(async()=>{const {BrowserVoice}=await import('/src/browser/voice.ts');const remove=BrowserVoice.prototype.remove;
 BrowserVoice.prototype.remove=async function(input:any){(window as any).trashEntered=true;await new Promise<void>(r=>(window as any).releaseTrash=r);return remove.call(this,input);};});
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('dialog',{name:'Note actions'}).getByRole('button',{name:'Delete',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).trashEntered)).toBe(true);
 const second=await context.newPage();await second.goto('/');await selectLegacyNotes(second);
 await second.getByRole('button',{name:'Restore note and recording',exact:true}).click();
 // Reconciliation, the Trash upkeep pass that releases unused source references (added with
 // linked-source grants) and the user-requested restore all queue behind held trash.
 await expect.poll(()=>second.evaluate(async()=> (await navigator.locks.query()).pending?.filter(x=>x.name==='alpha.notes-audio-effects.v1').length)).toBe(3);
 expect(await second.evaluate(async ()=>JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())!).records.length)).toBe(0);
 await page.evaluate(()=>(window as any).releaseTrash());
 await expect(second.getByRole('button',{name:'Open Two tab',exact:true})).toBeVisible();
 expect(await second.evaluate(async()=>{const {BrowserVoice}=await import('/src/browser/voice.ts');return !!(await new BrowserVoice().describe({audioId:'two-tab-audio'})).deletedAt;})).toBe(false);
 await second.close();
});
