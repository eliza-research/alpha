import {returnToApps} from './app-navigation';
import {openLegacyNotes} from './helpers/legacy-notes';
import {test,expect,type Page} from '@playwright/test';
// Trash expiry must not depend on opening Notes: resume and the shell's 15-minute timer purge too.
const DAY=24*60*60*1000;
test.describe.configure({timeout:60_000});
const trashEntries=(page:Page)=>page.evaluate(async()=>(await (await import('/src/runtime/notes-trash.ts')).readNotesTrash()).entries);
const savedRecords=(page:Page)=>page.evaluate(async()=>JSON.parse(await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw()).records);
const describe=(page:Page)=>page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return registerPlugin<any>('AlphaNoteAudio').describe({audioId:'resume-audio'});});
async function openNotes(page:Page){await openLegacyNotes(page);await expect(page.getByRole('button',{name:'New note',exact:true})).toBeEnabled();}
async function home(page:Page){await returnToApps(page);await expect(page.locator('html')).not.toHaveAttribute('data-active-view','notes');}
async function trashTextNote(page:Page,title:string){
 await page.getByRole('button',{name:'New note',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill(title);
 await page.getByRole('textbox',{name:'Note',exact:true}).fill('Erase me on time');
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await page.getByRole('button',{name:`Open ${title}`,exact:true}).click();
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('dialog',{name:'Note actions'}).getByRole('button',{name:'Delete',exact:true}).click();
 await expect(page.getByText(`Moved to Recently deleted`,{exact:true})).toBeVisible();
}
async function seedVoice(page:Page){
 await page.evaluate(async()=>{
  const {openBrowserNotes}=await import('/src/runtime/browser-notes-document.ts');const {retainAudio}=await import('/src/browser/note-audio-store.ts');
  const audio=await retainAudio('resume-audio','resume-voice','Spoken resume words',{blob:new Blob(['synthetic'],{type:'audio/wav'}),durationMs:1000});
  await (await openBrowserNotes()).replace([{id:'resume-voice',kind:'voice',title:'Resume memo',body:'Spoken resume words',audio,dur:1,lines:[],summary:[],actions:[]}]);
 });
}

test('a resume on Home erases expired text and voice Trash entries without opening Notes',async({page})=>{
 await page.clock.install({time:Date.UTC(2026,9,7,12)});
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');await seedVoice(page);
 await page.reload();await openNotes(page);
 await trashTextNote(page,'Resume text');
 await page.getByRole('button',{name:'Open Resume memo',exact:true}).click();
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('dialog',{name:'Note actions'}).getByRole('button',{name:'Delete',exact:true}).click();
 await expect(page.getByText('Moved to Recently deleted',{exact:true})).toBeVisible();
 await expect.poll(async()=>(await describe(page)).deletedAt).toBeGreaterThan(0);
 const entries=await trashEntries(page);
 expect(entries.map((e:any)=>e.note.title).sort()).toEqual(['Resume memo','Resume text']);
 const last=Math.max(...entries.map((e:any)=>e.deletedAt));
 await home(page);

 // One minute short of three days, a resume keeps both entries restorable.
 await page.clock.setSystemTime(last+30*DAY-60_000);
 await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));});
 await page.waitForTimeout(300);
 expect((await trashEntries(page)).length).toBe(2);
 expect((await describe(page)).transcript).toBe('Spoken resume words');

 // 72 hours plus one minute: returning to the foreground on Home purges both.
 await page.clock.setSystemTime(last+30*DAY+60_000);
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await expect.poll(()=>trashEntries(page)).toEqual([]);
 await expect(page.locator('html')).not.toHaveAttribute('data-active-view','notes');
 const erased=await describe(page);
 expect(erased.transcript).toBe('');expect(erased.expired).toBe(true);
 expect(Object.values(erased.deletionOperations)).toContain('purged');
 expect(await savedRecords(page)).toEqual([]);
 expect(await page.evaluate(async()=>JSON.stringify((await (await import('/src/browser/documents.ts')).browserDocuments.read('alpha.browser.notes-trash.v1'))??null).includes('Erase me on time'))).toBe(false);
});

test('the 15-minute shell timer purges an expired Trash entry with no navigation or resume event',async({page})=>{
 await page.clock.install({time:Date.UTC(2026,9,7,12)});
 await page.goto('/');await openNotes(page);
 await trashTextNote(page,'Timer text');
 const [entry]=await trashEntries(page);
 await home(page);
 await page.clock.setSystemTime(entry.deletedAt+30*DAY+60_000);
 // No event: only the interval can notice that the entry is due. fastForward fires each due timer once.
 await page.clock.fastForward(15*60*1000);
 await expect.poll(()=>trashEntries(page)).toEqual([]);
 expect((await savedRecords(page)).some((n:any)=>n.id===entry.note.id)).toBe(false);
});
