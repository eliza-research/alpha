import {test,expect,type Page} from '@playwright/test';
import {selectLegacyNotes} from './helpers/legacy-notes';
const key='alpha.browser.notes.v1',legacyKey='alphaphone:notes:v2';
const note={id:'n',kind:'text',title:'Original',body:'Exact text',custom:{keep:'verbatim'}};
// Canonical Notes is the default source: the app shell no longer opens this device-local
// document at start, so these storage cases open it explicitly through its module, and the
// UI recovery case selects Older notes.
async function ready(page:Page){await page.goto('/');await expect(page.getByRole('button',{name:'Notes',exact:true})).toBeVisible();}
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));});
test('two tabs share one collection without advancing its receipt on reopen',async({page,context})=>{
 await ready(page);const before=await page.evaluate(async()=>{const m=await import('/src/runtime/browser-notes-document.ts');await m.openBrowserNotes();return m.browserNotesPort.read();});const other=await context.newPage();await ready(other);expect(await other.evaluate(async()=>{const m=await import('/src/runtime/browser-notes-document.ts');await m.openBrowserNotes();return m.browserNotesPort.read();})).toEqual(before);expect(await page.evaluate(key=>localStorage.getItem(key),legacyKey)).toBeNull();
});
test('two editors admit one snapshot and retain the losing draft',async({page,context})=>{
 await ready(page);await page.evaluate(async note=>{const m=await import('/src/runtime/browser-notes-document.ts');await(await m.openBrowserNotes()).replace([note]);},note);const other=await context.newPage();await ready(other);
 await Promise.all([page,other].map(tab=>tab.evaluate(async()=>{(window as any).editor=await(await import('/src/runtime/browser-notes-document.ts')).openBrowserNotes();})));
 const results=await Promise.all([page,other].map((tab,i)=>tab.evaluate(async i=>{const store=(window as any).editor;try{await store.replace([{...store.list[0],body:'Writer '+i}]);return {saved:true};}catch{return {saved:false,draft:store.list[0].body,recovery:store.needsRecovery};}},i)));
 expect(results.filter(r=>r.saved)).toHaveLength(1);const losing=results.findIndex(r=>!r.saved);expect(results[losing]).toEqual({saved:false,draft:'Writer '+losing,recovery:true});
});
test('lost acknowledgement preserves the committed Notes snapshot without replay',async({page})=>{
 await ready(page);expect(await page.evaluate(async note=>{const m=await import('/src/runtime/browser-notes-document.ts'),store=await m.openBrowserNotes(),exchange=m.browserNotesPort.compareExchange;let writes=0;m.browserNotesPort.compareExchange=async(...args)=>{writes++;await exchange(...args);throw Error('Lost acknowledgement');};let refused=false;try{await store.replace([note]);}catch{refused=true;}m.browserNotesPort.compareExchange=exchange;return {refused,writes,recovery:store.needsRecovery,saved:(await m.openBrowserNotes()).list};},note)).toEqual({refused:true,writes:1,recovery:true,saved:[note]});
});
test('legacy Notes retain exact bytes while canonical edits preserve identity and metadata',async({page})=>{
 const raw=' '+JSON.stringify({version:2,collectionId:'12345678-1234-4234-8234-123456789abc',records:[note],deleted:[]})+'\n';await page.addInitScript(({key,raw})=>localStorage.setItem(key,raw),{key:legacyKey,raw});await ready(page);
 expect(await page.evaluate(async key=>{const m=await import('/src/runtime/browser-notes-document.ts'),store=await m.openBrowserNotes();await store.replace([{...store.list[0],body:'Changed'}]);const saved=JSON.parse(await m.readBrowserNotesRaw()),backup=await m.browserNotesRecovery.capture();return {id:saved.collectionId,custom:saved.records[0].custom,legacy:localStorage.getItem(key),archive:JSON.parse(backup.raw!).archive.v2};},legacyKey)).toEqual({id:'12345678-1234-4234-8234-123456789abc',custom:note.custom,legacy:raw,archive:raw});
});
test('unrelated old Daily edits do not invalidate Notes but changed old Notes do',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alphaphone:daily:v1',JSON.stringify({notes:[],receipts:['one']})));await ready(page);
 expect(await page.evaluate(async()=>{const m=await import('/src/runtime/browser-notes-document.ts');localStorage.setItem('alphaphone:daily:v1',JSON.stringify({notes:[],receipts:['one','two']}));await(await m.openBrowserNotes()).assertCurrent();localStorage.setItem('alphaphone:daily:v1',JSON.stringify({notes:[{id:'late'}],receipts:[]}));let refused=false;try{await m.openBrowserNotes();}catch{refused=true;}return refused;})).toBe(true);
});
test('malformed legacy data stays exact and reset cannot import it again',async({page})=>{
 await page.addInitScript(key=>localStorage.setItem(key,' broken Notes bytes '),legacyKey);await ready(page);await selectLegacyNotes(page);await page.getByRole('button',{name:'Recover browser Notes',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Browser Notes recovery'});const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download Notes backup'}).click();const stream=await(await download).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));expect(JSON.parse(JSON.parse(Buffer.concat(chunks).toString()).saved).v2).toBe(' broken Notes bytes ');await dialog.getByRole('button',{name:'Reset app Notes',exact:true}).click();await dialog.getByRole('button',{name:'Confirm Notes reset',exact:true}).click();await expect(dialog).toHaveCount(0);await expect.poll(()=>page.evaluate(async()=>!!(await(await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw()))).toBe(true);expect(await page.evaluate(async key=>({records:JSON.parse(await(await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw()).records,legacy:localStorage.getItem(key)}),legacyKey)).toEqual({records:[],legacy:' broken Notes bytes '});
});
test('stale reset cannot erase another editor and a valid reset changes collection identity',async({page})=>{
 await ready(page);expect(await page.evaluate(async note=>{const m=await import('/src/runtime/browser-notes-document.ts'),old=await m.browserNotesRecovery.capture(),store=await m.openBrowserNotes(),before=JSON.parse(store.raw).collectionId;await store.replace([note]);let refused=false;try{await m.browserNotesRecovery.reset(old);}catch{refused=true;}const capture=await m.browserNotesRecovery.capture();await m.browserNotesRecovery.reset(capture);const next=await m.openBrowserNotes();return {refused,empty:next.list.length===0,newIdentity:JSON.parse(next.raw).collectionId!==before};},note)).toEqual({refused:true,empty:true,newIdentity:true});
});
test('audio deletion readback uses canonical tombstones and reset never restores over a new collection',async({page})=>{
 await ready(page);expect(await page.evaluate(async()=>{const m=await import('/src/runtime/browser-notes-document.ts'),a=await import('/src/runtime/note-audio-deletions.ts'),store=await m.openBrowserNotes(),note={id:'voice',kind:'voice',title:'Voice',body:'Words',audio:{audioId:'audio',noteId:'voice'}};await store.replace([note]);const target=await store.target('voice'),row={id:'delete',target,note,audioId:'audio'};await a.changeAudioDeletion(row,true);await store.execute({type:'notes_delete',target},row.id,new AbortController().signal,()=>{});const deleted=await a.audioDeletionNoteState(row);await m.browserNotesRecovery.reset(await m.browserNotesRecovery.capture());return {deleted,after:await a.audioDeletionNoteState(row),retained:!!(await a.pendingAudioDeletions())[row.id]};})).toEqual({deleted:'deleted',after:'changed',retained:true});
});
test('audio history reset waits for the effects lock and preserves Notes',async({page})=>{
 await ready(page);await page.evaluate(async()=>{const m=await import('/src/runtime/browser-notes-document.ts'),a=await import('/src/runtime/note-audio-deletions.ts'),store=await m.openBrowserNotes(),note={id:'voice',kind:'voice',title:'Voice',body:'Words',audio:{audioId:'audio',noteId:'voice'}};await store.replace([note]);await a.changeAudioDeletion({id:'delete',target:await store.target('voice'),note,audioId:'audio'},true);const recovery=await a.audioDeletionRecovery(),capture=await recovery.capture();await new Promise<void>(ready=>{void a.withAudioDeletionLock(async()=>{ready();await new Promise<void>(resolve=>(window as any).releaseAudioLock=resolve);});});(window as any).resetAudio=recovery.reset(capture).then(()=>(window as any).resetFinished=true);});await expect.poll(()=>page.evaluate(async()=>(await navigator.locks.query()).pending?.some(l=>l.name==='alpha.notes-audio-effects.v1'))).toBe(true);expect(await page.evaluate(()=>(window as any).resetFinished)).toBeUndefined();await page.evaluate(async()=>{(window as any).releaseAudioLock();await(window as any).resetAudio;});expect(await page.evaluate(async()=>({pending:Object.keys(await(await import('/src/runtime/note-audio-deletions.ts')).pendingAudioDeletions()).length,notes:JSON.parse(await(await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw()).records.length}))).toEqual({pending:0,notes:1});
});

for(const source of ['v2','v1','daily','malformed'] as const)test(`preserve exact ${source} sources and detect later Notes writes`,async({browser})=>{
 const context=await browser.newContext(),page=await context.newPage();
 try{
 await page.addInitScript(source=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  if(localStorage.getItem('seeded'))return;localStorage.setItem('seeded','yes');
  const note={id:'retained',kind:'text',title:'Retained',body:'Original bytes',updatedAt:'2026-01-02T03:04:05Z'};
  if(source==='v2')localStorage.setItem('alphaphone:notes:v2',JSON.stringify({version:2,collectionId:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',records:[note],deleted:[{id:'gone',revision:'r1',operationId:'delete-1'}]},null,2));
  if(source==='v1')localStorage.setItem('alphaphone:prototype:notes:v1',JSON.stringify([note],null,3));
  localStorage.setItem('alphaphone:daily:v1',source==='malformed'?' { malformed original ':JSON.stringify({notes:source==='daily'?[note]:[],receipts:[]},null,2));
 },source);
 await ready(page);
 const result=await page.evaluate(async(source)=>{
  const {browserNotesPort:d,browserNotesRecovery:r,openBrowserNotes}=await import('/src/runtime/browser-notes-document.ts');const backup=await r.capture();
  if(source==='malformed'){await r.reset(backup);return {empty:(await openBrowserNotes()).list.length,backup:backup.raw};}
  const store=await openBrowserNotes(),before=await d.read(),daily=JSON.parse(localStorage.getItem('alphaphone:daily:v1')!);daily.receipts.push('unrelated');localStorage.setItem('alphaphone:daily:v1',JSON.stringify(daily));await store.assertCurrent();
  daily.notes.push({id:'new',title:'Late old-tab write'});localStorage.setItem('alphaphone:daily:v1',JSON.stringify(daily));let refused=false;try{await store.assertCurrent();}catch{refused=true;}
  const current=await r.capture();return {refused,changed:current.legacyChanged,backup:backup.raw,before:before?.raw,empty:null};
 },source);
 if(source==='malformed'){expect(result.empty).toBe(0);expect(result.backup).toContain(' { malformed original ');}
 else{expect(result.refused).toBe(true);expect(result.changed).toBe(true);expect(result.backup).toContain('Original bytes');if(source==='v2'){expect(result.before).toContain('delete-1');expect(result.before).toContain('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');}}
 }finally{await context.close();}
});
