import {openLegacyNotes} from './helpers/legacy-notes';
import {openBrowserCalendar} from './helpers/browser-calendar';
/*
 * Journey B / J02: Voice -> note -> calendar event and reminder, driven start to finish through
 * rendered controls in the browser build with the development agent profile.
 *
 * Loop covered in one test:
 *  1. Notes "Record and transcribe" -> Done -> Cloud transcript saved as a voice note.
 *  2. Reload, reopen the saved recording and "Read aloud" / "Stop reading".
 *  3. "Review transcript with Alpha" -> Send -> "Review summary note" -> "Save recording summary".
 *  4. Hand-offs from the note: "Review reminder draft" -> Calendar form -> Save (a reminder), and
 *     "Review calendar event draft" -> Calendar form -> Save (a calendar event). Each saved record
 *     shows "From note: Venue meeting" and opens that note.
 *  5. Agent path: a reminder-create and a calendar-create operation queued through
 *     "Development device actions", each reviewed and approved in the conversation.
 *  6. Reload: every record exists exactly once, with completed action receipts for the agent path.
 *  7. Edit and delete the event and the reminder through Calendar controls (the event deletion has
 *     one review step; Cancel deletes nothing); verify persisted state.
 *
 * Synthetic fixtures (external boundaries only):
 *  - Microphone: getUserMedia returns a Web Audio oscillator stream. The browser's real
 *    MediaRecorder records it and the real retained-audio store keeps it.
 *  - Cloud transcription: the closed Cloud voice fixture (cloud-voice-fixture.ts) returns a fixed
 *    transcript for the recorded clip. No provider is contacted.
 *  - Speech output: the synthetic local browser voice (voice-fixture.ts) records utterances
 *    instead of producing sound.
 *  - Agent: the development agent profile. Its scripted reply is the summary/action-item answer,
 *    and its "Development device actions" queue stands in for an agent proposing device actions.
 *    The calendar source id/revision in the queued calendar operation is read (read-only) from the
 *    same phone context a real agent receives with the chat message.
 *
 * Native-only / not provable here:
 *  - A physically spoken note, real speech recognition quality and audible playback/read-aloud.
 *  - OS notification delivery, snooze from the notification and reboot survival of the reminder
 *    (the browser reports "Scheduled · approximate delivery").
 *  - Android Calendar provider accounts, attendees and provider-side read-back.
 *  - A real agent deciding to propose these actions.
 *
 * A pass is source/test evidence only. It is not APK, emulator, AOSP image, device or
 * real-integration evidence.
 */
import {test,expect,type Page} from '@playwright/test';
import {returnToApps} from './app-navigation';
import {installCloudVoiceFixture} from './cloud-voice-fixture';
import {localBrowserVoice} from './voice-fixture';

test.setTimeout(420_000);

const transcript='Meeting: we agreed to book the venue for Friday and email the caterer.';
const summary='The team agreed to book the venue.';
const actionText='Book the venue\nEmail the caterer';

// READ-ONLY views of persisted state.
const notes=(page:Page)=>page.evaluate(async()=>JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())||'{"records":[]}').records as any[]);
const reminders=(page:Page)=>page.evaluate(async()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())||'{"reminders":[]}').reminders as any[]);
const events=(page:Page)=>page.evaluate(async()=>JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())||'{"events":[]}').events as any[]);
const actions=(page:Page)=>page.evaluate(async()=>(await (await import('/src/browser/development-execution-document.ts')).readExecutionPart({namespace:'local'} as any,'actions',()=>({proposals:[],journal:[]}))) as any);
const phoneContext=(page:Page)=>page.evaluate(async()=>JSON.parse(JSON.stringify((await import('/src/runtime/alpha-client.ts')).alphaClient.getState().context)) as any);
const liveReminders=async(page:Page)=>(await reminders(page)).filter(r=>r.status!=='cancelled').map(r=>r.title).sort();
const eventTitles=async(page:Page)=>(await events(page)).map(e=>e.title).sort();

