import {openLegacyNotes} from './helpers/legacy-notes';
import { returnToApps } from './app-navigation';
import {test,expect,type Page} from '@playwright/test';
const DAY=24*60*60*1000;
const savedRecords=(page:Page)=>page.evaluate(async()=>JSON.parse(await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw()).records);
const trashEntries=(page:Page)=>page.evaluate(async()=>(await (await import('/src/runtime/notes-trash.ts')).readNotesTrash()).entries);
const openNotes=openLegacyNotes;
async function createNote(page:Page,title:string,body:string){
 await page.getByRole('button',{name:'New note',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill(title);
 await page.getByRole('textbox',{name:'Note',exact:true}).fill(body);
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await expect(page.getByRole('button',{name:`Open ${title}`,exact:true})).toBeVisible();
}
/** Editor ⋯ menu → Delete (PLAN.md section 3). */
async function deleteOpenNote(page:Page){
 await page.getByRole('button',{name:'More',exact:true}).click();
 await page.getByRole('dialog',{name:'Note actions'}).getByRole('button',{name:'Delete',exact:true}).click();
}
/** The "Recently deleted" folder chip, shown while it has notes. */
async function openDeleted(page:Page){await page.getByRole('button',{name:'Recently deleted',exact:true}).click();}
/** Row → Recover in the action sheet. */
async function recover(page:Page,title:string,left:string){
 await page.getByRole('button',{name:`${title}, ${left}`,exact:true}).click();
 await page.getByRole('dialog',{name:title}).getByRole('button',{name:'Recover',exact:true}).click();
}
async function deleteNote(page:Page,title:string){
 await page.getByRole('button',{name:`Open ${title}`,exact:true}).click();
 await deleteOpenNote(page);
 await expect(page.getByText('Moved to Recently deleted',{exact:true}).last()).toBeVisible();
 await expect(page.getByRole('button',{name:`Open ${title}`,exact:true})).toHaveCount(0);
}

test('deleted notes survive a restart in Recently deleted, restore with the same identity, and Undo still works',async({page})=>{
 await page.goto('/');await openNotes(page);
 await createNote(page,'Trash audit','Keep this exact text.\nSecond line.');
 await createNote(page,'Second note','Unrelated');
 const before=(await savedRecords(page)).find((n:any)=>n.title==='Trash audit');
 const revision=await page.evaluate(async id=>{const m=await import('/src/runtime/browser-notes-document.ts');return (await (await m.openBrowserNotes()).target(id)).revision;},before.id);

 // Immediate Undo from the toast puts the note back and leaves Recently deleted empty.
 await deleteNote(page,'Second note');
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open Second note',exact:true})).toBeVisible();
 await expect.poll(()=>trashEntries(page).then(e=>e.length)).toBe(0);

 await deleteNote(page,'Trash audit');
 expect((await savedRecords(page)).some((n:any)=>n.id===before.id)).toBe(false);
 // Content is durable outside the in-memory toast: reload is a restart of the web app.
 await page.reload();await openNotes(page);
 await expect(page.getByRole('button',{name:'Open Trash audit',exact:true})).toHaveCount(0);
 await openDeleted(page);
 const trash=page.locator('[data-alpha-subview="notes-trash"]');
 await expect(trash.getByRole('heading',{name:'Recently deleted',exact:true})).toBeVisible();
 await expect(trash.getByText('Trash audit',{exact:true})).toBeVisible();
 await expect(trash.getByText('30d',{exact:true})).toBeVisible();
 await expect(trash.getByText(/Deleted notes stay here/)).toHaveCount(0);
 await page.screenshot({path:test.info().outputPath('notes-trash.png')});
 await recover(page,'Trash audit','30 days left');
 await expect(page.getByText('Trash audit restored',{exact:true})).toBeVisible();
 // The last note left: Recently deleted closes and its chip disappears.
 await expect(trash).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Recently deleted',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Open Trash audit',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Note',exact:true})).toHaveValue('Keep this exact text.\nSecond line.');
 // Same id, byte-identical record and therefore the same reviewed revision.
 expect((await savedRecords(page)).find((n:any)=>n.id===before.id)).toEqual(before);
 expect(await page.evaluate(async id=>{const m=await import('/src/runtime/browser-notes-document.ts');return (await (await m.openBrowserNotes()).target(id)).revision;},before.id)).toBe(revision);
 expect(await trashEntries(page)).toEqual([]);
});

test('Delete now and Empty ask first, and checklists use the same Recently deleted',async({page})=>{
 await page.goto('/');await openNotes(page);
 await createNote(page,'First','One');await createNote(page,'Second','Two');
 await page.getByRole('button',{name:'Open Second',exact:true}).click();
 await page.getByRole('button',{name:'Turn into checklist',exact:true}).click();
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await createNote(page,'Third','Three');
 for(const title of ['First','Second','Third'])await deleteNote(page,title);
 await openDeleted(page);
 const trash=page.locator('[data-alpha-subview="notes-trash"]');
 await expect(trash.getByText('☐ Two',{exact:true})).toBeVisible();
 const askDelete=async()=>{await trash.getByRole('button',{name:'First, 30 days left',exact:true}).click();await page.getByRole('dialog',{name:'First'}).getByRole('button',{name:'Delete now',exact:true}).click();};
 await askDelete();
 const confirm=page.getByRole('dialog',{name:'Delete “First”?'});
 await expect(confirm).toContainText('This can’t be undone.');
 await confirm.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(trash.getByText('First',{exact:true})).toBeVisible();
 await askDelete();
 await page.getByRole('dialog',{name:'Delete “First”?'}).getByRole('button',{name:'Delete',exact:true}).click();
 await expect(page.getByText('Deleted',{exact:true})).toBeVisible();
 await expect(trash.getByText('First',{exact:true})).toHaveCount(0);
 expect((await trashEntries(page)).map((e:any)=>e.note.title).sort()).toEqual(['Second','Third']);
 await trash.getByRole('button',{name:'Empty Recently deleted',exact:true}).click();
 await page.getByRole('dialog',{name:'Delete all recently deleted notes?'}).getByRole('button',{name:'Delete all',exact:true}).click();
 await expect(page.getByText('Recently deleted emptied',{exact:true})).toBeVisible();
 await expect(trash).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Recently deleted',exact:true})).toHaveCount(0);
 expect(await trashEntries(page)).toEqual([]);
 expect(await page.evaluate(async()=>JSON.stringify((await (await import('/src/browser/documents.ts')).browserDocuments.read('alpha.browser.notes-trash.v1'))??null).includes('Three'))).toBe(false);
});

test('canonical startup preserves unselected legacy Trash; Older notes purges exactly at 30 days',async({page})=>{
 const t0=Date.UTC(2026,9,7,12);
 await page.clock.install({time:t0});
 await page.goto('/');await openNotes(page);
 await createNote(page,'Expiring','Gone after thirty days');await createNote(page,'Later','Deleted a day later');
 await deleteNote(page,'Expiring');
 const deletedAt=(await trashEntries(page))[0].deletedAt;
 await page.clock.setSystemTime(deletedAt+DAY);
 await deleteNote(page,'Later');

 // One minute before the boundary: still restorable after a restart.
 await page.clock.setSystemTime(deletedAt+30*DAY-60_000);
 await page.reload();await openNotes(page);
 await openDeleted(page);
 const trash=page.locator('[data-alpha-subview="notes-trash"]');
 await expect(trash.getByRole('button',{name:'Expiring, 1 day left',exact:true})).toBeVisible();
 await expect(trash.getByRole('button',{name:'Later, 2 days left',exact:true})).toBeVisible();

 // Past the boundary, explicitly opening Older notes purges without a restart.
 await page.clock.setSystemTime(deletedAt+30*DAY+60_000);
 await returnToApps(page);
 await openNotes(page);
 await expect.poll(()=>trashEntries(page).then(e=>e.map((x:any)=>x.note.title))).toEqual(['Later']);
 await openDeleted(page);
 await expect(trash.getByText('Expiring',{exact:true})).toHaveCount(0);
 await expect(trash.getByText('Later',{exact:true})).toBeVisible();
 expect(await page.evaluate(async()=>JSON.stringify((await (await import('/src/browser/documents.ts')).browserDocuments.read('alpha.browser.notes-trash.v1'))??null).includes('Gone after thirty days'))).toBe(false);

 // Canonical startup must not open or rewrite unselected legacy records, even
 // when their Trash entry expires while the app is closed. Preserve the exact
 // collection and Trash document receipt/bytes before explicitly selecting Older notes.
 const retained=await page.evaluate(async()=>({
  notes:await(await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw(),
  trash:await(await import('/src/browser/documents.ts')).browserDocuments.read('alpha.browser.notes-trash.v1'),
 }));
 expect((await trashEntries(page)).map((entry:any)=>entry.note.title)).toEqual(['Later']);
 await page.clock.setSystemTime(deletedAt+31*DAY+60_000);
 await page.reload();
 await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
 expect(await page.evaluate(async()=>({
  notes:await(await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw(),
  trash:await(await import('/src/browser/documents.ts')).browserDocuments.read('alpha.browser.notes-trash.v1'),
 }))).toEqual(retained);
 expect((await trashEntries(page)).map((entry:any)=>entry.note.title)).toEqual(['Later']);
 // Selecting the retained source now admits its existing three-day maintenance.
 await openNotes(page);
 await expect.poll(()=>trashEntries(page)).toEqual([]);
 // Reopening the already purged source is still a no-op.
 await page.reload();await openNotes(page);
 expect(await trashEntries(page)).toEqual([]);
 expect((await savedRecords(page)).map((n:any)=>n.title)).toEqual([]);
});

test('voice notes share Recently deleted: the recording restores with its note and is erased at 30 days',async({page})=>{
 const t0=Date.UTC(2026,9,7,12);
 await page.clock.install({time:t0});
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await page.evaluate(async()=>{
  const {openBrowserNotes}=await import('/src/runtime/browser-notes-document.ts');const {retainAudio}=await import('/src/browser/note-audio-store.ts');
  const audio=await retainAudio('trash-audio','trash-voice','Spoken words',{blob:new Blob(['synthetic'],{type:'audio/wav'}),durationMs:1000});
  await (await openBrowserNotes()).replace([{id:'trash-voice',kind:'voice',title:'Voice memo',body:'Spoken words',audio,dur:1,lines:[],summary:[],actions:[]}]);
 });
 const describe=()=>page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return registerPlugin<any>('AlphaNoteAudio').describe({audioId:'trash-audio'});});
 await page.reload();await openNotes(page);
 const original=(await savedRecords(page)).find((n:any)=>n.id==='trash-voice');
 const revision=()=>page.evaluate(async()=>{const m=await import('/src/runtime/browser-notes-document.ts');return (await (await m.openBrowserNotes()).target('trash-voice')).revision;});
 const originalRevision=await revision();
 const remove=async()=>{
  await page.getByRole('button',{name:'Open Voice memo',exact:true}).click();
  await deleteOpenNote(page);
  await expect(page.getByText('Moved to Recently deleted',{exact:true}).last()).toBeVisible();
  await expect.poll(async()=>(await describe()).deletedAt).toBeGreaterThan(0);
 };
 await remove();
 await page.reload();await openNotes(page);
 await openDeleted(page);
 const trash=page.locator('[data-alpha-subview="notes-trash"]');
 await expect(trash.getByText('30d',{exact:true})).toBeVisible();
 await recover(page,'Voice memo','30 days left');
 await expect(page.getByText('Voice note restored.',{exact:true})).toBeVisible();
 await expect(trash).toHaveCount(0);
 expect((await describe()).deletedAt).toBeUndefined();
 // The voice restore reinstates the exact record: same id, same dates, same reviewed revision.
 expect((await savedRecords(page)).find((n:any)=>n.id==='trash-voice')).toEqual(original);
 expect(await revision()).toBe(originalRevision);

 await remove();
 const deletedAt=(await trashEntries(page))[0].deletedAt;
 await page.clock.setSystemTime(deletedAt+30*DAY+60_000);
 await returnToApps(page);await openNotes(page);
 await expect.poll(()=>trashEntries(page)).toEqual([]);
 const erased=await describe();
 expect(erased.transcript).toBe('');expect(erased.expired).toBe(true);
 expect(Object.values(erased.deletionOperations)).toContain('purged');
 // An erased recording can never be restored again.
 const op=Object.entries(erased.deletionOperations).find(([,v])=>v==='purged')![0];
 expect(await page.evaluate(async op=>{const {registerPlugin}=await import('/src/platform-plugins.ts');try{await registerPlugin<any>('AlphaNoteAudio').restore({audioId:'trash-audio',noteId:'trash-voice',operationId:op});return 'restored';}catch{return 'refused';}},op)).toBe('refused');
});

test('an expired voice entry never erases a recording that a saved note still references',async({page})=>{
 const t0=Date.UTC(2026,9,7,12);
 await page.clock.install({time:t0});
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await page.evaluate(async()=>{
  const {openBrowserNotes}=await import('/src/runtime/browser-notes-document.ts');const {retainAudio}=await import('/src/browser/note-audio-store.ts');
  const audio=await retainAudio('shared-audio','shared-voice','Shared words',{blob:new Blob(['synthetic'],{type:'audio/wav'}),durationMs:1000});
  await (await openBrowserNotes()).replace([{id:'shared-voice',kind:'voice',title:'Shared memo',body:'Shared words',audio,dur:1,lines:[],summary:[],actions:[]}]);
 });
 const describe=()=>page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return registerPlugin<any>('AlphaNoteAudio').describe({audioId:'shared-audio'});});
 await page.reload();await openNotes(page);
 await page.getByRole('button',{name:'Open Shared memo',exact:true}).click();
 await deleteOpenNote(page);
 await expect(page.getByText('Moved to Recently deleted',{exact:true}).last()).toBeVisible();
 await expect.poll(async()=>(await describe()).deletedAt).toBeGreaterThan(0);
 const entry=(await trashEntries(page))[0];
 // Another saved note now references the same recording (for example, re-associated by a later edit).
 await page.evaluate(async audio=>{const {openBrowserNotes}=await import('/src/runtime/browser-notes-document.ts');const store=await openBrowserNotes();await store.replace([...store.list,{id:'other-voice',kind:'voice',title:'Other',body:'',audio,dur:1,lines:[],summary:[],actions:[]}]);},entry.note.audio);
 // Past the Trash deadline. The recording store's own backstop (60 days) is later, so the Trash rule decides.
 await page.clock.setSystemTime(entry.deletedAt+30*DAY+60_000);
 await page.reload();await openNotes(page);
 await openDeleted(page);
 await expect(page.locator('[data-alpha-subview="notes-trash"]').getByRole('button',{name:'Shared memo, Deleting permanently',exact:true})).toBeVisible();
 // Maintenance ran and kept both the row and the recording bytes and transcript.
 expect((await trashEntries(page)).map((e:any)=>e.id)).toEqual([entry.id]);
 const kept=await describe();
 expect(kept.transcript).toBe('Shared words');expect(kept.expired).toBeUndefined();
 expect(Object.values(kept.deletionOperations)).not.toContain('purged');
});

