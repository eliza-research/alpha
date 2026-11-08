import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=readFileSync('apps/app/src/prototype/settings-adapter.ts','utf8');
const start=source.indexOf('// calendar-settings:begin'),end=source.indexOf('// calendar-settings:end');
assert(start>=0&&end>start);
const region=stripTypeScriptTypes(source.slice(start,end),{mode:'strip'});
const names=['page','state','views','owner','info','group','api','gmailAccounts','gmail','developerTools','Capacitor','out','googleConnectionController','openCalendarRecovery'];
const render=new Function(...names,region);
function fixture({status='ready',accounts=[],gmail='Read access authorized',authority='canonical',detail=false,form=null,transition=false,native=false,calendarMessage}={}){
 const calls={sync:[],google:0,recovery:0,retry:0,transition:0,pages:[]},calendar={calendarAuthority:authority,form},model={status,ownerKey:'owner',error:calendarMessage??(status==='error'?'Calendar read failed':null)};
 const controller={state:model},owner={live:true,agentCalendar:controller,vget:()=>calendar,api:()=>({})};
 const calendarView={nativeStatusLabel:calendarMessage??(['error','partial','unavailable'].includes(status)?'Calendar could not update':''),nativeStatusRetry:()=>calls.retry++,canConfirmCalendarTransition:transition,confirmCalendarTransition:()=>calls.transition++,calendarAuthorityChoices:[{label:'Agent Calendar',go:()=>{if(!calendar.form)calendar.calendarAuthority='canonical';}},{label:'Old source',go:()=>{throw Error('No arbitrary source chooser');}}]};
 owner.calendarConnectionScope=()=>{if(!model.ownerKey||!owner.live||calendar.form||['legacy','android-native','browser-local'].includes(calendar.calendarAuthority))return null;return{calendar:controller,current:()=>owner.live&&owner.agentCalendar===controller&&model.ownerKey==='owner',canChange:()=>!calendar.form&&!owner.canonicalDraftText};};
 const out={stack:[]},api={set:patch=>calls.pages.push(patch),toast:()=>{}},context={page:{groups:[]},state:{page:detail?'calendar-google':'calendar'},views:{calendar:{displaySources:()=>({status,ready:status==='ready',native:false,loading:false,sources:[]}),render:()=>calendarView}},owner,info:(label,val)=>({kInfo:true,label,val}),group:rows=>({rows}),api,gmailAccounts:accounts,gmail,developerTools:false,Capacitor:{isNativePlatform:()=>native},out,googleConnectionController:{open:()=>calls.google++,openCalendar:scope=>calls.sync.push(scope)},openCalendarRecovery:()=>calls.recovery++};
 render(...names.map(n=>context[n]));
 return {calls,owner,calendar,controller,out,context,rows:out.stack[0].groups.flatMap(g=>g.rows),details:out.stack.at(-1).groups.flatMap(g=>g.rows)};
}
const account=(write=false)=>({connectionId:'google',label:'owner@example.test',connected:true,grantedCapabilities:['google.calendar.read',...(write?['google.calendar.write']:[])]});
test('normal Calendar settings has one Google entry without technical source or visibility controls',()=>{
 const f=fixture();assert.deepEqual(f.rows.map(r=>r.label),['Google Calendar']);assert.equal(f.rows[0].sub,'Not connected');
 assert.doesNotMatch(JSON.stringify(f.out),/Current source|Calendars shown|Calendar sources|In this app|Agent Calendar|Uses the same|kCalendarDisplay|Synced/);
 assert.deepEqual(f.calls.sync,[]);assert.equal(f.calls.google,0);assert.equal(f.calls.retry,0);
 f.rows[0].go();assert.deepEqual(f.calls.pages,[]);assert.equal(f.calls.sync.length,1);assert.equal(f.calls.sync[0].calendar,f.controller);assert.equal(f.calls.google,0);
 f.out.stack[0].back();assert.deepEqual(f.calls.pages,[{page:null}]);
});
for(const [name,options,expected]of [['read-only',{accounts:[account()]},'Finish connecting'],['write grant',{accounts:[account(true)]},'Connected'],['checking',{gmail:'Checking authorization…'},'Checking connection…'],['failure',{gmail:'Authorization not verified'},'Connection unavailable']])test(`Google entry reports actual ${name} without claiming sync`,()=>{
 const f=fixture(options);assert.equal(f.rows[0].sub,expected);assert.doesNotMatch(JSON.stringify(f.out),/Synced|Sync enabled/);assert.deepEqual(f.calls.sync,[]);
});
test('stale Google details state uses the single Calendar entry with no extra review wizard',()=>{
 const f=fixture({detail:true,accounts:[account()]});assert.equal(f.out.stack.length,1);assert.equal(f.details[0].label,'Google Calendar');f.details[0].go();assert.equal(f.calls.google,0);assert.equal(f.calls.sync.length,1);const scope=f.calls.sync[0];assert.equal(scope.calendar,f.controller);assert.equal(scope.current(),true);assert.equal(scope.canChange(),true);
 f.calendar.form={title:'Keep this draft'};assert.equal(scope.canChange(),false);f.calendar.form=null;f.owner.canonicalDraftText='Retained';assert.equal(scope.canChange(),false);f.owner.canonicalDraftText='';f.owner.agentCalendar={state:{ownerKey:'other'}};assert.equal(scope.current(),false);assert.equal(f.calls.transition,0);
});
for(const status of ['error','partial','unavailable'])test(`only an actual ${status} adds actionable Calendar recovery`,()=>{
 const f=fixture({status});assert.equal(f.rows[0].label,'Google Calendar');assert.equal(f.rows.find(r=>r.kInfo).label,'Calendar needs attention');assert.equal(f.rows.find(r=>r.kInfo).val,status==='partial'?'Some events could not load. Try again.':'Calendar could not load. Try again.');assert.equal(f.rows.at(-1).label,'Retry calendar');assert.equal(f.calls.retry,0);f.rows.at(-1).go();assert.equal(f.calls.retry,1);
});
test('saved data recovery stays separate and only appears when needed',()=>{
 const f=fixture({status:'legacy-recovery'});assert(f.rows.some(r=>r.label==='Recover saved events'));assert.equal(f.calls.recovery,0);f.rows.find(r=>r.label==='Recover saved events').go();assert.equal(f.calls.recovery,1);
 const t=fixture({status:'transition-required',transition:true});t.rows.find(r=>r.label==='Review saved events').go();assert.equal(t.calls.transition,1);assert(!fixture().rows.some(r=>r.label==='Review saved events'));
});
test('retained legacy draft is not silently switched or discarded',()=>{
 const form={title:'Exact retained draft'},f=fixture({authority:'legacy',form});f.rows.find(r=>r.label==='Return to Calendar').go();assert.equal(f.calendar.calendarAuthority,'legacy');assert.equal(f.calendar.form,form);
});
test('missing canonical owner never opens the generic Google manager or a sync engine',()=>{
 const f=fixture({detail:true});f.controller.state.ownerKey=null;f.details[0].go();assert.equal(f.calls.google,0);assert.deepEqual(f.calls.sync,[]);
});