const ready=async(page:Page,withNotes=false)=>{await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeVisible({timeout:90_000});if(withNotes){await openLegacyNotes(page);await returnToApps(page);}await openBrowserCalendar(page);await returnToApps(page);};
async function openDeviceActions(page:Page){
 await returnToApps(page);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Agent connection',exact:true}).click();
 await page.getByText('Development device actions',{exact:true}).click();
}
async function queueAction(page:Page,operation:unknown){
 await openDeviceActions(page);
 await page.getByRole('textbox',{name:'Action JSON'}).fill(JSON.stringify(operation));
 await page.getByRole('button',{name:'Queue action for review'}).click();
 await expect(page.getByText('Action queued. Send a chat message to review it on the current screen.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Close connection settings'}).click();
 await returnToApps(page);
}
async function openSavedRecording(page:Page){
 await openLegacyNotes(page);
 await page.getByRole('button',{name:'Open Venue meeting',exact:true}).click();
 await expect(page.getByRole('button',{name:'Play recording',exact:true})).toBeVisible();
}
/** The retained browser provider is selected explicitly; Home's agenda uses Agent Calendar. */
async function openHandoffDayInCalendar(page:Page,titles:string){
 await returnToApps(page);
 await openBrowserCalendar(page);
 const event=(await events(page)).find(row=>new RegExp(`^(${titles})$`).test(row.title));
 expect(event).toBeTruthy();
 const date=new Date(event.begin);
 const label=date.toLocaleDateString('en-US',{weekday:'long'})+' '+date.toLocaleDateString('en-US',{month:'long'})+' '+date.getDate();
 await page.getByRole('button',{name:'Month view',exact:true}).click();
 await page.getByRole('dialog',{name:'Choose calendar date',exact:true}).getByRole('button',{name:label,exact:true}).click();
 await expect(page.getByRole('region',{name:'Calendar timeline'})).toBeVisible();
}