test('an approved agent deletion of a voice note moves its recording to Recently deleted with it',async({page})=>{
 // Test-only seam: expose the module-scoped executor that the Notes shell installs.
 await page.route(/\/src\/runtime\/connection-ui\.tsx(\?.*)?$/,async route=>{
  const response=await route.fetch();
  await route.fulfill({response,body:(await response.text())+'\nwindow.__notesTrashTestExecutor=(...args)=>deviceExecutor(...args);\n'});
 });
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await page.evaluate(async()=>{
  const {openBrowserNotes}=await import('/src/runtime/browser-notes-document.ts');const {retainAudio}=await import('/src/browser/note-audio-store.ts');
  const audio=await retainAudio('agent-audio','agent-voice','Agent words',{blob:new Blob(['synthetic'],{type:'audio/wav'}),durationMs:1000});
  await (await openBrowserNotes()).replace([{id:'agent-voice',kind:'voice',title:'Agent memo',body:'Agent words',audio,dur:1,lines:[],summary:[],actions:[]}]);
 });
 const describe=()=>page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return registerPlugin<any>('AlphaNoteAudio').describe({audioId:'agent-audio'});});
 await page.reload();await openNotes(page);
 await expect.poll(()=>page.evaluate(()=>typeof (window as any).__notesTrashTestExecutor)).toBe('function');
 const original=(await savedRecords(page)).find((n:any)=>n.id==='agent-voice');
 const operationId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
 const result=await page.evaluate(async operationId=>{
  const {openBrowserNotes}=await import('/src/runtime/browser-notes-document.ts');const {alphaClient}=await import('/src/runtime/alpha-client.ts');
  const target=await (await openBrowserNotes()).target('agent-voice');
  return (window as any).__notesTrashTestExecutor({type:'notes_delete',target},operationId,structuredClone(alphaClient.getState().context),new AbortController().signal);
 },operationId);
 expect(result.status).toBe('succeeded');
 // DeviceActions announces every committed Notes operation after journaling it.
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('alpha:notes-committed')));
 await expect(page.getByRole('button',{name:'Open Agent memo',exact:true})).toHaveCount(0);
 expect((await savedRecords(page)).some((n:any)=>n.id==='agent-voice')).toBe(false);
 const trashed=await describe();
 expect(trashed.deletedAt).toBeGreaterThan(0);
 expect(trashed.activeDeletionOperation).toBe(operationId);
 expect(trashed.deletionOperations[operationId]).toBe('removed');
 const entries=await trashEntries(page);
 expect(entries.map((e:any)=>[e.id,e.audio?.audioId])).toEqual([[operationId,'agent-audio']]);
 expect(await page.evaluate(async()=>Object.keys(await (await import('/src/runtime/note-audio-deletions.ts')).pendingAudioDeletions()))).toEqual([]);

 // Recently deleted restores the note and its recording together, through the reviewed voice restore path.
 await openDeleted(page);
 await recover(page,'Agent memo','30 days left');
 await expect(page.getByText('Voice note restored.',{exact:true})).toBeVisible();
 expect((await describe()).deletedAt).toBeUndefined();
 expect((await savedRecords(page)).find((n:any)=>n.id==='agent-voice')).toEqual(original);
 expect(await trashEntries(page)).toEqual([]);
});


test('an already open Recently deleted cannot restore a note after the retention deadline',async({page})=>{
 await page.clock.install({time:Date.UTC(2026,9,7,12)});
 await page.goto('/');await openNotes(page);
 await createNote(page,'Deadline','Must not return after expiry');await deleteNote(page,'Deadline');
 const entry=(await trashEntries(page))[0];
 await openDeleted(page);
 await page.getByRole('button',{name:'Deadline, 30 days left',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Deadline'}).getByRole('button',{name:'Recover',exact:true})).toBeVisible();
 await page.clock.setSystemTime(entry.deletedAt+30*DAY);
 await page.getByRole('dialog',{name:'Deadline'}).getByRole('button',{name:'Recover',exact:true}).click();
 await expect.poll(()=>trashEntries(page)).toEqual([]);
 expect((await savedRecords(page)).some((note:any)=>note.id===entry.note.id)).toBe(false);
});