for(const authority of ['android-native','browser-local']){
 test(`previously selected ${authority} has an explicit return without source chooser or data migration`,()=>{
  const f=fixture({authority});f.calendar.events=[{id:'retained',title:'Exact old event'}];f.calendar.calPrefs={old:{on:false,color:'mut'}};const events=f.calendar.events,prefs=f.calendar.calPrefs,before=structuredClone({events,prefs});
  assert.equal(f.calendar.calendarAuthority,authority,'rendering never switches');const action=f.rows.find(r=>r.label==='Return to Calendar');assert(action);assert(!f.rows.some(r=>['Current source','Old source'].includes(r.label)));assert.equal(f.out.stack[0].groups.at(-1).cap,'Recovery');
  action.go();assert.equal(f.calendar.calendarAuthority,'canonical');assert.equal(f.calendar.events,events);assert.equal(f.calendar.calPrefs,prefs);assert.deepEqual({events,prefs},before);assert.deepEqual(f.calls.sync,[]);assert.equal(f.calls.google,0);
 });
 test(`a draft blocks return from ${authority} and stays byte-for-byte intact`,()=>{
  const form={title:'Exact draft',notes:'Retained notes'},f=fixture({authority,form}),before=structuredClone(form);f.rows.find(r=>r.label==='Return to Calendar').go();assert.equal(f.calendar.calendarAuthority,authority);assert.equal(f.calendar.form,form);assert.deepEqual(form,before);assert.deepEqual(f.calls.sync,[]);
 });
}

test('Settings attention stays truthful without exposing HTTP diagnostics or prescribing permissions',()=>{
 const diagnostic='Local agent request failed HTTP503';
 for(const status of ['error','unavailable','partial','ready']){
  const f=fixture({status,calendarMessage:diagnostic}),message=f.rows.find(r=>r.kInfo);assert(message);assert.equal(message.val,['partial','ready'].includes(status)?'Some events could not load. Try again.':'Calendar could not load. Try again.');
  assert.doesNotMatch(JSON.stringify(f.out),/HTTP503|Local agent|permission|reauth/i);assert.equal(f.controller.state.error,diagnostic,'domain diagnostics stay intact');assert.equal(f.rows.at(-1).label,'Retry calendar');assert.equal(f.calls.retry,0);
 }
});
