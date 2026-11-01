// Notes -> Calendar hand-off: a saved voice note's open action items become a reminder draft or a
// calendar event draft. Nothing is written until Save in Calendar; the saved record then shows
// "From note: <title>" and opens that exact note, or nothing.
//
// Evidence boundary: browser build, development profile, source/test only. Voice notes are seeded
// through the real Notes document and retained-audio store (no microphone). Native reminders keep the
// same link store; native CalendarProvider events are not linked (see docs/core-loop-status.md).
import {test,expect,type Page} from '@playwright/test';
import {returnToApps} from './app-navigation';
import {openLegacyNotes,selectLegacyNotes} from './helpers/legacy-notes';
import {openBrowserCalendar} from './helpers/browser-calendar';
import {canonicalNotesFixture,openCanonicalNotes} from './helpers/canonical-notes';
test.setTimeout(240_000);
const button=(page:Page,name:string|RegExp)=>page.getByRole('button',{name,exact:true});
const notes=(page:Page)=>page.evaluate(async()=>JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())||'{"records":[]}').records as any[]);
const reminders=(page:Page)=>page.evaluate(async()=>(JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())||'{"reminders":[]}').reminders as any[]).filter(r=>r.status!=='cancelled'));
const events=(page:Page)=>page.evaluate(async()=>JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())||'{"events":[]}').events as any[]);
const stored=(page:Page)=>page.evaluate(async()=>(await (await import('/src/prototype/note-origin-adapter.ts')).readNoteOrigins()).links as Record<string,any>);
/** Each stored link, named by the current title of the exact note (id and recording) it points at. */
const links=async(page:Page)=>{const all=await notes(page);return Object.fromEntries(Object.entries(await stored(page)).map(([key,row])=>[key,all.find(n=>n.id===row.noteId&&n.audio?.audioId===row.audioId)?.title??'no such note']));};
const title=(page:Page)=>page.getByRole('textbox',{name:'Title',exact:true});

/** Two saved recordings with reviewed action items, written through the real Notes port. */
async function setup(page:Page){
 await page.addInitScript(()=>{if(!localStorage.getItem('alpha.connection.selection.v1'))localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));});
 await page.goto('/?mode=dev&tools=1',{waitUntil:'domcontentloaded'});
 await openLegacyNotes(page);
 for(const name of ['Venue meeting','Garden meeting']){
  await button(page,'New note').click();await title(page).fill(name);
  await page.getByRole('textbox',{name:'Note',exact:true}).fill(`Transcript of ${name}`);
  await expect.poll(async()=>(await notes(page)).some(n=>n.title===name&&n.body===`Transcript of ${name}`)).toBe(true);
  await button(page,'Back to notes').click();
 }
 await page.evaluate(async()=>{
  const port=await import('/src/runtime/browser-notes-document.ts'),{retainAudio}=await import('/src/browser/note-audio-store.ts');
  const store=JSON.parse((await port.readBrowserNotesRaw())!);
  const bytes=new Uint8Array(3244),v=new DataView(bytes.buffer);for(const [offset,text]of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']] as const)for(let i=0;i<text.length;i++)bytes[offset+i]=text.charCodeAt(i);
  v.setUint32(4,bytes.length-8,true);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);v.setUint32(40,3200,true);
  const actions:Record<string,string[]>={'Venue meeting':['Book the venue','Email the caterer'],'Garden meeting':['Water the plants']};
  for(const note of store.records){
   note.audio=await retainAudio('audio-'+note.title.split(' ')[0].toLowerCase(),note.id,note.body,{blob:new Blob([bytes],{type:'audio/wav'}),durationMs:100});
   Object.assign(note,{kind:'voice',dur:0.1,summary:['Reviewed summary'],actions:actions[note.title].map(t=>({t,done:false})),onCal:true,lines:[{s:'me',at:0,t:note.body}]});
  }
  await port.browserNotesPort.compareExchange((await port.browserNotesPort.read())!,JSON.stringify(store));
 });
 await page.reload({waitUntil:'domcontentloaded'});
 // Calendar hand-offs land in the development browser calendar source (test mocks only).
 await openBrowserCalendar(page);await returnToApps(page);
}
/** Open a saved event or reminder from the Calendar app (the calendar source is reselected after a reload; the home agenda card reads Agent Calendar only). */
async function openCalendarItem(page:Page,name:string){
 await returnToApps(page);await openBrowserCalendar(page);
 const item=page.getByRole('button',{name:new RegExp(`^${name},`)}).first();
 // The hand-off picks the time, so look through the visible week for the saved day.
 const days=page.getByRole('button',{name:/^Day \d+$/});
 for(let i=0,n=await days.count();i<n&&!await item.isVisible();i++){await days.nth(i).click();await item.waitFor({timeout:500}).catch(()=>{});}
 await item.click();
}
/** Reload and open Older notes, where the linked recordings live, so links can name their note. */
async function reloadWithOlderNotes(page:Page){
 await page.reload({waitUntil:'domcontentloaded'});await selectLegacyNotes(page);
 await expect(page.getByRole('heading',{name:'Older notes',exact:true})).toBeVisible();await returnToApps(page);
}
async function openRecording(page:Page,name:string){
 await returnToApps(page);await selectLegacyNotes(page);await button(page,`Open ${name}`).click();
 await expect(button(page,'Play recording')).toBeVisible();
}
async function saveEventDraft(page:Page,name:string){
 await title(page).fill(name);await button(page,'Save event').click();
 await expect(page.getByRole('heading',{name,level:1})).toBeVisible();
}

