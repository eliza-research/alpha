import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
const L = await import('../apps/app/src/prototype/locale-time.ts');
const H = await import('../apps/app/src/prototype/home-cards.ts');
L.setLocalePreferences({locale: 'en-US'});
const now = new Date(2026, 9, 7, 15, 30).getTime();
const at = (h, m = 0, day = 7) => new Date(2026, 9, day, h, m).getTime();

test('attention: not connected offers Gmail setup in Connections instead of a dead end', () => {
  for (const summary of [null, undefined, {state: 'not-connected'}, {state: 'ready'}]) {
    const card = H.presentHomeAttention(summary, now);
    assert.equal(card.action, 'connections');
    assert.equal(card.text, 'Set up Gmail');
    assert.doesNotMatch(card.label, /Accounts are not connected/);
  }
});
test('attention: connected shows the unread count, source and read time and opens Inbox', () => {
  const card = H.presentHomeAttention({state: 'ready', unread: 3, source: 'Gmail', updatedAt: at(15, 4)}, now);
  assert.deepEqual(card, {action: 'inbox', count: '3', text: 'unread · Gmail · 3:04 PM', label: 'Open Inbox: 3 unread emails'});
  assert.equal(H.presentHomeAttention({state: 'ready', unread: 0, source: 'Gmail', updatedAt: new Date(at(9)).toISOString()}, now).text, 'Nothing unread · Gmail · 9:00 AM');
  assert.deepEqual(H.presentHomeAttention({state: 'ready', unread: 1, source: 'Gmail'}, now), {action: 'inbox', count: '1', text: 'unread · Gmail', label: 'Open Inbox: 1 unread email'});
});
test('attention: stale and error states are explicit and still open Inbox for recovery', () => {
  const stale = H.presentHomeAttention({state: 'stale', unread: 2, source: 'Gmail', updatedAt: at(8, 15, 6)}, now);
  assert.equal(stale.action, 'inbox'); assert.equal(stale.count, '2');
  assert.equal(stale.text, 'Not updated since Tue, Oct 6 8:15 AM');
  const error = H.presentHomeAttention({state: 'error', source: 'Gmail', message: 'Gmail authorization expired'}, now);
  assert.deepEqual(error, {action: 'inbox', count: '!', text: 'Gmail authorization expired', label: 'Open Inbox to retry: Gmail authorization expired'});
  assert.equal(H.presentHomeAttention({state: 'error'}, now).text, 'Inbox could not be checked');
  assert.equal(H.presentHomeAttention({state: 'loading', source: 'Gmail'}, now).count, '…');
});
test('attention: a stale inbox that was never read claims no count and no "when last read"', () => {
  for (const unread of [0, undefined]) {
    const card = H.presentHomeAttention({state: 'stale', unread, source: 'Gmail', updatedAt: null}, now);
    assert.equal(card.count, '—');
    assert.equal(card.text, 'Not updated recently');
    assert.equal(card.label, 'Open Inbox: Gmail has not updated');
    assert.doesNotMatch(card.label, /when last read|unread/);
  }
  // With a completed read the last count and its time are named.
  assert.equal(H.presentHomeAttention({state: 'stale', unread: 0, source: 'Gmail', updatedAt: at(8, 15)}, now).label, 'Open Inbox: Gmail has not updated since 8:15 AM; 0 unread emails when last read');
});
test('brief: latest retained digest shows its summary, run time and agent; otherwise "No brief yet"', () => {
  assert.deepEqual(H.presentHomeBrief(null, now), {title: 'No brief yet', time: 'Workflows', source: '', label: 'Open workflows', has: false});
  assert.equal(H.presentHomeBrief({summary: '', ranAt: at(7), agent: 'Alpha', status: 'succeeded'}, now).title, 'No brief yet');
  const brief = H.presentHomeBrief({summary: 'Two meetings today and one reply to send.', ranAt: new Date(at(7, 2)).toISOString(), agent: 'Alpha', status: 'succeeded'}, now);
  assert.equal(brief.title, 'Two meetings today and one reply to send.');
  assert.equal(brief.time, 'Ran 7:02 AM'); assert.equal(brief.source, 'Alpha');
  assert.match(brief.label, /^Open workflows\. Latest brief from Alpha, ran 7:02 AM: Two meetings/);
  const long = H.presentHomeBrief({summary: 'x'.repeat(200), ranAt: at(7), agent: '', status: 'failed'}, now);
  assert.ok(long.title.length <= 56 && long.title.endsWith('…'));
  assert.equal(long.time, 'Failed 7:00 AM'); assert.equal(long.source, 'Your agent');
});
test('calendar: status strings map to explicit card states', () => {
  assert.equal(H.calendarCardState('Calendar access denied'), 'denied');
  assert.equal(H.calendarCardState('Calendar range could not be loaded. Open device calendars to retry.'), 'error');
  assert.equal(H.calendarCardState('Browser calendar could not be loaded. Retry or open Calendar recovery.'), 'error');
  assert.equal(H.calendarCardState('Loading calendars…'), 'loading');
  assert.equal(H.calendarCardState('Device calendars connected'), 'ready');
  assert.equal(H.calendarCardState('Calendar range limited to 2,000 events'), 'ready');
  assert.equal(H.calendarCardState('Device calendars are available in the Android app.'), 'unavailable');
  for (const status of ['Not connected', 'Connect device calendars', undefined]) assert.equal(H.calendarCardState(status), 'not-connected');
});
test('calendar: denied, error and retry copy replace neutral copy, and reads name their source', () => {
  const base = {agenda: null, readAt: at(15, 4), now, device: 'this device'};
  assert.deepEqual(H.presentHomeCalendar({...base, state: 'denied'}).title, 'Calendar access is off');
  assert.equal(H.presentHomeCalendar({...base, state: 'denied'}).source, '');
  assert.deepEqual([H.presentHomeCalendar({...base, state: 'error'}).title, H.presentHomeCalendar({...base, state: 'error'}).time], ['Calendar could not be read', 'Tap to retry']);
  const ready = H.presentHomeCalendar({...base, state: 'ready'});
  assert.deepEqual([ready.title, ready.source], ['Nothing coming up', 'Read 3:04 PM from this device']);
  const event = H.presentHomeCalendar({...base, state: 'ready', agenda: {title: 'Dentist', begin: at(16), allDay: false, video: false, people: []}});
  assert.deepEqual([event.title, event.time, event.video, event.source, event.label], ['Dentist', '4:00 PM', false, 'Read 3:04 PM from this device', 'Open calendar event: Dentist']);
  for (const state of ['denied', 'error', 'loading', 'ready', 'unavailable', 'not-connected']) assert.equal(H.presentHomeCalendar({...base, state}).label, 'Open your calendar', 'stable accessible name');
  assert.equal(H.presentHomeCalendar({...base, state: 'ready', agenda: {title: 'Pay rent', begin: at(9), allDay: false, video: false, people: [], overdue: true}}).time, 'Overdue');
  assert.equal(H.presentHomeCalendar({...base, state: 'ready', agenda: {title: 'Trip', begin: at(0, 0, 9), allDay: true, video: true, people: []}}).time, 'Fri, Oct 9');
});
test('calendar empty title: every state the card can show without an item', () => {
  const T = H.homeCalendarEmptyTitle;
  for (const source of [null, undefined, {loading: true, ready: true, status: 'Loading calendars…'}]) assert.equal(T(source), 'Loading events…');
  assert.equal(T({ready: true, status: 'Device calendar access allowed'}), 'No upcoming events');
  assert.equal(T({ready: true, truncated: true}), 'Results limited');
  assert.equal(T({ready: true, truncated: true}, true), 'No visible events', 'a hidden app calendar is not reported as empty');
  assert.equal(T({error: true, native: true, status: 'Calendar range could not be loaded. Open device calendars to retry.'}), 'Calendar unavailable');
  assert.equal(T({error: true, status: 'Calendar access denied'}), 'Calendar unavailable', 'a failed read is reported as a failure even after an earlier refusal');
  // A refusal and a calendar that was never connected are not failures and say what they are.
  assert.equal(T({native: true, status: 'Calendar access denied'}), 'Calendar access is off');
  assert.equal(T({native: true, status: 'Connect device calendars'}), 'Connect your calendar');
  assert.equal(T({native: true, status: 'Not connected'}), 'Connect your calendar');
  // A browser build without a calendar cannot offer a connection.
  assert.equal(T({native: false, status: 'Device calendars are available in the Android app.'}), 'Calendar unavailable');
  assert.equal(T({native: false, status: 'Connect device calendars'}), 'Calendar unavailable');
  assert.doesNotMatch(readFileSync(new URL('../apps/app/src/prototype/data-adapter.ts', import.meta.url), 'utf8'), /'No upcoming events'|'Calendar access is off'/, 'the Home adapter takes the title from this helper');
});
test('attendee initials come only from event names, capped with an overflow count', () => {
  assert.deepEqual(H.attendeeInitials([]), []);
  assert.deepEqual(H.attendeeInitials(['Ada Lovelace', 'grace hopper', 42, '']), ['AL', 'GH']);
  assert.deepEqual(H.attendeeInitials(['A B', 'C D', 'E F', 'G H', 'I J']), ['AB', 'CD', '+3']);
  const template = readFileSync(new URL('../apps/app/src/prototype/template.html', import.meta.url), 'utf8');
  assert.doesNotMatch(template, />(MC|JP|\+2)<\/span>/, 'no hard-coded avatar initials');
  assert.doesNotMatch(template, /\{\{lockSum\}\}|\{\{showHeads\}\}/, 'no fixture lock summary or heads-up banner');
  // The agenda card is the shared upstream card; its video icon is passed only with a meeting link.
  const cards = readFileSync(new URL('../apps/app/src/prototype/home-overview-cards.ts', import.meta.url), 'utf8');
  assert.match(cards, /videoIcon: out\.homeCalendarVideo \? createElement\('svg'[^\n]*out\.ic\?\.video[^\n]*: undefined,/, 'video icon only with a meeting link');
});
test('brief card: shown only for a retained result, with agent, run time and failure state', () => {
  assert.deepEqual(H.presentHomeBriefCard(null, now), {has: false, title: '', status: '', failed: false, label: ''});
  assert.equal(H.presentHomeBriefCard({summary: '  ', ranAt: at(7), agent: 'Alpha', status: 'succeeded'}, now).has, false);
  assert.equal(H.presentHomeBriefCard({summary: 'Ready', ranAt: 'not a time', agent: 'Alpha', status: 'succeeded'}, now).has, false, 'a result without a run time is not presented as a brief');
  const card = H.presentHomeBriefCard({summary: 'Two meetings today\nand one reply to send.', ranAt: new Date(at(7, 2)).toISOString(), agent: 'Alpha', status: 'succeeded'}, now);
  assert.deepEqual(card, {has: true, title: 'Two meetings today and one reply to send.', failed: false, status: 'Alpha · Ran 7:02 AM',
    label: 'Open scheduled digests. Latest brief from Alpha, ran 7:02 AM: Two meetings today and one reply to send.'});
  const failed = H.presentHomeBriefCard({summary: 'Source expired. ' + 'x'.repeat(200), ranAt: at(22, 30, 6), agent: '', status: 'failed'}, now);
  assert.equal(failed.failed, true); assert.equal(failed.status, 'Your agent · Failed Tue, Oct 6 10:30 PM');
  assert.ok(failed.title.length <= 96 && failed.title.endsWith('…'));
  assert.match(failed.label, /^Open scheduled digests\. Latest brief from Your agent, failed Tue, Oct 6 10:30 PM: Source expired\./);
  // The agent also retains occurrences it skipped. Those are never presented as a run.
  for (const status of ['missed', 'overlap', 'unavailable']) {
    const skipped = H.presentHomeBriefCard({summary: 'The scheduled time was missed. No backlog was executed.', ranAt: at(8), agent: 'Alpha', status}, now);
    assert.equal(skipped.status, 'Alpha · Did not run 8:00 AM', status); assert.equal(skipped.failed, false);
    assert.match(skipped.label, /^Open scheduled digests\. Latest brief from Alpha, did not run 8:00 AM: The scheduled time was missed\./);
    assert.doesNotMatch(skipped.status + skipped.label, /\bran\b/i);
    assert.equal(H.presentHomeBrief({summary: 'x', ranAt: at(8), agent: 'Alpha', status}, now).time, 'Did not run 8:00 AM');
  }
  assert.deepEqual(['finished', 'succeeded', 'completed', '', undefined].map(H.briefOutcome), ['ran', 'ran', 'ran', 'ran', 'ran']);
  assert.deepEqual(['failed', 'cancelled', 'error'].map(H.briefOutcome), ['failed', 'failed', 'failed']);
});
test('calendar source: useful names stay visible while read provenance remains accessible', () => {
  const base = {overdue: false, readAt: at(15, 4), now, native: true};
  assert.deepEqual(H.presentHomeCalendarSource({...base, state: 'ready', calendar: 'Work'}), {origin: 'Work', read: '', description: 'Work. Read 3:04 PM from calendars on this device'});
  assert.equal(H.presentHomeCalendarSource({...base, state: 'ready'}).origin, '');
  assert.deepEqual(H.presentHomeCalendarSource({...base, state: 'ready', native: false, truncated: true}), {origin: '', read: '', description: 'Read 3:04 PM from the calendar saved in this app; only the first 2,000 events were read'});
  const old = H.presentHomeCalendarSource({...base, state: 'ready', readAt: at(8, 15, 6)});
  assert.deepEqual([old.read, old.description], ['', 'Read Tue, Oct 6 8:15 AM from calendars on this device'], 'an old read retains its date in the accessible description');
  for (const state of ['loading', 'other']) assert.deepEqual(H.presentHomeCalendarSource({...base, state}), {origin: '', read: '', description: ''});
  assert.deepEqual(H.presentHomeCalendarSource({...base, state: 'ready', readAt: null}), {origin: '', read: '', description: ''});
  assert.deepEqual(H.presentHomeCalendarSource({...base, state: 'error'}), {origin: '', read: 'Open Calendar to retry', description: 'Calendar could not be read. Open Calendar to retry.'});
  assert.deepEqual(H.presentHomeCalendarSource({...base, state: 'error', overdue: true}), {origin: '', read: '', description: 'Overdue reminder saved on this device'}, 'an overdue reminder keeps its own source when the calendar read failed');
  // A reminder is attributed to the reminder store and that store's read time, never the calendar's.
  assert.deepEqual(H.presentHomeCalendarSource({...base, state: 'ready', calendar: 'Work', reminder: true, reminderReadAt: at(14, 50)}), {origin: 'Reminder', read: '', description: 'Reminder saved on this device, read 2:50 PM'});
  assert.deepEqual(H.presentHomeCalendarSource({...base, state: 'loading', native: false, reminder: true, reminderReadAt: at(8, 15, 6)}), {origin: 'Reminder', read: '', description: 'Reminder saved on this browser, read Tue, Oct 6 8:15 AM'});
  assert.deepEqual(H.presentHomeCalendarSource({...base, state: 'ready', reminder: true, reminderReadAt: null}), {origin: 'Reminder', read: '', description: 'Reminder saved on this device'}, 'no read time is claimed for a reminder without a recorded read');
  assert.deepEqual(H.presentHomeCalendarSource({...base, state: 'ready', overdue: true, reminderReadAt: at(14, 50)}), {origin: '', read: '', description: 'Overdue reminder saved on this device, read 2:50 PM'});
  assert.equal(H.presentHomeCalendarSource({...base, state: 'error', reminder: true, reminderReadAt: at(14, 50)}).read, 'Open Calendar to retry', 'a failed calendar read stays visible above an upcoming reminder');
  assert.equal(H.homeAgendaHeader('Mon, Oct 5', 0), 'Mon, Oct 5');
  assert.equal(H.homeAgendaHeader('Mon, Oct 5', 1), 'Overdue reminder');
  assert.equal(H.homeAgendaHeader('Mon, Oct 5', 3), '3 overdue reminders');
  assert.equal(H.overdueDueLabel(at(9), now), 'Due 9:00 AM');
  assert.equal(H.overdueDueLabel(at(9, 0, 5), now), 'Due Mon, Oct 5 9:00 AM');
});
test('next item: an overdue reminder does not hide the next event, which keeps its own source', () => {
  const provenance = H.presentHomeCalendarSource({state: 'ready', overdue: false, readAt: at(15, 4), now, native: true, calendar: 'Work'});
  assert.deepEqual(H.presentHomeNext({title: 'Design review', begin: at(16), allDay: false, now, provenance}),
    {text: 'Next: Design review 4:00 PM', source: 'Work', description: 'Next: Design review, 4:00 PM. Work. Read 3:04 PM from calendars on this device'});
  assert.equal(H.presentHomeNext({title: 'Standup', begin: at(15), allDay: false, now, provenance}).text, 'Next: Standup Now', 'an event in progress is the next item');
  assert.equal(H.presentHomeNext({title: 'Offsite', begin: at(9, 0, 9), allDay: true, now, provenance}).text, 'Next: Offsite Fri, Oct 9');
  assert.equal(H.presentHomeNext({title: 'Dentist', begin: at(9, 30, 8), allDay: false, now, provenance}).text, 'Next: Dentist Thu, Oct 8 9:30 AM');
  // A reminder after the overdue one names the reminder store, not a calendar.
  const reminder = H.presentHomeCalendarSource({state: 'ready', overdue: false, reminder: true, reminderReadAt: at(14, 50), readAt: at(15, 4), now, native: false});
  assert.deepEqual(H.presentHomeNext({title: '  ', begin: at(17), allDay: false, now, provenance: reminder}),
    {text: 'Next: Untitled event 5:00 PM', source: 'Reminder', description: 'Next: Untitled event, 5:00 PM. Reminder saved on this browser, read 2:50 PM'});
  const cards = readFileSync(new URL('../apps/app/src/prototype/home-overview-cards.ts', import.meta.url), 'utf8');
  assert.match(cards, /out\.homeCalendarHasNext \? \{text: String\(out\.homeCalendarNext \|\| ''\), source: ''\}/, 'the compact Next line omits a separate source label');
  assert.match(cards, /description: String\(out\.homeCalendarDescription \?\? ''\)/, 'the card retains the model description, including the next item source');
  assert.match(cards, /next: \{'data-alpha-home-calendar-next-line': ''\}, nextSource: \{'data-alpha-home-calendar-next-source': ''\}/);
});
test('next item under Agent Calendar: an overdue reminder shows whichever comes first of an upcoming phone reminder and the agent event', () => {
  const provenance = {origin: '', read: '', description: 'Agent Calendar'};
  const overdue = {title: 'Pay rent', begin: at(9), allDay: false, video: false};
  const reminderNext = {item: {title: 'Call mom', begin: at(16), allDay: false, video: false}, provenance: {origin: 'Reminder', read: '', description: 'Reminder'}};
  const agentEarly = {item: {title: 'Standup', begin: at(15, 45), allDay: false, video: false}, provenance};
  const agentLate = {item: {title: 'Review', begin: at(17), allDay: false, video: false}, provenance};
  const input = {now, item: overdue, provenance, next: reminderNext};
  assert.equal(H.overdueAgendaNext(input, true, agentLate).next, reminderNext, 'an earlier phone reminder is not hidden by a later agent event');
  assert.equal(H.overdueAgendaNext(input, true, agentEarly).next, agentEarly, 'an earlier agent event leads the Next line');
  assert.equal(H.overdueAgendaNext(input, true, null).next, reminderNext, 'no agent event keeps the phone reminder');
  assert.equal(H.overdueAgendaNext(input, false, agentLate).next, agentLate, "Home's own non-reminder next item yields to the chosen Agent Calendar");
  assert.equal(H.overdueAgendaNext(input, false, null).next, null, 'a device calendar event is never shown under Agent Calendar');
  assert.equal(H.overdueAgendaNext(input, true, agentLate).item, overdue, 'the overdue reminder still leads the card');
});
test('a phone reminder leading under Agent Calendar keeps a failed or out-of-date agent read visible above it', () => {
  const local = {now, item: {title: 'Call mom', begin: at(16), allDay: false, video: false}, provenance: {origin: 'Reminder', read: '', description: 'Reminder saved on this browser'}};
  const feed = state => H.presentHomeAgendaFeed({status: state === 'error' ? 'error' : 'ready', hasItem: state === 'stale', feedState: state === 'stale' ? 'partial' : 'complete', asOf: at(15), now, source: 'Agent Calendar'});
  assert.equal(H.agentReminderLead(local, feed('ready')), local, 'a fresh agent read leaves the reminder its own source');
  for (const status of ['loading', 'disconnected']) assert.equal(H.agentReminderLead(local, H.presentHomeAgendaFeed({status, hasItem: false, asOf: null, now, source: 'Agent Calendar'})), local, status + ' keeps the reminder source');
  const failed = H.presentHomeAgendaCard(H.agentReminderLead(local, feed('error')));
  assert.equal(failed.title, 'Call mom');
  assert.equal(failed.source, 'Open Calendar to retry');
  assert.match(failed.description, /Agent Calendar could not be read\. Open Calendar to retry/);
  assert.equal(failed.stale, false);
  const stale = H.presentHomeAgendaCard(H.agentReminderLead(local, feed('stale')));
  assert.equal(stale.title, 'Call mom');
  assert.match(stale.source, /^Not updated since /);
  assert.equal(stale.stale, true);
  const adapter = readFileSync(new URL('../apps/app/src/prototype/agent-calendar-adapter.ts', import.meta.url), 'utf8');
  assert.match(adapter, /presentHomeAgendaCard\(agentReminderLead\(local,feed\)\)/);
});
test('Agent Calendar freshness: an unverified next event is never fresh or an empty schedule', () => {
  // Exercise the current adapter's actual render closure with the real complete-feed
  // selector. A future-only `next` result must never authorize Home's agenda.
  const adapter = readFileSync(new URL('../apps/app/src/prototype/agent-calendar-adapter.ts', import.meta.url), 'utf8');
  const selectSource = readFileSync(new URL('../apps/app/src/runtime/home-calendar-selection.ts', import.meta.url), 'utf8');
  const key = source => JSON.stringify([source.provider,source.side,source.grantId,source.connectorAccountId,source.calendarId]);
  const loaded = {exports:{}};
  const parts = (date,timeZone) => Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric',hourCycle:'h23'}).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  vm.runInNewContext(transformSync(selectSource,{loader:'ts',format:'cjs'}).code,{module:loaded,exports:loaded.exports,require:specifier=>{
    if(specifier==='./agent-calendar')return {calendarSourceKey:key,calendarEventKey:event=>event.id};
    if(specifier.endsWith('/internal/time'))return {getZonedDateParts:parts};
    throw Error('Unexpected selector dependency '+specifier);
  }});
  const start=adapter.indexOf(' p.renderVals=function()'),end=adapter.indexOf('\n };',start);
  assert.ok(start>=0&&end>start,'actual Home render closure must exist');
  const source={provider:'eliza',side:'owner',grantId:'fixture',connectorAccountId:null,calendarId:'primary',includeInFeed:true,accessRole:'owner'};
  const event={...source,id:'event',title:'Verified today',status:'confirmed',startAt:new Date(at(16)).toISOString(),endAt:new Date(at(17)).toISOString()};
  let current=true,owner='owner',state={ownerKey:'owner',status:'ready',mutating:false,calendars:[source],next:{event},nextFresh:true,feed:undefined};
  let reads=0;const opened=[],context={p:{},renderVals:()=>({}),deviceCalendarScope:()=>false,Date:class extends Date{static now(){return now;}},controller:{get state(){return state;},sourceHandle:()=> 'fixture'},calendarSourceKey:key,port:()=>({current:()=>current}),calendarOwnerKey:()=>owner,zone:()=> 'UTC',homeCalendarSelection:loaded.exports.homeCalendarSelection,homeCalendarValues:H.homeCalendarValues,presentHomeAgendaCard:H.presentHomeAgendaCard,presentHomeAgendaFeed:H.presentHomeAgendaFeed,agentReminderLead:H.agentReminderLead,overdueAgendaNext:H.overdueAgendaNext,refresh:force=>{assert.equal(force,true);reads++;},calendarEventKey:e=>e.id,canonicalCalendarRow:()=>({off:0})};
  vm.runInNewContext(transformSync(adapter.slice(start,end+4),{loader:'ts'}).code,context);
  let savedPrefs={};const shell={vget:()=>({calPrefs:savedPrefs}),openView:(...args)=>opened.push(args)},render=()=>context.p.renderVals.call(shell);
  let home=render();assert.doesNotMatch(home.homeCalendarTitle,/Verified today|Nothing planned/,'next-only cache is unverified');
  state={...state,feed:{state:'complete',events:[event],timeMin:'2026-09-28T00:00:00Z',timeMax:'2026-11-09T00:00:00Z'}};
  home=render();assert.equal(home.homeCalendarTitle,'Verified today');savedPrefs={fixture:{on:false,color:'mut'}};const retainedPrefs=structuredClone(savedPrefs);assert.equal(render().homeCalendarTitle,'Verified today','canonical Home follows authoritative feed despite obsolete hidden preference');assert.deepEqual(savedPrefs,retainedPrefs,'display policy never deletes old preferences');home.goCalendar();assert.equal(opened.at(-1)[0],'calendar');assert.equal(opened.at(-1)[1].calendarAuthority,'canonical','one merged Calendar route');
  for(const update of [{mutating:true},{status:'loading'},{ownerKey:'retired'},{feed:{...state.feed,state:'partial'}}]){
    const saved=state;state={...state,...update};assert.doesNotMatch(render().homeCalendarTitle,/Verified today|Nothing planned/,'unverified feed or owner never authorizes agenda');state=saved;
  }
  assert.equal(reads,0,'rendering and verified navigation never read');
  for(const status of ['error','unavailable','partial']){
    const saved=state;state={...state,status,error:'Calendar service unavailable',feed:status==='partial'?{...state.feed,state:'partial'}:null};
    const failed=render();assert.equal(reads,0,'failure rendering never starts reads');assert.doesNotMatch(failed.homeCalendarTitle,/Verified today|Nothing planned/);
    if(status==='partial'){
      assert.equal(failed.homeCalendarTitle,'Calendar unavailable');
      assert.equal(failed.homeCalendarDescription,'Calendar service unavailable. Open Calendar to retry.');
    }
    failed.goCalendar();assert.equal(reads,1,'explicit navigation retries the actual failed/unverified feed');reads=0;state=saved;
  }
  current=false;assert.doesNotMatch(render().homeCalendarTitle,/Verified today|Nothing planned/,'retired connection drops the event');current=true;
  state={...state,feed:{...state.feed,events:[]}};assert.equal(render().homeCalendarTitle,'Nothing planned','only complete covered feed can assert empty');
});
test('inbox status: readable freshness and every non-ready state', () => {
  const base = {failure: false, pending: false, cached: null, connected: false, unchecked: false, now};
  assert.equal(H.presentHomeInboxStatus({...base, cached: {more: false, label: 'work@example.test', readAt: at(15, 4)}}), 'work@example.test · Updated 3:04 PM');
  assert.equal(H.presentHomeInboxStatus({...base, cached: {more: true, label: 'work@example.test', readAt: at(8, 15, 6)}}), 'Recent email · Updated Tue, Oct 6 8:15 AM');
  assert.equal(H.presentHomeInboxStatus({...base, cached: {more: false, label: '', readAt: null}}), '');
  assert.equal(H.presentHomeInboxStatus({...base, failure: true, cached: {more: false, label: 'a', readAt: at(15, 4)}}), 'Open to retry · last updated 3:04 PM');
  assert.equal(H.presentHomeInboxStatus({...base, failure: true}), 'Open to retry');
  assert.equal(H.presentHomeInboxStatus({...base, pending: true, cached: {more: false, label: 'a', readAt: at(15, 4)}}), 'Updating email…');
  assert.equal(H.presentHomeInboxStatus({...base, connected: true}), 'Open to load email');
  assert.equal(H.presentHomeInboxStatus({...base, unchecked: true}), 'Open to check email');
  assert.equal(H.presentHomeInboxStatus(base), '');
});
test('workflow freshness: a load time only after a list was actually loaded', () => {
  for (const loadedAt of [null, undefined, 0, NaN]) assert.deepEqual(H.presentHomeWorkflowFreshness({loadedAt, now, unified: true}), {visible: '', description: ''});
  assert.deepEqual(H.presentHomeWorkflowFreshness({loadedAt: at(15, 4), now, unified: false}), {visible: 'Loaded 3:04 PM', description: 'Workflows from your agent, loaded 3:04 PM'});
  assert.deepEqual(H.presentHomeWorkflowFreshness({loadedAt: at(8, 15, 6), now, unified: true}), {visible: 'Loaded Tue, Oct 6 8:15 AM', description: 'Automations from your agent and reminders on this phone, loaded Tue, Oct 6 8:15 AM'});
  assert.deepEqual(H.presentHomeWorkflowFreshness({loadedAt: at(15, 4), now, unified: true, agent: false}), {visible: 'Loaded 3:04 PM', description: 'Reminders on this phone, loaded 3:04 PM'}, 'no agent is named when none is connected');
});
test('Home template renders source, freshness and the brief card only from live values', () => {
  const template = readFileSync(new URL('../apps/app/src/prototype/template.html', import.meta.url), 'utf8');
  const home = template.slice(template.indexOf('<sc-element value="{{homeShell}}">'), template.indexOf('</sc-element>'));
  assert.ok(home.includes('<sc-slot name="cards">'), 'Home cards fill the shared shell\'s card slot');
  // The agenda, mail and brief cards are the shared upstream cards (home-overview-cards.ts); the
  // template only places them, in this order around the workflows card. Their DOM is asserted in
  // test/home-overview-cards.test.mjs.
  assert.match(home, /^\s*\{\{homeAgendaCard\}\}$/m);
  assert.match(home, /^\s*\{\{homeAttentionCard\}\}$/m);
  assert.match(home, /^\s*\{\{homeBriefCard\}\}$/m);
  assert.ok(home.indexOf('{{homeAgendaCard}}') < home.indexOf('data-alpha-home-workflows') && home.indexOf('data-alpha-home-workflows') < home.indexOf('{{homeAttentionCard}}') && home.indexOf('{{homeAttentionCard}}') < home.indexOf('{{homeBriefCard}}'), 'agenda, workflows, mail, brief');
  // dc-lite renders a text node that is exactly one {{hole}} as an element; two holes in one text node
  // would be interpolated as text ("[object Object]").
  assert.doesNotMatch(home, /\}\}\s+\{\{/, 'each card placeholder is alone in its text node');
  assert.doesNotMatch(home, /home-calendar-card|home-brief-card|data-alpha-home-inbox|\{\{homeCalendarTitle\}\}|\{\{homeBriefTitle\}\}|\{\{homeInboxTitle\}\}/, 'no second copy of the shared card markup');
  assert.match(home, /aria-description="\{\{homeWorkflowDescription\}\}"/);
  const workflows = readFileSync(new URL('../apps/app/src/prototype/workflow-adapter.ts', import.meta.url), 'utf8');
  const automations = readFileSync(new URL('../apps/app/src/prototype/automations-adapter.ts', import.meta.url), 'utf8');
  for (const source of [workflows, automations]) {
    assert.match(source, /presentHomeWorkflowFreshness\(/);
    assert.match(source, /homeWorkflowDescription:loaded\.description/, 'the compact card keeps the read time in its accessible description');
  }
  assert.doesNotMatch(home, /Morning brief|Design review|7:02 AM/, 'no fixture brief or agenda text in the template');
  const adapter = readFileSync(new URL('../apps/app/src/prototype/data-adapter.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(adapter, /gmailSearch|gmailThread|\.sync\(|fetch\(/);
});

test('calendar name lookup: the event\'s own calendar in the same read, and no borrowed or stale name', () => {
  const sources = [{id: '7', name: 'Harbour team', account: 'owner@example.invalid'}, {id: '8', name: '  Family  '}, {id: '9', name: ''}, {id: '10'}, {id: 11, name: 'Numeric id'}, null, 'text'];
  assert.equal(H.homeCalendarName(sources, '7'), 'Harbour team');
  assert.equal(H.homeCalendarName(sources, '8'), 'Family', 'surrounding space is not part of a name');
  // Unknown calendar: the event names a calendar the read did not return.
  assert.equal(H.homeCalendarName(sources, '99'), null);
  assert.equal(H.homeCalendarName(sources, '70'), null, 'no prefix or partial match');
  // A calendar with no display name has no name to show.
  assert.equal(H.homeCalendarName(sources, '9'), null);
  assert.equal(H.homeCalendarName(sources, '10'), null);
  // Ids are strings on both sides; nothing is coerced into a match.
  assert.equal(H.homeCalendarName(sources, 7), null);
  assert.equal(H.homeCalendarName(sources, '11'), null);
  for (const id of [undefined, null, '', 0, {}]) assert.equal(H.homeCalendarName(sources, id), null);
  // Permission denied, not connected and a failed read all leave no sources.
  for (const none of [undefined, null, [], {}, 'x']) assert.equal(H.homeCalendarName(none, '7'), null);
  // Renamed calendar: the name is whatever the latest read returned for the same id.
  assert.equal(H.homeCalendarName([{id: '7', name: 'Harbour crew'}], '7'), 'Harbour crew');
  // Two sources with one id (not expected from the provider): the first in provider order.
  assert.equal(H.homeCalendarName([{id: '7', name: 'First'}, {id: '7', name: 'Second'}], '7'), 'First');
  // The card shows a meaningful calendar name, with no generic device/app label.
  const base = {state: 'ready', overdue: false, readAt: at(15, 4), now, native: true};
  assert.equal(H.presentHomeCalendarSource({...base, calendar: H.homeCalendarName(sources, '7')}).description, 'Harbour team. Read 3:04 PM from calendars on this device');
  assert.deepEqual(H.presentHomeCalendarSource({...base, calendar: H.homeCalendarName(sources, '99')}), {origin: '', read: '', description: 'Read 3:04 PM from calendars on this device'});
});