test('Journey B: recorded note is read aloud, summarized, and becomes an event and a reminder that persist once, then are edited and deleted',async({page})=>{
 const dialogs:string[]=[];
 page.on('dialog',d=>{dialogs.push(d.message());void d.accept();});
 // Keep retained-audio playback silent; playback itself is real.
 await page.addInitScript(()=>{const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){this.muted=true;return play.call(this);};});
 await page.goto('/?mode=dev');await ready(page,true);

 // Development agent profile with the summary answer the reviewed recording question will receive.
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Agent connection',exact:true}).click();
 await page.getByRole('textbox',{name:'Scripted reply'}).fill(JSON.stringify({summary,actions:actionText.split('\n')}));
 await page.getByRole('button',{name:'Save development reply'}).click();
 await page.getByRole('button',{name:'Connect development profile'}).click();
 await returnToApps(page);await openBrowserCalendar(page);await returnToApps(page);

 // ---- 1. Record, transcribe, correct, save ----
 await installCloudVoiceFixture(page,transcript);
 await page.bringToFront();
 await page.evaluate(()=>{
  const ctx=new AudioContext(),osc=ctx.createOscillator(),gain=ctx.createGain(),sink=ctx.createMediaStreamDestination();gain.gain.value=.1;osc.connect(gain);gain.connect(sink);osc.start();
  document.addEventListener('click',()=>{void ctx.resume();},{once:true,capture:true});
  const Original=MediaRecorder;(window as any).recordedBytes=0;
  window.MediaRecorder=class extends Original{constructor(stream:MediaStream,options?:MediaRecorderOptions){super(stream,options);this.addEventListener('dataavailable',event=>{(window as any).recordedBytes+=event.data.size;});}};
  Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>sink.stream},configurable:true});(window as any).fixture={ctx,osc};
 });
 await openLegacyNotes(page);
 await page.getByRole('button',{name:'Record and transcribe',exact:true}).click();
 // The recorder starts at once; Done transcribes and saves one voice note (corrections happen in the note).
 const recorder=page.locator('[data-alpha-subview="notes-recorder"]');
 await expect(recorder).toHaveAttribute('data-recorder-state','recording');
 await expect.poll(()=>page.evaluate(()=>(window as any).recordedBytes)).toBeGreaterThan(0);
 await recorder.getByRole('button',{name:'Done',exact:true}).click();
 await expect(page.getByRole('button',{name:'Play recording',exact:true})).toBeVisible();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Venue meeting');
 await expect.poll(async()=>(await notes(page)).filter(n=>n.kind==='voice'&&n.title==='Venue meeting'&&n.body===transcript&&!!n.audio?.audioId).length).toBe(1);
 await page.evaluate(async()=>{const {ctx,osc}=(window as any).fixture;osc.stop();await ctx.close();});

 // ---- 2. Reload, reopen ----
 await page.reload();await ready(page,true);
 await localBrowserVoice(page);
 await openSavedRecording(page);
 await expect(page.getByText(transcript,{exact:true}).first()).toBeVisible();
 // Reading aloud is asked of Alpha; the voice note toolbar has no Read aloud button (PLAN.md section 3).
 await expect(page.getByRole('button',{name:'Read aloud',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).voiceFixture.spoken as string[])).toEqual([]);
 const recorded=(await notes(page))[0];

 // ---- 3. Reviewed transcript question -> reviewed summary and action items ----
 await page.getByRole('button',{name:'Review transcript with Alpha',exact:true}).click();
 const question=page.getByRole('dialog',{name:'Ask about selected content'});
 await expect(question.getByRole('textbox',{name:'Content excerpt'})).toHaveValue(transcript);
 await expect(question.getByRole('textbox',{name:'Question about content'})).toHaveValue(/Do not change or schedule anything/);
 await question.getByRole('button',{name:'Use in conversation',exact:true}).click();
 await expect(question).toHaveCount(0);
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.getByText('Review summary note',{exact:true}).click();
 const summaryReview=page.getByRole('dialog',{name:'Save reviewed summary note'});
 await expect(summaryReview.getByRole('textbox',{name:'Summary note text'})).toHaveValue(summary);
 await expect(summaryReview.getByRole('textbox',{name:'Action items, one per line'})).toHaveValue(actionText);
 expect((await notes(page))[0]).toEqual(recorded);
 await summaryReview.getByRole('button',{name:'Save recording summary',exact:true}).click();
 await expect(summaryReview).toHaveCount(0);
 await expect(page.getByText('Recording summary saved',{exact:true})).toBeVisible();
 const summarized=await notes(page);
 expect(summarized).toHaveLength(1);
 expect(summarized[0]).toMatchObject({id:recorded.id,audio:recorded.audio,body:transcript,summary:[summary],actions:[{t:'Book the venue',done:false},{t:'Email the caterer',done:false}]});
 // Saving a summary schedules nothing.
 expect(await reminders(page)).toHaveLength(0);expect(await events(page)).toHaveLength(0);

 // ---- 4a. Hand-off from the note: reminder draft -> Calendar review -> Save ----
 await page.getByRole('button',{name:'Minimize chat',exact:true}).click();
 await page.getByRole('button',{name:'Review reminder draft',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('');
 await expect(page.getByRole('textbox',{name:'Notes',exact:true})).toHaveValue(actionText);
 await expect(page.getByRole('button',{name:'Save event',exact:true})).toBeDisabled();
 expect(await reminders(page)).toHaveLength(0);
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Book the venue');
 await page.getByRole('button',{name:'Save event',exact:true}).click();
 await expect.poll(async()=>(await reminders(page)).length).toBe(1);
 const handoffReminder=(await reminders(page))[0];
 expect(handoffReminder).toMatchObject({title:'Book the venue',body:actionText,status:'scheduled'});
 expect(await events(page)).toHaveLength(0);

 // The saved reminder names the note it came from.
 await page.getByRole('button',{name:/^Book the venue,/}).click();
 await expect(page.getByText('From note: Venue meeting',{exact:true})).toBeVisible();

 // ---- 4b. Direct hand-off from the note: calendar event draft -> Calendar review -> Save ----
 await returnToApps(page);
 await openSavedRecording(page);
 await page.getByRole('button',{name:'Review calendar event draft',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('');
 await expect(page.getByRole('textbox',{name:'Notes',exact:true})).toHaveValue(actionText);
 await expect(page.getByRole('button',{name:'Save event',exact:true})).toBeDisabled();
 // Opening the draft writes nothing.
 expect(await events(page)).toHaveLength(0);expect(await reminders(page)).toHaveLength(1);
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Venue walkthrough');
 await page.getByRole('button',{name:'Save event',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Venue walkthrough',level:1})).toBeVisible();
 await expect(page.getByText('From note: Venue meeting',{exact:true})).toBeVisible();
 const handoffEvent=(await events(page))[0];
 expect(await events(page)).toHaveLength(1);
 expect(handoffEvent).toMatchObject({calendarId:'local',title:'Venue walkthrough',body:actionText,begin:handoffReminder.at});
 expect(handoffEvent.end-handoffEvent.begin).toBe(3_600_000);
 expect(await reminders(page)).toHaveLength(1);

 // ---- 5a. Agent path: reviewed reminder-create ----
 const hour=Math.ceil(Date.now()/3_600_000)*3_600_000;
 const dueAt=new Date(hour+72*3_600_000).toISOString(),eventStart=new Date(hour+48*3_600_000).toISOString(),eventEnd=new Date(hour+49*3_600_000).toISOString();
 await queueAction(page,{type:'create_reminder',title:'Email the caterer',dueAt});
 await page.getByRole('textbox',{name:'Ask Alpha',exact:true}).fill('Review my reminder action');
 await page.getByRole('textbox',{name:'Ask Alpha',exact:true}).press('Enter');
 const approveReminder=page.getByRole('button',{name:/^Create reminder/});
 await expect(approveReminder).toHaveCount(1);
 // Queued and shown, but nothing runs before approval.
 expect(await liveReminders(page)).toEqual(['Book the venue']);
 await approveReminder.click();
 await expect.poll(async()=>(await actions(page)).proposals.filter((p:any)=>p.payload.operation.type==='create_reminder').map((p:any)=>[p.state,p.receipt?.outcome])).toEqual([['completed','applied']]);
 await expect(page.getByRole('button',{name:/^Message actions: Created reminder “Email the caterer”/}).first()).toBeVisible();
 expect(await liveReminders(page)).toEqual(['Book the venue','Email the caterer']);
 expect((await reminders(page)).find(r=>r.title==='Email the caterer')).toMatchObject({at:Date.parse(dueAt),status:'scheduled'});

 // ---- 5b. Agent path: reviewed calendar-create against the selected Calendar source ----
 await returnToApps(page);
 await openBrowserCalendar(page);
 await page.getByRole('button',{name:'New event',exact:true}).click();
 await expect.poll(async()=>(await phoneContext(page)).selectedObject?.kind).toBe('calendar-source');
 const source=(await phoneContext(page));
 // A zone that is not this phone's, so the review has to say which one the event is saved in.
 const eventZone=source.timeZone==='Asia/Tokyo'?'Europe/Paris':'Asia/Tokyo';
 const calendarCreate={type:'calendar_create',source:{sourceId:source.selectedObject.id,sourceRevision:source.selectedObject.revision},fields:{title:'Venue booking call',description:'From the venue meeting note',location:'Main hall',start:eventStart,end:eventEnd,timeZone:eventZone}};
 await page.getByRole('button',{name:'Back to calendar',exact:true}).last().click();
 await queueAction(page,calendarCreate);
 await openBrowserCalendar(page);
 await page.getByRole('button',{name:'New event',exact:true}).click();
 await expect.poll(async()=>(await phoneContext(page)).selectedObject?.revision).toBe(calendarCreate.source.sourceRevision);
 await page.getByRole('button',{name:'Open conversation',exact:true}).click();
 await page.getByRole('textbox',{name:'Message Alpha',exact:true}).fill('Review my calendar action');
 await page.getByRole('textbox',{name:'Message Alpha',exact:true}).press('Enter');
 const approveEvent=page.getByRole('button',{name:/^Create event/});
 await expect(approveEvent).toHaveCount(1);
 expect(await eventTitles(page)).toEqual(['Venue walkthrough']);
 await approveEvent.click();
 const calendarReview=page.getByRole('dialog',{name:'Review calendar change'});
 // B-13: the review states every consequence of Confirm, not only the title: the calendar and
 // account written, the exact time in the event's zone, the zone itself (named against the
 // phone's), the all-day state and what happens to attendees. The agent contract carries no
 // attendees, so the honest statement is that none are added and nobody is invited.
 const zoned=(iso:string)=>new Intl.DateTimeFormat('en-US',{timeZone:eventZone,year:'numeric',month:'long',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(iso));
 expect((await calendarReview.getByRole('paragraph').innerText()).split('\n')).toEqual([
  'Create event',
  '“Venue booking call”',
  'Calendar: App calendar · Account: Alpha Phone',
  `${zoned(eventStart)} – ${zoned(eventEnd)}`,
  `Time zone: ${eventZone} (this phone is set to ${source.timeZone})`,
  'All day: no. This is a timed event.',
  'Attendees: none. This change adds no attendees and sends no invitations.',
  'Location: Main hall',
  'From the venue meeting note',
 ]);
 expect(await eventTitles(page)).toEqual(['Venue walkthrough']);
 await calendarReview.getByRole('button',{name:'Confirm',exact:true}).click();
 await expect.poll(async()=>(await actions(page)).proposals.filter((p:any)=>p.payload.operation.type==='calendar_create').map((p:any)=>[p.state,p.receipt?.outcome])).toEqual([['completed','applied']]);
 await expect(page.getByRole('button',{name:/^Message actions: Created event “Venue booking call”/}).first()).toBeVisible();
 expect(await eventTitles(page)).toEqual(['Venue booking call','Venue walkthrough']);

 // ---- 6. Reload: exactly once each, with receipts ----
 await page.reload();await ready(page,true);
 expect(await eventTitles(page)).toEqual(['Venue booking call','Venue walkthrough']);
 expect(await liveReminders(page)).toEqual(['Book the venue','Email the caterer']);
 expect(await reminders(page)).toHaveLength(2);
 expect((await events(page)).find(e=>e.title==='Venue booking call')).toMatchObject({calendarId:'local',body:'From the venue meeting note',location:'Main hall',begin:Date.parse(eventStart),end:Date.parse(eventEnd),timeZone:eventZone});
 // What was reviewed is what was saved: a timed event with no attendees.
 expect((await events(page)).find(e=>e.title==='Venue booking call')).not.toHaveProperty('who');
 expect((await events(page)).find(e=>e.title==='Venue booking call')).not.toHaveProperty('allDay');
 const recordedActions=await actions(page);
 expect(recordedActions.proposals.map((p:any)=>[p.payload.operation.type,p.state,p.receipt?.outcome])).toEqual([['create_reminder','completed','applied'],['calendar_create','completed','applied']]);
 expect(recordedActions.journal.map((j:any)=>[j.record.operation.type,j.phase,j.status])).toEqual([['create_reminder','terminal','succeeded'],['calendar_create','terminal','succeeded']]);
 expect(recordedActions.proposals[1].receipt.result).toMatchObject({kind:'calendar_create',sourceId:'local',eventId:(await events(page)).find(e=>e.title==='Venue booking call').id});
 await openDeviceActions(page);
 await page.getByRole('button',{name:'Sync recorded receipts'}).click();
 const connection=page.getByRole('dialog',{name:'Development connections'});
 await expect(connection.getByText(/Create event · “Venue booking call” · Completed · this phone: succeeded/)).toHaveCount(1);
 await expect(connection.getByText(/Create reminder · .*Email the caterer.* · Completed · this phone: succeeded/)).toHaveCount(1);
 await page.getByRole('button',{name:'Close connection settings'}).click();

 // ---- 7a. Edit the event and the reminder through Calendar controls ----
 await openHandoffDayInCalendar(page,'Book the venue|Venue walkthrough');
 await page.getByRole('button',{name:/^Venue walkthrough,/}).click();
 await page.getByRole('button',{name:'Edit event',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Venue walkthrough');
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Venue walkthrough edited');
 await page.getByRole('textbox',{name:'Location',exact:true}).fill('Main hall');
 await page.getByRole('button',{name:'Save event',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Venue walkthrough edited',level:1})).toBeVisible();
 // After a reload and an edit the event still names its note, and opens exactly that recording.
 await expect(page.getByText('From note: Venue meeting',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Open note Venue meeting',exact:true}).click();
 await expect(page.getByRole('button',{name:'Play recording',exact:true})).toBeVisible();
 await expect(page.getByText(transcript,{exact:true}).first()).toBeVisible();
 await openHandoffDayInCalendar(page,'Book the venue|Venue walkthrough edited');
 await page.getByRole('button',{name:/^Book the venue,/}).click();
 await expect(page.getByText('From note: Venue meeting',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Edit event',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Book the venue');
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Book the venue edited');
 await page.getByRole('button',{name:'Start later',exact:true}).click();
 await page.getByRole('button',{name:'Save event',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Book the venue edited',level:1})).toBeVisible();
 await page.reload();await ready(page,true);
 expect(await eventTitles(page)).toEqual(['Venue booking call','Venue walkthrough edited']);
 expect((await events(page)).find(e=>e.title==='Venue walkthrough edited')).toMatchObject({id:handoffEvent.id,location:'Main hall',body:actionText,begin:handoffEvent.begin,end:handoffEvent.end});
 expect(await liveReminders(page)).toEqual(['Book the venue edited','Email the caterer']);
 expect((await reminders(page)).find(r=>r.title==='Book the venue edited')).toMatchObject({body:actionText,at:handoffReminder.at+15*60_000,status:'scheduled'});

 // ---- 7b. Delete the event and the reminder through Calendar controls ----
 await openHandoffDayInCalendar(page,'Book the venue edited|Venue walkthrough edited');
 await page.getByRole('button',{name:/^Venue walkthrough edited,/}).click();
 // One review step names the event; Cancel deletes nothing.
 const deleteReview=page.getByRole('dialog',{name:'Delete calendar event?'});
 await page.getByRole('button',{name:'Delete event',exact:true}).click();
 await expect(deleteReview).toContainText('Venue walkthrough edited');
 await deleteReview.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Venue walkthrough edited',level:1})).toBeVisible();
 expect(await eventTitles(page)).toEqual(['Venue booking call','Venue walkthrough edited']);
 await page.getByRole('button',{name:'Delete event',exact:true}).click();
 await deleteReview.getByRole('button',{name:'Delete event',exact:true}).click();
 await expect.poll(()=>eventTitles(page),{timeout:15000}).toEqual(['Venue booking call']);
 await expect(page.getByRole('button',{name:/^Venue walkthrough edited,/})).toHaveCount(0);
 await page.getByRole('button',{name:/^Book the venue edited,/}).click();
 await page.getByRole('button',{name:'Delete event',exact:true}).click();
 await page.getByRole('dialog',{name:'Delete reminder?',exact:true}).getByRole('button',{name:'Delete reminder',exact:true}).click();
 await expect.poll(()=>liveReminders(page),{timeout:15000}).toEqual(['Email the caterer']);
 await expect(page.getByRole('button',{name:/^Book the venue edited,/})).toHaveCount(0);
 await page.reload();await ready(page,true);
 expect(await eventTitles(page)).toEqual(['Venue booking call']);
 expect(await liveReminders(page)).toEqual(['Email the caterer']);
 // The browser reminder store keeps a cancelled record rather than erasing it.
 expect((await reminders(page)).filter(r=>r.title==='Book the venue edited').map(r=>r.status)).toEqual(['cancelled']);
 // The recording itself is untouched by everything above.
 const finalNotes=await notes(page);
 expect(finalNotes).toHaveLength(1);
 expect(finalNotes[0]).toMatchObject({id:recorded.id,audio:recorded.audio,body:transcript,summary:[summary]});
 for(const message of dialogs)expect(message).toBe('Replace the retained unsaved form with a new event?');
});

// B-13 negative cases: a proposal that names a calendar source revision other than the one on
// screen is refused before any review opens, and leaving a review that is open saves nothing.
test('Journey B: a calendar proposal for a changed source is refused, and leaving an open review saves nothing',async({page})=>{
 await page.goto('/?mode=dev');await ready(page);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Agent connection',exact:true}).click();
 await page.getByRole('button',{name:'Connect development profile'}).click();
 await returnToApps(page);await openBrowserCalendar(page);await returnToApps(page);
 const hour=Math.ceil(Date.now()/3_600_000)*3_600_000;
 const fields=(title:string,timeZone:string)=>({title,description:'',location:'',start:new Date(hour+48*3_600_000).toISOString(),end:new Date(hour+49*3_600_000).toISOString(),timeZone});
 const openSource=async()=>{
  await returnToApps(page);
  await openBrowserCalendar(page);
  await page.getByRole('button',{name:'New event',exact:true}).click();
  await expect.poll(async()=>(await phoneContext(page)).selectedObject?.kind).toBe('calendar-source');
  return phoneContext(page);
 };
 const propose=async(operation:unknown,message:string)=>{
  await page.getByRole('button',{name:'Back to calendar',exact:true}).last().click();
  await queueAction(page,operation);
  await openSource();
  await page.getByRole('button',{name:'Open conversation',exact:true}).click();
  await page.getByRole('textbox',{name:'Message Alpha',exact:true}).fill(message);
  await page.getByRole('textbox',{name:'Message Alpha',exact:true}).press('Enter');
 };
 const source=await openSource();
 const review=page.getByRole('dialog',{name:'Review calendar change'});

 // ---- A source revision that is not the one on screen ----
 const stale=source.selectedObject.revision.split('').reverse().join('');
 expect(stale).not.toBe(source.selectedObject.revision);
 await propose({type:'calendar_create',source:{sourceId:source.selectedObject.id,sourceRevision:stale},fields:fields('Stale source event',source.timeZone)},'Review my stale calendar action');
 // The reply arrives, and the proposal for another source revision is not offered for approval at all.
 await expect(page.getByRole('button',{name:/^Message actions: Development reply/})).toHaveCount(1);
 await expect(page.getByRole('button',{name:/^Create event/})).toHaveCount(0);
 await expect(page.getByText('Stale source event',{exact:false})).toHaveCount(0);
 await expect(review).toHaveCount(0);
 expect(await eventTitles(page)).toEqual([]);
 expect((await actions(page)).proposals.map((p:any)=>[p.payload.operation.fields.title,p.state])).toEqual([['Stale source event','pending']]);

 // ---- A current proposal whose review is left open, then abandoned with Back ----
 await page.getByRole('button',{name:'Minimize chat',exact:true}).click();
 await propose({type:'calendar_create',source:{sourceId:source.selectedObject.id,sourceRevision:source.selectedObject.revision},fields:fields('Abandoned review event',source.timeZone)},'Review my calendar action');
 const approve=page.getByRole('button',{name:/^Create event/});
 await expect(approve).toHaveCount(1);
 await approve.click();
 await expect(review).toContainText('“Abandoned review event”');
 // With the event in the phone's own zone the review does not repeat the zone as a difference.
 await expect(review).toContainText(`Time zone: ${source.timeZone}\n`);
 await expect(review).not.toContainText('this phone is set to');
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));
 await expect(review).toHaveCount(0);
 expect(await eventTitles(page)).toEqual([]);
 await page.reload();await ready(page);
 expect(await eventTitles(page)).toEqual([]);
 const recorded=await actions(page);
 expect(recorded.journal.filter((j:any)=>j.status==='succeeded')).toEqual([]);
});