test('an event draft writes nothing until Save, then links to exactly the note it came from',async({page})=>{
 await setup(page);
 await openRecording(page,'Venue meeting');
 // Both hand-offs are offered side by side and clearly named.
 await expect(button(page,'Review reminder draft')).toBeVisible();
 await expect(button(page,'Review calendar event draft')).toBeVisible();
 const before=await notes(page);
 await button(page,'Review calendar event draft').click();
 await expect(title(page)).toHaveValue('');
 await expect(page.getByRole('textbox',{name:'Notes',exact:true})).toHaveValue('Book the venue\nEmail the caterer');
 await expect(page.getByText('Choose one action and review its time, then Save. Nothing is on your calendar yet.',{exact:true})).toBeVisible();
 await expect(button(page,'Save event')).toBeDisabled();
 expect(await events(page)).toEqual([]);expect(await reminders(page)).toEqual([]);expect(await links(page)).toEqual({});
 // Leaving the draft saves nothing and changes no note.
 await button(page,'Back to calendar').last().click();
 expect(await events(page)).toEqual([]);expect(await notes(page)).toEqual(before);

 // A second hand-off from another note replaces the unsaved draft; the saved event names that note only.
 await openRecording(page,'Garden meeting');
 await button(page,'Review calendar event draft').click();
 await expect(page.getByRole('textbox',{name:'Notes',exact:true})).toHaveValue('Water the plants');
 await saveEventDraft(page,'Water the plants');
 const saved=await events(page);
 expect(saved).toHaveLength(1);
 expect(saved[0]).toMatchObject({calendarId:'local',title:'Water the plants',body:'Water the plants'});
 expect(saved[0].end-saved[0].begin).toBe(3_600_000);
 expect(await reminders(page)).toEqual([]);
 await expect(page.getByText('From note: Garden meeting',{exact:true})).toBeVisible();
 await expect(page.getByText(/From note: Venue meeting/)).toHaveCount(0);
 await expect.poll(()=>links(page)).toEqual({[`event:${saved[0].id}`]:'Garden meeting'});
 // The stored link holds identity only: no title, transcript, summary or action text.
 expect(Object.keys(Object.values(await stored(page))[0]).sort()).toEqual(['audioId','noteId','revision','savedAt','version']);
 expect(JSON.stringify(await stored(page))).not.toMatch(/Garden meeting|Transcript|Reviewed summary|Water the plants/);

 await button(page,'Open note Garden meeting').click();
 await expect(button(page,'Play recording')).toBeVisible();
 await expect(page.locator('input[aria-label="Title"]:visible').last()).toHaveValue('Garden meeting');
 expect(await notes(page)).toEqual(before);

 // After a reload the link is still there. Older notes is not open yet, so the link names where
 // the note lives without claiming it is gone; Open note opens Older notes and then that note.
 await page.reload({waitUntil:'domcontentloaded'});
 await openCalendarItem(page,'Water the plants');
 await expect(page.getByText('From a voice note in Older notes',{exact:true})).toBeVisible();
 await expect(page.getByText('From a note that is no longer in Notes',{exact:true})).toHaveCount(0);
 await button(page,'Open note').click();
 await expect(button(page,'Play recording')).toBeVisible();
 await expect(page.locator('input[aria-label="Title"]:visible').last()).toHaveValue('Garden meeting');
 expect(await notes(page)).toEqual(before);
 // With Older notes open the link names the note again.
 await openCalendarItem(page,'Water the plants');
 await expect(page.getByText('From note: Garden meeting',{exact:true})).toBeVisible();
 expect(await events(page)).toHaveLength(1);
});

