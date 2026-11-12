import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {build} from 'esbuild';
// Home's agenda and brief cards are the shared upstream cards (packages/ui/src/overview), rendered by
// apps/app/src/prototype/home-overview-cards.ts from the values the Home adapters computed. These
// render them to markup and check that Alpha's installed selectors, classes and states are kept.
// Source-level evidence only: no browser, device calendar or digest is involved.
const root=resolve(import.meta.dirname,'..');
const run=script=>JSON.parse(execFileSync(process.execPath,['--import=tsx','--input-type=module','-e',script],{cwd:root,encoding:'utf8',timeout:120000}));
// One bundle with the app's JSX settings (automatic runtime, as Vite builds it) and a single React.
const bundled=await build({stdin:{contents:`export {renderToStaticMarkup} from 'react-dom/server';
export * as c from ${JSON.stringify(resolve(root,'apps/app/src/prototype/home-overview-cards.ts'))};
export * as h from ${JSON.stringify(resolve(root,'apps/app/src/prototype/home-cards.ts'))};
export {HomeStartupCache} from ${JSON.stringify(resolve(root,'apps/app/src/runtime/home-startup-cache.ts'))};
export * as l from ${JSON.stringify(resolve(root,'apps/app/src/prototype/locale-time.ts'))};`,resolveDir:root,loader:'js'},
  bundle:true,format:'esm',platform:'node',jsx:'automatic',write:false,logLevel:'silent',
  banner:{js:"import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);"}});
