import {openLegacyNotes} from './helpers/legacy-notes';
// B-10 (docs/core-loop-audit.md): a full Notes Trash refuses a deletion without losing data.
// Browser build only; source/test evidence. The native slot cap ("storage-full" from
// AlphaConnectionPlugin) and NotesStorageDurabilityInstrumentedTest are separate gates.
//
// The refusal is the "Trash is full" dialog with Open Trash, Cancel and a separately confirmed
// permanent delete (MVP-15, merged with PR 388). notes-trash-recovery.spec.ts covers the dialog's
// choices; the entry-limit test here only declines it. The second test reaches the same refusal
// through the byte limit (NOTES_TRASH_MAX_BYTES) rather than the entry limit.
import {test,expect,type Page} from '@playwright/test';
/** A Recently deleted row → its action sheet. */
async function rowAction(page:Page,title:string,action:'Recover'|'Delete now'){
 await page.locator('[data-alpha-subview="notes-trash"]').getByRole('button',{name:new RegExp(`^${title}, `)}).click();
 await page.getByRole('dialog',{name:title,exact:true}).getByRole('button',{name:action,exact:true}).click();
}
/** Delete now → the confirmation → Delete. */
async function deleteNow(page:Page,title:string){
 await rowAction(page,title,'Delete now');
 await page.getByRole('dialog',{name:`Delete “${title}”?`}).getByRole('button',{name:'Delete',exact:true}).click();
}
const savedRecords=(page:Page)=>page.evaluate(async()=>JSON.parse(await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw()).records as any[]);
const trashEntries=(page:Page)=>page.evaluate(async()=>(await (await import('/src/runtime/notes-trash.ts')).readNotesTrash()).entries as any[]);
async function openNotes(page:Page){await openLegacyNotes(page);await expect(page.getByRole('button',{name:'New note',exact:true})).toBeEnabled();}
async function createNote(page:Page,title:string,body:string){
 await page.getByRole('button',{name:'New note',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill(title);
 await page.getByRole('textbox',{name:'Note',exact:true}).fill(body);
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await expect(page.getByRole('button',{name:`Open ${title}`,exact:true})).toBeVisible();
}
async function deleteNote(page:Page,title:string){
 await page.getByRole('button',{name:`Open ${title}`,exact:true}).click();
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('dialog',{name:'Note actions'}).getByRole('button',{name:'Delete',exact:true}).click();
 await expect(page.getByText(`Moved to Recently deleted`,{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:`Open ${title}`,exact:true})).toHaveCount(0);
}
/**
 * The product limit is 10,000 entries. The served policy module is the product module with only
 * NOTES_TRASH_MAX_ENTRIES replaced, so the limit is reached with two deletions made through
 * rendered controls. Test-only; no production seam changes the limit.
 */
async function lowerEntryLimit(page:Page,limit:number){
 let rewritten=0;
 await page.route(/\/src\/runtime\/notes-trash-policy\.ts(\?.*)?$/,async route=>{
  const response=await route.fetch(),source=await response.text();
  const body=source.replace(/(NOTES_TRASH_MAX_ENTRIES\s*=\s*)[^;]+;/,`$1${limit};`);
  if(body===source)throw Error('Notes Trash entry limit was not found in the served module');
  rewritten++;await route.fulfill({response,body});
 });
 return ()=>rewritten;
}

test('a deletion that would overfill Trash is refused: the note stays saved, Trash is unchanged, and making room lets it through',async({page})=>{
 test.setTimeout(120_000);
 const rewritten=await lowerEntryLimit(page,2);
 await page.goto('/');await openNotes(page);
 expect(rewritten()).toBeGreaterThan(0);
 expect(await page.evaluate(async()=>(await import('/src/runtime/notes-trash-policy.ts')).NOTES_TRASH_MAX_ENTRIES)).toBe(2);
 for(const title of ['Alpha','Bravo','Charlie','Delta'])await createNote(page,title,`${title} body, exact.`);
 // Fill Trash to its limit through the Delete control.
 await deleteNote(page,'Alpha');await deleteNote(page,'Bravo');
 const full=await trashEntries(page),saved=await savedRecords(page);
 expect(full.map(entry=>entry.note.title).sort()).toEqual(['Alpha','Bravo']);
 expect(saved.map(note=>note.title).sort()).toEqual(['Charlie','Delta']);

 // One more deletion: refused, in words, before anything is written.
 await page.getByRole('button',{name:'Open Charlie',exact:true}).click();
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('dialog',{name:'Note actions'}).getByRole('button',{name:'Delete',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Recently deleted is full'});
 await expect(dialog).toBeVisible();
 await expect(page.getByText('Moved to Recently deleted',{exact:true})).toHaveCount(0);
 // The note is still saved, byte for byte, and Trash holds exactly what it held.
 expect(await savedRecords(page)).toEqual(saved);
 expect(await trashEntries(page)).toEqual(full);
 // Declining the dialog leaves the same note open in the editor.
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);
 await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Charlie');
 // Pressing Delete again is refused again; a second press never forces the deletion through.
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('dialog',{name:'Note actions'}).getByRole('button',{name:'Delete',exact:true}).click();
 await expect(dialog).toBeVisible();
 expect(await savedRecords(page)).toEqual(saved);
 expect(await trashEntries(page)).toEqual(full);
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);

 // A reload loses nothing on either side of the refusal.
 await page.reload();await openNotes(page);
 expect(await savedRecords(page)).toEqual(saved);
 expect(await trashEntries(page)).toEqual(full);
 await expect(page.getByRole('button',{name:'Open Charlie',exact:true})).toBeVisible();

 // Make room the way the refusal says to: restore one trashed note. The refused deletion then works.
 await page.getByRole('button',{name:'Recently deleted',exact:true}).click();
 const trash=page.locator('[data-alpha-subview="notes-trash"]');
 await rowAction(page,'Alpha','Recover');
 await expect(page.getByText('Alpha restored',{exact:true})).toBeVisible();
 await trash.getByRole('button',{name:'Back to notes',exact:true}).click();
 await deleteNote(page,'Charlie');
 expect((await trashEntries(page)).map(entry=>entry.note.title).sort()).toEqual(['Bravo','Charlie']);
 expect((await savedRecords(page)).map(note=>note.title).sort()).toEqual(['Alpha','Delta']);
 // Every note written in this test still exists exactly once, in Notes or in Trash.
 const everywhere=[...(await savedRecords(page)).map(note=>note.title),...(await trashEntries(page)).map(entry=>entry.note.title)].sort();
 expect(everywhere).toEqual(['Alpha','Bravo','Charlie','Delta']);
 expect((await savedRecords(page)).find(note=>note.title==='Alpha')).toEqual(full.find(entry=>entry.note.title==='Alpha').note);
});

/**
 * The product byte limit is 30 MiB. As with the entry limit, the served policy module is the
 * product module with only NOTES_TRASH_MAX_BYTES replaced; the entry limit stays at 10,000, so
 * every refusal in the test below is the byte limit's. Test-only; no production seam changes it.
 */
async function lowerByteLimit(page:Page,limit:number){
 let rewritten=0;
 await page.route(/\/src\/runtime\/notes-trash-policy\.ts(\?.*)?$/,async route=>{
  const response=await route.fetch(),source=await response.text();
  const body=source.replace(/(NOTES_TRASH_MAX_BYTES\s*=\s*)[^;]+;/,`$1${limit};`);
  if(body===source)throw Error('Notes Trash byte limit was not found in the served module');
  rewritten++;await route.fulfill({response,body});
 });
 return ()=>rewritten;
}
const trashBytes=(page:Page)=>page.evaluate(async()=>new TextEncoder().encode(JSON.stringify(await (await import('/src/runtime/notes-trash.ts')).readNotesTrash())).length);

test('a deletion that would push Trash past its byte limit is refused: the note stays saved, Trash is unchanged, and the confirmed choices still work',async({page})=>{
 test.setTimeout(120_000);
 const LIMIT=5000;
 const rewritten=await lowerByteLimit(page,LIMIT);
 await page.goto('/');await openNotes(page);
 expect(rewritten()).toBeGreaterThan(0);
 const limits=await page.evaluate(async()=>{const policy=await import('/src/runtime/notes-trash-policy.ts');return [policy.NOTES_TRASH_MAX_BYTES,policy.NOTES_TRASH_MAX_ENTRIES];});
 expect(limits).toEqual([LIMIT,10000]);
 // Multi-byte text: the limit counts encoded bytes, not characters.
 const heavy='\u00e9'.repeat(1300);
 await createNote(page,'Small','Fits in Trash.');
 await createNote(page,'Heavy',heavy);
 await createNote(page,'Second heavy',heavy);
 await createNote(page,'Tiny','x');
 await deleteNote(page,'Small');await deleteNote(page,'Heavy');
 const full=await trashEntries(page),saved=await savedRecords(page),bytes=await trashBytes(page);
 expect(full.map(entry=>entry.note.title).sort()).toEqual(['Heavy','Small']);
 // Two entries of 10,000 allowed: only bytes can refuse the next one.
 expect(bytes).toBeLessThanOrEqual(LIMIT);expect(bytes).toBeGreaterThan(LIMIT/2);
 expect(heavy.length).toBeLessThan(LIMIT/2);expect(new TextEncoder().encode(heavy).length).toBeGreaterThan(LIMIT/2);

 // A second heavy note does not fit: refused in words before anything is written.
 await page.getByRole('button',{name:'Open Second heavy',exact:true}).click();
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('dialog',{name:'Note actions'}).getByRole('button',{name:'Delete',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Recently deleted is full'});
 await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Delete permanently',exact:true})).toBeVisible();await expect(dialog).not.toContainText('was not deleted');
 await expect(page.getByText('Moved to Recently deleted',{exact:true})).toHaveCount(0);
 expect(await savedRecords(page)).toEqual(saved);
 expect(await trashEntries(page)).toEqual(full);
 expect(await trashBytes(page)).toBe(bytes);
 // The refusal is the typed byte-limit refusal for exactly this addition.
 const refusal=await page.evaluate(async id=>{
  const trash=await import('/src/runtime/notes-trash.ts');const store=await (await import('/src/runtime/browser-notes-document.ts')).openBrowserNotes();
  const doc=await trash.readNotesTrash(),note=store.list.find((n:any)=>n.id===id) as any;
  const entry={id:crypto.randomUUID(),note,target:await store.target(id),index:0,deletedAt:Date.now()} as any;
  let code='',isFull=false;try{trash.addNotesTrashEntry(doc,entry);}catch(error){code=(error as any).code;isFull=trash.isNotesTrashFull(error);}
  return {overflows:trash.notesTrashOverflows(doc,entry),code,isFull,entries:doc.entries.length+1,bytes:new TextEncoder().encode(JSON.stringify({version:1,entries:[entry,...doc.entries]})).length};
 },saved.find(note=>note.title==='Second heavy').id);
 expect(refusal.overflows).toBe(true);expect(refusal.code).toBe('notes-trash-full');expect(refusal.isFull).toBe(true);
 expect(refusal.entries).toBe(3);expect(refusal.bytes).toBeGreaterThan(LIMIT);
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);
 await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Second heavy');
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();

 // Bytes, not count: a small note still fits beside the same two entries.
 await deleteNote(page,'Tiny');
 const three=await trashEntries(page);
 expect(three.map(entry=>entry.note.title).sort()).toEqual(['Heavy','Small','Tiny']);
 expect(await trashBytes(page)).toBeLessThanOrEqual(LIMIT);

 // A reload loses nothing, and the same deletion is refused again.
 await page.reload();await openNotes(page);
 expect(await trashEntries(page)).toEqual(three);
 expect((await savedRecords(page)).map(note=>note.title)).toEqual(['Second heavy']);
 await page.getByRole('button',{name:'Open Second heavy',exact:true}).click();
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('dialog',{name:'Note actions'}).getByRole('button',{name:'Delete',exact:true}).click();
 await expect(dialog).toBeVisible();
 expect(await trashEntries(page)).toEqual(three);

 // Make room the way the dialog offers: Open Trash, confirm Delete forever for the heavy entry.
 await dialog.getByRole('button',{name:'Open Recently deleted',exact:true}).click();
 const trash=page.locator('[data-alpha-subview="notes-trash"]');
 await deleteNow(page,'Heavy');
 await expect(page.getByText('Deleted',{exact:true})).toBeVisible();
 await trash.getByRole('button',{name:'Back to notes',exact:true}).click();
 await deleteNote(page,'Second heavy');
 expect((await trashEntries(page)).map(entry=>entry.note.title).sort()).toEqual(['Second heavy','Small','Tiny']);
 expect(await trashBytes(page)).toBeLessThanOrEqual(LIMIT);
 expect(await savedRecords(page)).toEqual([]);
 // The restorable copy is the exact record that was refused earlier.
 expect((await trashEntries(page)).find(entry=>entry.note.title==='Second heavy').note).toEqual(saved.find(note=>note.title==='Second heavy'));
});