test('a reminder from a note carries the same link; an unrelated event and reminder have none',async({page})=>{
 await setup(page);
 await openRecording(page,'Venue meeting');
 await button(page,'Review reminder draft').click();
 await expect(page.getByRole('textbox',{name:'Notes',exact:true})).toHaveValue('Book the venue\nEmail the caterer');
 expect(await reminders(page)).toEqual([]);
 await title(page).fill('Book the venue');await button(page,'Save event').click();
 await expect.poll(async()=>(await reminders(page)).length).toBe(1);
 const reminder=(await reminders(page))[0];
 await expect.poll(()=>links(page)).toEqual({[`reminder:${reminder.id}`]:'Venue meeting'});
 await button(page,/^Book the venue,/).click();
 await expect(page.getByText('From note: Venue meeting',{exact:true})).toBeVisible();
 await button(page,'Open note Venue meeting').click();
 await expect(page.locator('input[aria-label="Title"]:visible').last()).toHaveValue('Venue meeting');
 // Deleting the reminder removes its link.
 await openCalendarItem(page,'Book the venue');
 await expect(page.getByText('From note: Venue meeting',{exact:true})).toBeVisible();
 await button(page,'Delete event').click();
 await page.getByRole('dialog',{name:'Delete reminder?',exact:true}).getByRole('button',{name:'Delete reminder',exact:true}).click();
 await expect(page.getByRole('complementary',{name:'Pending deletions'}).getByRole('button',{name:'Undo',exact:true})).toBeVisible();
 expect(await links(page)).toEqual({[`reminder:${reminder.id}`]:'Venue meeting'});
 await expect.poll(()=>reminders(page),{timeout:20_000}).toEqual([]);
 await expect.poll(()=>links(page)).toEqual({});
 // A record created directly in Calendar shows no link.
 await button(page,'New event').click();await saveEventDraft(page,'Unrelated event');
 await expect(page.getByText(/From note:/)).toHaveCount(0);
 expect(await links(page)).toEqual({});
});

