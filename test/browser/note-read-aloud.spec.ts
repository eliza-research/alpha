import {openLegacyNotes} from './helpers/legacy-notes';
import {test,expect,type Page} from '@playwright/test';
import {agentBrowserVoice} from './voice-fixture';
// P-43: read aloud has no Web Speech fallback. It runs through the local agent's speech
// (libelizainference Paradee), stubbed here at the agent boundary (agentBrowserVoice).

// Read aloud uses the agent's on-device speech only; editing or leaving the note stops it.
// The development server is shared and slow on a loaded machine.
test.describe.configure({timeout:120000});
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));});
async function openNote(page:Page){
 await page.goto('/');await agentBrowserVoice(page);
 await openLegacyNotes(page);
 await page.getByRole('button',{name:'New note',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Groceries');
 await page.getByRole('textbox',{name:'Note',exact:true}).fill('Milk and eggs.');
 await page.waitForTimeout(500);
}
/** Starts reading through the module entry point, so the resolved outcome is observable. The editor
 * has no Read aloud button (PLAN.md section 3): reading a note is asked of Alpha. */
async function readAloud(page:Page){
 await expect(page.getByRole('textbox',{name:'Note',exact:true})).toBeVisible();
 await page.evaluate(async()=>{
  const raw=await(await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw();
  const note=JSON.parse(raw!).records.find((n:any)=>n.title==='Groceries');
  const {speakNote}=await import('/src/prototype/local-speech-playback.ts');
  (window as any).voiceFixture.outcome=speakNote('Groceries. Milk and eggs.',{noteId:note.id});
 });
}
const reading=(page:Page)=>page.evaluate(async()=>(await import('/src/prototype/local-speech-playback.ts')).currentNoteReading());
const spoken=(page:Page)=>page.evaluate(()=>(window as any).voiceFixture.spoken as string[]);

test('reads the open note with the local voice and stops when the note is edited',async({page})=>{
 const posts:string[]=[];page.on('request',request=>{if(request.method()==='POST')posts.push(request.url());});
 await openNote(page);await readAloud(page);
 await expect.poll(()=>spoken(page)).toEqual(['Groceries. Milk and eggs.']);
 await expect.poll(async()=>(await reading(page))?.state).toBe('reading');
 await page.getByRole('textbox',{name:'Note',exact:true}).fill('Milk, eggs and bread.');
 await expect.poll(()=>reading(page)).toBeNull();
 expect(await page.evaluate(()=>(window as any).voiceFixture.cancels)).toBeGreaterThan(0);
 expect(await page.evaluate(()=>(window as any).voiceFixture.outcome)).toBe('stopped');
 expect(posts).toEqual([]);
});
test('leaving the note stops reading; a finished reading reports completion',async({page})=>{
 await openNote(page);await readAloud(page);
 await expect.poll(async()=>(await reading(page))?.state).toBe('reading');
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await expect.poll(()=>reading(page)).toBeNull();
 await page.getByRole('button',{name:'Open Groceries',exact:true}).click();
 await readAloud(page);
 await expect.poll(async()=>(await reading(page))?.state).toBe('reading');
 await page.evaluate(()=>(window as any).voiceFixture.finish());
 await expect.poll(()=>page.evaluate(()=>(window as any).voiceFixture.outcome)).toBe('finished');
 expect(await reading(page)).toBeNull();
});
test('the editor toolbar has no Read aloud or Dictate button',async({page})=>{
 await openNote(page);
 for(const name of ['Read aloud','Stop reading','Dictate'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);
 for(const name of ['Back to notes','Turn into checklist','Share note','More'])await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
});
