import {test,expect} from '@playwright/test';
import {openLegacyNotes} from './helpers/legacy-notes';

// The store takes an edit's revision at once and commits it later. A second edit made while the
// first commit is still pending is this editor's own continuation, not a change from another view.
test('an edit made while the previous Notes save is still committing is saved, not refused',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?mode=dev');await openLegacyNotes(page);
 await page.evaluate(async()=>{
  const {browserNotesPort}=await import('/src/runtime/browser-notes-document.ts');
  const commit=browserNotesPort.compareExchange,w=window as any;
  w.notesCommitGate=new Promise<void>(resolve=>{w.releaseNotesCommit=resolve;});
  browserNotesPort.compareExchange=async(...args)=>{await w.notesCommitGate;return commit.apply(browserNotesPort,args);};
 });
 await page.getByRole('button',{name:'New note',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Pending title');
 await expect(page.getByText('Saving on this device…',{exact:true})).toBeVisible();
 await page.getByRole('textbox',{name:'Note',exact:true}).fill('Body typed while the title was saving');
 await expect(page.getByText(/Save unconfirmed/)).toHaveCount(0);
 await page.evaluate(()=>(window as any).releaseNotesCommit());
 const saved=()=>page.evaluate(async()=>JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())!).records.find((r:any)=>r.title==='Pending title')?.body);
 await expect.poll(saved).toBe('Body typed while the title was saving');
 await expect(page.getByText('Saving on this device…',{exact:true})).toHaveCount(0);
 await expect(page.getByText(/Save unconfirmed/)).toHaveCount(0);
});