test('the open-note action fails closed when the note was deleted or replaced, and says when it was edited',async({page})=>{
 await setup(page);
 await openRecording(page,'Venue meeting');
 await button(page,'Review calendar event draft').click();
 await saveEventDraft(page,'Venue walkthrough');
 const event=(await events(page))[0];
 const openEvent=async()=>{await openCalendarItem(page,'Venue walkthrough');await expect(page.getByRole('heading',{name:'Venue walkthrough',level:1})).toBeVisible();};

 // Edited after the hand-off (an action ticked): still the same note, opened with a notice.
 await openRecording(page,'Venue meeting');
 await button(page,/Book the venue/).first().click();
 await expect.poll(async()=>(await notes(page)).find(n=>n.title==='Venue meeting').actions[0].done).toBe(true);
 await openEvent();
 await button(page,'Open note Venue meeting').click();
 await expect(page.getByText('This note was edited after this was created from it.',{exact:true})).toBeVisible();
 await expect(page.locator('input[aria-label="Title"]:visible').last()).toHaveValue('Venue meeting');

 // Renamed after the hand-off: the link shows the note's current title, never the old one, and no
 // title is kept with the link.
 const beforeRename=await page.evaluate(async()=>{
  const port=await import('/src/runtime/browser-notes-document.ts'),raw=(await port.readBrowserNotesRaw())!,store=JSON.parse(raw);
  store.records.find((n:any)=>n.title==='Venue meeting').title='Private debrief';
  await port.browserNotesPort.compareExchange((await port.browserNotesPort.read())!,JSON.stringify(store));return raw;
 });
 await reloadWithOlderNotes(page);
 await openEvent();
 await expect(page.getByText('From note: Private debrief',{exact:true})).toBeVisible();
 await expect(page.getByText(/Venue meeting/)).toHaveCount(0);
 expect(JSON.stringify(await stored(page))).not.toMatch(/Private debrief|Venue meeting/);
 await button(page,'Open note Private debrief').click();
 await expect(page.locator('input[aria-label="Title"]:visible').last()).toHaveValue('Private debrief');
 await page.evaluate(async raw=>{const port=await import('/src/runtime/browser-notes-document.ts');await port.browserNotesPort.compareExchange((await port.browserNotesPort.read())!,raw);},beforeRename);
 await page.reload({waitUntil:'domcontentloaded'});

 // Same id, different recording: not the note this came from. Nothing opens and no title is shown.
 const original=await page.evaluate(async()=>{
  const port=await import('/src/runtime/browser-notes-document.ts'),raw=(await port.readBrowserNotesRaw())!,store=JSON.parse(raw);
  const note=store.records.find((n:any)=>n.title==='Venue meeting');note.audio={...note.audio,audioId:'another-recording'};
  await port.browserNotesPort.compareExchange((await port.browserNotesPort.read())!,JSON.stringify(store));return raw;
 });
 await reloadWithOlderNotes(page);
 await openEvent();
 await expect(page.getByText('From a note that is no longer in Notes',{exact:true})).toBeVisible();
 await expect(page.getByText(/From note:/)).toHaveCount(0);
 await button(page,'Open note').click();
 await expect(page.getByText('The note this came from was deleted or replaced. Nothing was opened.',{exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Venue walkthrough',level:1})).toBeVisible();
 await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');
 await page.evaluate(async raw=>{const port=await import('/src/runtime/browser-notes-document.ts');await port.browserNotesPort.compareExchange((await port.browserNotesPort.read())!,raw);},original);
 await page.reload({waitUntil:'domcontentloaded'});

 // Deleted (moved to Trash): nothing opens, the event is unchanged, the other note is never opened instead.
 await openRecording(page,'Venue meeting');
 await button(page,'Delete note').click();
 await expect.poll(async()=>(await notes(page)).map(n=>n.title)).toEqual(['Garden meeting']);
 await openEvent();
 // A note in Trash is not shown as live: its title is not displayed and is stored nowhere with the link.
 await expect(page.getByText('From a note that is no longer in Notes',{exact:true})).toBeVisible();
 await expect(page.getByText(/Venue meeting/)).toHaveCount(0);
 expect(JSON.stringify(await stored(page))).not.toMatch(/Venue meeting/);
 await button(page,'Open note').click();
 await expect(page.getByText('The note this came from was deleted or replaced. Nothing was opened.',{exact:true})).toBeVisible();
 await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');
 expect((await events(page))[0]).toEqual(event);
});

test('double activation makes one draft; a reload mid hand-off keeps the draft and its note, and saves once',async({page})=>{
 const dialogs:string[]=[];page.on('dialog',d=>{dialogs.push(d.message());void d.accept();});
 await setup(page);
 await openRecording(page,'Venue meeting');
 // Two activations in the same task: one Calendar form, not two.
 await button(page,'Review calendar event draft').evaluate((el:HTMLElement)=>{el.click();el.click();});
 await expect(title(page)).toHaveCount(1);
 await title(page).fill('Booked once');
 const venue=(await notes(page)).find(n=>n.title==='Venue meeting');
 // The retained draft holds the event title and the identity of the note it came from, not the note's title.
 await expect.poll(()=>page.evaluate(async()=>{const {assistantDraftStore}=await import('/src/runtime/assistant-draft-store.ts');const text=(await(await assistantDraftStore(JSON.stringify(['calendar-creation-form','development']))).read())?.text;return text?JSON.parse(text).form:null;})).toEqual(expect.objectContaining({title:'Booked once',cal:'native:local',origin:{version:1,noteId:venue.id,audioId:venue.audio.audioId,revision:expect.stringMatching(/^[a-f0-9]{64}$/)}}));
 expect(await events(page)).toEqual([]);
 // Reload with the unsaved draft open: nothing was saved; New event restores it.
 await reloadWithOlderNotes(page);
 expect(await events(page)).toEqual([]);expect(await links(page)).toEqual({});
 await openBrowserCalendar(page);await button(page,'New event').click();
 await expect(title(page)).toHaveValue('Booked once');
 await expect(page.getByRole('textbox',{name:'Notes',exact:true})).toHaveValue('Book the venue\nEmail the caterer');
 // Two Save activations: exactly one event, linked to the note the draft came from.
 await button(page,'Save event').evaluate((el:HTMLElement)=>{el.click();el.click();});
 await expect(page.getByRole('heading',{name:'Booked once',level:1})).toBeVisible();
 await expect(page.getByText('From note: Venue meeting',{exact:true})).toBeVisible();
 const saved=await events(page);expect(saved).toHaveLength(1);
 await expect.poll(()=>links(page)).toEqual({[`event:${saved[0].id}`]:'Venue meeting'});
 // A draft switched from the reminder list to the in-app calendar keeps its note too.
 await openRecording(page,'Garden meeting');
 await button(page,'Review reminder draft').click();
 await button(page,'In this app').click();
 await saveEventDraft(page,'Garden walk');
 await expect(page.getByText('From note: Garden meeting',{exact:true})).toBeVisible();
 expect(await events(page)).toHaveLength(2);expect(await reminders(page)).toEqual([]);
 for(const message of dialogs)expect(message).toBe('Replace the retained unsaved form with a new event?');
});

// Canonical path: an agent Notes record (closed app-record fixture, no server) hands its text to a
// reminder draft from Alpha's note editor (canonical-notes-ui.ts, the shared noteScheduleDraft). The saved reminder keeps a version 2
// record link (note id and a hash of its authored fields only) that opens that exact record.
test('a canonical note opens a reminder draft whose saved reminder links back to that exact record',async({page})=>{
 const {errors}=await canonicalNotesFixture(page);
 await openBrowserCalendar(page);await returnToApps(page);
 await openCanonicalNotes(page);
 await button(page,'New note').click();await title(page).fill('Venue plan');
 await page.getByRole('textbox',{name:'Note',exact:true}).fill('Book the venue');
 await button(page,'Back to notes').click();
 await button(page,'Open Venue plan').click();
 const before=await page.evaluate(()=>structuredClone((window as any).canonicalNotesFixture.state.notes));
 await button(page,'Review reminder draft').click();
 await expect(page.getByRole('textbox',{name:'Notes',exact:true})).toHaveValue('Book the venue');
 await expect(page.getByText('Review the time, then Save. Nothing scheduled yet.',{exact:true})).toBeVisible();
 expect(await reminders(page)).toEqual([]);expect(await stored(page)).toEqual({});
 await button(page,'Save event').click();
 await expect.poll(async()=>(await reminders(page)).length).toBe(1);
 const reminder=(await reminders(page))[0];
 await expect.poll(async()=>Object.keys(await stored(page))).toEqual([`reminder:${reminder.id}`]);
 const link=(await stored(page))[`reminder:${reminder.id}`];
 expect(Object.keys(link).sort()).toEqual(['noteId','revision','savedAt','version']);
 expect(link).toMatchObject({version:2,noteId:before[0].id});
 expect(JSON.stringify(await stored(page))).not.toMatch(/Venue plan|Book the venue/);
 await button(page,/^Venue plan,/).click();
 await expect(page.getByText('From note: Venue plan',{exact:true})).toBeVisible();
 await button(page,'Open note Venue plan').click();
 await expect(page.getByRole('textbox',{name:'Note',exact:true})).toHaveValue('Book the venue');
 expect(await page.evaluate(()=>(window as any).canonicalNotesFixture.state.notes)).toEqual(before);
 expect(errors).toEqual([]);
});