const directory=mkdtempSync(resolve(tmpdir(),'home-overview-cards-'));
writeFileSync(resolve(directory,'cards.mjs'),bundled.outputFiles[0].text);
const {renderToStaticMarkup,c,h,l,HomeStartupCache}=await import(resolve(directory,'cards.mjs'));
// Times and dates in these expectations are en-US, as in test/home-cards.test.mjs.
l.setLocalePreferences({locale:'en-US'});
rmSync(directory,{recursive:true,force:true});
const html=element=>element?renderToStaticMarkup(element):null;
test('saved Home cards appear on the first render before connection or provider reads finish', async () => {
  const data=new Map([['alpha.connection.cloud-service.v1','production']]);
  const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
  const owner={environment:'production',userId:'owner-a',organizationId:'organization-a',credentialId:'credential-a'};
  const scope=JSON.stringify(['http://localhost','owner-a','agent-a']);
  let context={owner,scope,restoring:false,allowed:true};
  const now=()=>new Date(2026,10,12,10);
  const cache=new HomeStartupCache(storage,()=>context,now);
  cache.remember({homeCalendarHasEvent:true,homeCalendarTitle:'Saved meeting',homeInboxHasRows:true,
    homeInboxRows:[{subject:'Saved mail',from:'Sender'}],homeWorkflowHasRows:true,
    homeWorkflowRows:[{name:'Morning summary',status:''}],providerKey:'must never be cached'});
  await Promise.resolve();
  context={owner:null,scope:null,restoring:true,allowed:true};
  const restored=new HomeStartupCache(storage,()=>context,now);
  class Home {renderVals(){return {homeCalendarResolved:false,homeInboxResolved:false,homeWorkflowResolved:false};}}
  c.installHomeOverviewCards(Home,restored);
  const first=new Home().renderVals();
  assert.match(html(first.homeAgendaCard),/Saved meeting/);
  assert.match(html(first.homeAttentionCard),/Saved mail/);
  assert.equal(first.homeShowWorkflow,true);
  assert.ok(!data.get('alpha.home.overview.v1').includes('providerKey'));
  context={owner:{...owner,userId:'owner-b'},scope,restoring:false,allowed:true};
  assert.equal(restored.read(),null,'a different account cannot display the prior cards');
  context={owner,scope:'different-agent',restoring:false,allowed:true};
  assert.equal(restored.read(),null,'a different agent cannot display the prior cards');
  context={owner,scope,restoring:false,allowed:false};
  assert.equal(restored.read(),null,'sign-out immediately hides the preview');
  context={owner,scope,restoring:false,allowed:true};
  assert.equal(new HomeStartupCache(storage,()=>context,()=>new Date(2026,10,13,10)).read(),null,'a new day does not reuse old agenda labels');
});
test('Home reveals its saved widget row together and keeps it visible during refresh', () => {
  let values={homeCalendarResolved:false,homeInboxResolved:false,homeWorkflowResolved:false,
    homeCalendarHasEvent:true,homeCalendarTitle:'Meeting',homeInboxHasRows:true,
    homeInboxRows:[{subject:'Mail',from:'Sender'}],homeWorkflowHasRows:true,
    homeWorkflowRows:[{name:'Morning summary'}]};
  class Home {renderVals(){return values;}}
  c.installHomeOverviewCards(Home);
  const home=new Home();
  const hidden=()=>{const out=home.renderVals();assert.equal(out.homeAgendaCard,null);assert.equal(out.homeAttentionCard,null);assert.equal(out.homeShowWorkflow,false);};
  hidden();
  values={...values,homeWorkflowResolved:true};hidden();
  values={...values,homeCalendarResolved:true};hidden();
  values={...values,homeInboxResolved:true};
  let out=home.renderVals();assert.ok(out.homeAgendaCard);assert.ok(out.homeAttentionCard);assert.equal(out.homeShowWorkflow,true);
  values={...values,homeCalendarStale:true,homeInboxState:'pending'};
  out=home.renderVals();assert.ok(out.homeAgendaCard);assert.ok(out.homeAttentionCard);assert.equal(out.homeShowWorkflow,true);
  values={...values,homeInboxResolved:false,homeInboxRows:[],homeInboxHasRows:false};hidden();
});
test('agenda card keeps the installed selectors for an event, an overdue reminder with its next item, and an empty state', () => {
  const out={};
  const base={homeCalendarTime:'Wed, Oct 7',homeCalendarOrigin:'Work',homeCalendarTitle:'Design review',homeCalendarFooter:'4:00 PM – 5:00 PM',homeCalendarHasEvent:true,homeCalendarHasMeta:true,homeCalendarSource:'',homeCalendarOverdue:false,homeCalendarHasNext:false,homeCalendarLabel:'Open calendar event: Design review',homeCalendarDescription:'Work. Read 3:04 PM from calendars on this device',homeCalendarVideo:true,ic:{video:'M1 1'},goCalendar:()=>{}};
  out.event=html(c.homeAgendaCard(base));
  out.overdue=html(c.homeAgendaCard({...base,homeCalendarTime:'Overdue reminder',homeCalendarOrigin:'',homeCalendarTitle:'Pay rent',homeCalendarFooter:'Due 9:00 AM',homeCalendarOverdue:true,homeCalendarVideo:false,homeCalendarHasNext:true,homeCalendarNext:'Next: Design review 4:00 PM',homeCalendarNextSource:'Work',homeCalendarDescription:'Overdue reminder saved on this device. Next: Design review, 4:00 PM. Work. Read 3:04 PM from calendars on this device'}));
  out.empty=html(c.homeAgendaCard({...base,homeCalendarTitle:'No upcoming events',homeCalendarFooter:'',homeCalendarHasEvent:false,homeCalendarHasMeta:false,homeCalendarVideo:false,homeCalendarLabel:'Open your calendar',homeCalendarDescription:''}));
  out.error=html(c.homeAgendaCard({...base,homeCalendarTitle:'Calendar unavailable',homeCalendarHasEvent:false,homeCalendarHasMeta:true,homeCalendarSource:'Open Calendar to retry',homeCalendarDescription:'Calendar could not be read. Open Calendar to retry.',homeCalendarVideo:false}));
  assert.match(out.event,/^<button type="button" data-overview-part="card" class="home-calendar-card" data-overview-card="agenda"/);
  for(const attribute of ['data-alpha-home-calendar=""','data-alpha-home-calendar-event="true"','data-alpha-home-calendar-meta="true"','data-alpha-home-calendar-overdue="false"','data-alpha-home-calendar-next="false"','aria-label="Open calendar event: Design review"','aria-description="Work. Read 3:04 PM from calendars on this device"'])assert.ok(out.event.includes(attribute),attribute);
  assert.match(out.event,/class="home-calendar-time">Wed, Oct 7<\/span><span data-overview-part="origin" class="home-calendar-origin" data-alpha-home-calendar-origin="">Work<\/span>/);
  assert.match(out.event,/class="serif home-calendar-title">Design review</);
  assert.match(out.event,/class="home-calendar-footer">4:00 PM – 5:00 PM</);
  assert.match(out.event,/background:#ffffff;mask:url\(&#x27;\/icons\/lucide\/video\.svg&#x27;\)/);
  assert.match(out.event,/style="flex-shrink:0;scroll-snap-align:start;border-radius:30px;background:var\(--acc\);color:#ffffff;padding:22px;box-sizing:border-box"/);
  assert.ok(out.overdue.includes('data-alpha-home-calendar-overdue="true"')&&out.overdue.includes('data-alpha-home-calendar-next="true"'));
  assert.match(out.overdue,/class="home-calendar-meta home-calendar-next" data-alpha-home-calendar-next-line=""><span data-overview-part="nextText" class="home-calendar-next-text">Next: Design review 4:00 PM<\/span>/);
  assert.match(out.overdue,/data-overview-part="nextSource" class="home-calendar-source" data-alpha-home-calendar-next-source="">Work<\/span>/, 'the next item identifies its calendar');
  assert.match(out.overdue,/aria-description="Overdue reminder saved on this device\. Next: Design review, 4:00 PM\. Work\. Read 3:04 PM from calendars on this device"/, 'the next item keeps its own source and read time');
  assert.doesNotMatch(out.overdue,/<svg/,'no video icon without a meeting link');
  assert.equal(out.empty,null);
  assert.equal(out.error,null);
});

test('a calendar read from an earlier day is presented as stale on the agenda card', () => {
  const now=new Date(2026,9,7,15,30).getTime(),readAt=new Date(2026,9,6,21,5).getTime(),out={};
  out.stale=h.homeReadIsStale(readAt,now);out.fresh=h.homeReadIsStale(new Date(2026,9,7,9).getTime(),now);
  out.provenance=h.presentHomeCalendarSource({state:'stale',overdue:false,readAt,now,native:true,calendar:'Work'});
  out.card=html(c.homeAgendaCard({homeCalendarTime:'Wed, Oct 7',homeCalendarOrigin:'',homeCalendarTitle:'Standup',homeCalendarFooter:'4:00 PM',homeCalendarHasEvent:true,homeCalendarHasMeta:true,homeCalendarSource:out.provenance.read,homeCalendarStale:true,homeCalendarDescription:out.provenance.description,homeCalendarLabel:'Open calendar event: Standup'}));
  assert.equal(out.stale,true);assert.equal(out.fresh,false);
  assert.equal(out.provenance.read.startsWith('Not updated since '),true);
  assert.match(out.provenance.description,/today's changes may be missing\. Open Calendar to refresh\.$/);
  assert.ok(out.card.includes('data-alpha-home-calendar-stale="true"')&&out.card.includes('data-overview-state="stale"'));
  assert.match(out.card,/aria-description="Calendar not updated since Tue, Oct 6 9:05 PM; today&#x27;s changes may be missing\. Open Calendar to refresh\."/);
  assert.match(out.card,/data-overview-part="source" class="home-calendar-source" data-alpha-home-calendar-source="">Not updated since Tue, Oct 6 9:05 PM<\/span>/);
});

test('brief card appears only for a retained result and keeps its failure state', () => {
  const out={};
  out.none=html(c.homeBriefCard({homeBriefHas:false,homeBriefTitle:'STALE_TITLE',homeBriefStatus:'STALE_STATUS',homeBriefFailed:true,homeBriefLabel:'STALE_LABEL'}));
  out.ran=html(c.homeBriefCard({homeBriefHas:true,homeBriefTitle:'Two meetings today.',homeBriefStatus:'Alpha · Ran 7:02 AM',homeBriefFailed:false,homeBriefLabel:'Open scheduled digests. Latest brief from Alpha, ran 7:02 AM: Two meetings today.',goBrief:()=>{}}));
  out.failed=html(c.homeBriefCard({homeBriefHas:true,homeBriefTitle:'Source expired',homeBriefStatus:'Alpha · Failed 7:00 AM',homeBriefFailed:true,homeBriefLabel:'Open scheduled digests.'}));
  assert.equal(out.none,null,'the removed empty brief does not return');
  assert.match(out.ran,/^<button type="button" data-overview-part="card" class="home-brief-card" data-overview-card="brief"/);
  for(const attribute of ['data-alpha-home-brief=""','data-alpha-home-brief-failed="false"','aria-label="Open scheduled digests. Latest brief from Alpha, ran 7:02 AM: Two meetings today."'])assert.ok(out.ran.includes(attribute),attribute);
  assert.ok(!out.ran.includes('aria-haspopup'), 'the shared brief does not impose popup navigation');
  assert.match(out.ran,/class="home-brief-head"><span data-overview-part="heading">Latest brief<\/span>/);
  assert.match(out.ran,/class="home-brief-title">Two meetings today\.<\/span><span data-overview-part="status" class="home-brief-status">Alpha · Ran 7:02 AM</);
  assert.ok(out.failed.includes('data-alpha-home-brief-failed="true"'));
  assert.ok(out.ran.includes('/icons/lucide/file-text.svg')&&!out.ran.includes('sparkles'),'the brief icon is not a sparkle mark');
});

test('the retained brief is fenced to the bound connection scope', () => {
  const out=run(`
const d=await import(${JSON.stringify(resolve(root,'apps/app/src/runtime/hosted-digests.ts'))});
const row=(runId,status,output,completedAt)=>d.parseDigestResult({cursor:Number(runId.slice(-1)),runId,workflowId:'loop',workflowVersionId:'v1',templateVersion:'hosted-digest-1',scheduledAt:completedAt,source:{},status,startedAt:completedAt,completedAt,output,error:null});
const out={},morning=row('run-1','finished','Morning brief','2026-10-07T07:01:00.000Z'),missed=row('run-2','missed','The scheduled time was missed.','2026-10-08T07:03:00.000Z');
let events=0;globalThis.window={dispatchEvent:event=>{if(event.type==='alpha:retained-digest')events++;}};
d.bindRetainedDigestScope('owner-a');
out.accepted=d.rememberRetainedDigests([morning,missed],'Alpha','owner-a');out.brief=d.latestRetainedDigest();
out.otherScope=d.rememberRetainedDigests([row('run-3','finished','Other account','2026-10-08T08:00:00.000Z')],'Alpha','owner-b');out.unscoped=d.rememberRetainedDigests([],'Alpha');
out.kept=d.latestRetainedDigest()?.summary;
d.bindRetainedDigestScope(null);out.cleared=d.latestRetainedDigest();out.events=events;
console.log(JSON.stringify(out));`);
  assert.equal(out.accepted,true);
  assert.deepEqual(out.brief,{summary:'Morning brief',ranAt:'2026-10-07T07:01:00.000Z',agent:'Alpha',status:'finished'},'a missed record never replaces the last brief');
  assert.equal(out.otherScope,false);assert.equal(out.unscoped,false);
  assert.equal(out.kept,'Morning brief');
  assert.equal(out.cleared,null);
  assert.equal(out.events,2,'Home is told once when the brief appears and once when it is cleared');
});

test('mail card keeps the installed selectors, styles and order of the Home Inbox card in every state', () => {
  const now=new Date(2026,9,7,15,30).getTime(),base={now,loaded:null,failure:null,pending:false,connected:true,disconnected:false,unchecked:false};
  const values=card=>({homeAttentionLabel:card.label,homeInboxCount:card.count,homeInboxRows:card.rows.map(row=>({subject:row.title,from:row.detail})),homeInboxHasRows:card.rows.length>0,
    homeInboxTitle:card.title,homeInboxStatus:card.status,homeInboxDescription:card.description,homeInboxState:card.state,homeAttentionPeople:[],goTriage:()=>{}});
  const out={};
  out.ready=html(c.homeAttentionCard(values(h.presentHomeInboxCard({...base,loaded:{unread:[{subject:'Invoice',from:'Billing',body:'Private body'},{subject:'',from:'Ada'},{subject:'Third',from:'Grace'}],more:false,label:'work@example.test',readAt:new Date(2026,9,7,15,4).getTime()}}))));
  out.idle=html(c.homeAttentionCard(values(h.presentHomeInboxCard(base))));
  out.disconnected=html(c.homeAttentionCard(values(h.presentHomeInboxCard({...base,connected:false,disconnected:true}))));
  out.failed=html(c.homeAttentionCard(values(h.presentHomeInboxCard({...base,failure:'revoked'}))));
  out.stale=html(c.homeAttentionCard(values(h.presentHomeInboxCard({...base,stale:{state:'stale',unread:2,source:'work@example.test',updatedAt:new Date(2026,9,6,8,15).toISOString()}}))));
  out.people=html(c.homeAttentionCard({...values(h.presentHomeInboxCard(base)),homeAttentionPeople:[{ini:'AL'}],homePeopleVisibility:'hidden'}));
  assert.match(out.ready,/^<button type="button" data-overview-part="card" class="home-card" data-overview-card="attention" data-overview-state="ready" data-alpha-home-inbox=""/);
  for(const attribute of ['aria-label="Open Inbox: 3 unread emails"','aria-description="work@example.test · Updated 3:04 PM"'])assert.ok(out.ready.includes(attribute),attribute);
  // The inline styles are the ones the template carried, so the card looks and measures the same.
  assert.ok(out.ready.includes('style="flex-shrink:0;scroll-snap-align:start;width:max-content;min-width:172px;max-width:calc(100% - 48px);border-radius:30px;background:var(--s2);padding:22px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between"'));
  assert.match(out.ready,/<div data-overview-part="head" style="display:flex;justify-content:space-between;align-items:center;width:100%"><span data-overview-part="count" style="font-size:14px;font-weight:600;text-align:left">3 unread<\/span><span aria-hidden="true" data-overview-part="icon"><span style="[^"]*inbox\.svg[^"]*"><\/span><\/span><\/div>/);
  assert.match(out.ready,/<div data-overview-part="rows" style="display:flex;flex-direction:column;gap:10px;max-width:260px;min-width:0;text-align:left" data-alpha-home-inbox-subjects="">/);
  assert.match(out.ready,/<div data-overview-part="rowTitle" style="font-size:18px;font-weight:600;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Invoice<\/div><div data-overview-part="rowDetail" style="font-size:12px;line-height:1.4;color:var\(--mut\);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Billing<\/div>/);
  assert.match(out.ready,/rowTitle"[^>]*>\(no subject\)</);
  assert.doesNotMatch(out.ready,/Third|Private body|data-overview-part="title"/,'two rows, no body, no headline beside rows');
  assert.match(out.ready,/<span data-overview-part="status" style="font-size:12px;line-height:1.4;min-height:17px;color:var\(--mut\);text-align:left">work@example.test · Updated 3:04 PM<\/span><\/button>$/);
  for(const state of ['idle','disconnected','failed','stale','people'])assert.equal(out[state],null,state+' without mail rows stays hidden');
});

test('the Home agenda values come from the shared card model for an event, an overdue reminder with its next item, and no item', () => {
  const now=new Date(2026,9,7,15,30).getTime(),at=(hour,minute=0,day=7)=>new Date(2026,9,day,hour,minute).getTime();
  const read=h.presentHomeCalendarSource({state:'ready',overdue:false,readAt:at(15,4),now,native:true,calendar:'Work'});
  const review={title:'Design review',begin:at(16),end:at(17),allDay:false,video:true,people:['Ada Lovelace']};
  const event=h.homeCalendarValues(h.presentHomeAgendaCard({now,item:review,provenance:read,emptyTitle:'No upcoming events'}));
  assert.deepEqual(event,{homeCalendarHasEvent:true,homeCalendarFooter:'4:00 PM – 5:00 PM',homeCalendarLabel:'Open calendar event: Design review, Wed, Oct 7, 4:00 PM – 5:00 PM',homeCalendarTime:'Wed, Oct 7',
    homeCalendarTitle:'Design review',homeCalendarHasMeta:true,homeCalendarSource:'',homeCalendarOrigin:'Work',homeCalendarOverdue:false,homeCalendarStale:false,
    homeCalendarDescription:'Work. Read 3:04 PM from calendars on this device',homeCalendarItemDescription:'Work. Read 3:04 PM from calendars on this device',
    homeCalendarNext:'',homeCalendarNextSource:'',homeCalendarHasNext:false,homeCalendarVideo:true,homeCalendarPeople:[{ini:'AL'}],homePeopleVisibility:'visible'});
  const reminder=h.presentHomeCalendarSource({state:'ready',overdue:true,reminderReadAt:at(15,1),readAt:at(15,4),now,native:true});
  const overdue=h.homeCalendarValues(h.presentHomeAgendaCard({now,item:{title:'Pay rent',begin:at(9),end:Infinity,allDay:false,overdue:true},provenance:reminder,next:{item:review,provenance:read},overdueCount:1,emptyTitle:''}));
  assert.equal(overdue.homeCalendarTime,'Overdue reminder');assert.equal(overdue.homeCalendarFooter,'Due 9:00 AM');assert.equal(overdue.homeCalendarLabel,'Open overdue reminder: Pay rent, Due 9:00 AM');
  assert.deepEqual([overdue.homeCalendarNext,overdue.homeCalendarNextSource,overdue.homeCalendarHasNext,overdue.homeCalendarVideo],['Next: Design review 4:00 PM','Work',true,false]);
  // The rendered card carries those values into the installed selectors.
  const markup=html(c.homeAgendaCard({...overdue,goCalendar:()=>{}}));
  assert.ok(markup.includes('data-alpha-home-calendar-overdue="true"')&&markup.includes('data-alpha-home-calendar-next="true"')&&markup.includes('>Next: Design review 4:00 PM<'));
  assert.ok(markup.includes('aria-description="'+overdue.homeCalendarDescription+'"'));
  assert.match(overdue.homeCalendarDescription,/Next: Design review, 4:00 PM\. Work\. Read 3:04 PM from calendars on this device/);
  const none=h.homeCalendarValues(h.presentHomeAgendaCard({now,item:null,provenance:{origin:'',read:'',description:''},emptyTitle:'Calendar has not been verified',sourceName:'Agent Calendar'}));
  assert.deepEqual([none.homeCalendarTitle,none.homeCalendarTime,none.homeCalendarLabel,none.homeCalendarHasEvent,none.homeCalendarHasMeta],['Calendar has not been verified','Wed, Oct 7','Open Agent Calendar',false,false]);
});

test('Home hides empty Calendar, Inbox and Workflows and shows Brief only with a result', () => {
  class Shell {
    renderVals() { return this.values; }
  }
  c.installHomeOverviewCards(Shell);
  const shell = new Shell();
  const empty = {homeCalendarConfirmedEmpty: true, homeInboxConfirmedEmpty: true, homeWorkflowConfirmedEmpty: true};
  shell.values = empty;
  let rendered = shell.renderVals();
  assert.equal(rendered.homeAgendaCard,null);assert.equal(rendered.homeAttentionCard,null);assert.equal(rendered.homeBriefCard,null);assert.equal(rendered.homeShowWorkflow,false);assert.equal(rendered.homeHasOverviewCards,false);
  shell.values = {...empty, homeBriefHas: true, homeBriefTitle: 'Follow up on the failed run', homeBriefFailed: true};
  rendered = shell.renderVals();
  assert.equal(rendered.homeHasOverviewCards, true);
  assert.match(html(rendered.homeBriefCard), /Follow up on the failed run/);
  shell.values = {homeCalendarTitle: 'Calendar unavailable', homeInboxTitle: 'Reconnect email'};
  rendered = shell.renderVals();
  assert.equal(rendered.homeHasOverviewCards,false);
  assert.equal(rendered.homeShowWorkflow,false);
  assert.equal(rendered.homeAgendaCard,null);
  assert.equal(rendered.homeAttentionCard,null);
  shell.values={homeWorkflowHasRows:true,homeWorkflowRows:[{name:'Morning summary'}]};
  assert.equal(shell.renderVals().homeShowWorkflow,true);
});
