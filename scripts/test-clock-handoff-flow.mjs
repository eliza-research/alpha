// Actual renderer adapter with a controlled native boundary. No real alarms are changed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../test/support/strip-types.mjs';
import {randomUUID} from 'node:crypto';
import {createInlineModal} from '../apps/app/src/runtime/inline-modal.ts';
import {currentClockTimeZone,buildClockRequest,describeClockDays} from '../apps/app/src/runtime/clock-contract.ts';
import {createClockHandoffHistory,clockHandoffLegacyKey,clockHandoffSlot} from '../apps/app/src/runtime/clock-handoff-history.ts';
const source=stripTypeScriptTypes(fs.readFileSync(new URL('../apps/app/src/prototype/clock-adapter.ts',import.meta.url),'utf8').replace(/^import .*?;\n/gm,'').replace(/^export /gm,''));
let writes=[],store=new Map(),secure=new Map(),failStorage=false,response={status:'opened',message:'Clock request sent. Check Clock.'},hold,holdOpening,hidden=false;
const document={addEventListener(){},removeEventListener(){},querySelector(){return null;},documentElement:{dataset:{connectionMode:'live'}},get hidden(){return hidden;}};
const localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>{if(failStorage)throw Error('full');store.set(k,v);}};
let repeatVersion=1;
const DailyApps={surfaceInfo:async()=>({developmentBuild:false,assistant:false,...(repeatVersion?{clockRepeatDaysVersion:repeatVersion}:{})}),clockHandoff:async request=>{writes.push(request);if(hold)return new Promise(resolve=>hold=resolve);if(response instanceof Error)throw response;return {...response,action:request.action};}};
const secureConnectionStore={read:async slot=>structuredClone(secure.get(slot)??null),compareExchange:async(slot,expected,value)=>{if(value?.record?.status==='opening'&&holdOpening===true)await new Promise(resolve=>holdOpening=resolve);if(failStorage)throw Error('full');if(JSON.stringify(secure.get(slot)??null)!==JSON.stringify(expected))return {status:'conflict'};secure.set(slot,structuredClone(value));return {status:'saved'};}};
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
let flags={testMocksEnabled:true,devSurfacesEnabled:true};
async function fixture(simulated=false){
 class Shell{componentDidMount(){}componentWillUnmount(){}vset(){}}
 let active=true;
 const views={workflows:{render:()=>({})}};
 vm.runInNewContext(source+'\ninstallClockAdapter(Shell,views,{simulated});',{...flags,createClockHandoffHistory,clockHandoffLegacyKey,secureConnectionStore,createInlineModal,currentClockTimeZone,buildClockRequest,describeClockDays,DailyApps,Shell,views,simulated,document,window:{addEventListener(){},removeEventListener(){}},queueMicrotask,localStorage,crypto:{randomUUID},Date,Intl,console});
 const shell=new Shell();shell.componentDidMount();const render=()=>views.workflows.render({},{isActive:()=>active});render().openClock();await settle();return {shell,render,leave:()=>{active=false;views.workflows.onLeave();},enter:()=>{active=true;}};
}
for(const testMocksEnabled of [true,false]){
flags={testMocksEnabled,devSurfacesEnabled:testMocksEnabled};writes=[];store=new Map();secure=new Map();failStorage=false;hidden=false;hold=undefined;response={status:'opened',message:'Clock request sent. Check Clock.'};
let f=await fixture();let ui=f.render().clock;
assert.equal(writes.length,0);ui.onTime({target:{value:'25:03'}});f.render().clock.prepare();assert.equal(f.render().clock.review,null);
ui=f.render().clock;ui.onTime({target:{value:'06:45'}});ui.onLabel({target:{value:'Morning'}});f.render().clock.prepare();
const first=f.render().clock.review;assert.match(first.text,/06:45/);assert.equal(writes.length,0);
// Changing a draft invalidates an old review callback.
f.render().clock.onLabel({target:{value:'Changed'}});await first.confirm();assert.equal(writes.length,0);
f.render().clock.prepare();const exact=f.render().clock.review;hold=true;const pending=exact.confirm();await exact.confirm();await settle();assert.equal(writes.length,1);assert.equal(secure.get(clockHandoffSlot).record.status,'opening');
assert.deepEqual(JSON.parse(JSON.stringify(writes[0])),{action:'set',hour:6,minute:45,label:'Changed',timeZone:currentClockTimeZone(),reviewed:true});
hold({action:'set',status:'opened',message:'Clock request sent. Check Clock.'});hold=null;await pending;assert.equal(secure.get(clockHandoffSlot).record.status,'opened');await exact.confirm();assert.equal(writes.length,1);
// Repeat days: chips toggle a sorted EXTRA_DAYS list on a new review; clearing them is one-time again.
{const chips=()=>f.render().clock.days;assert.deepEqual(JSON.parse(JSON.stringify(chips().map(d=>d.label))),['Mon','Tue','Wed','Thu','Fri','Sat','Sun']);
 chips().find(d=>d.label==='Wed').toggle();chips().find(d=>d.label==='Mon').toggle();assert.equal(f.render().clock.repeatText,'Repeats Mon, Wed');
 f.render().clock.prepare();const repeat=f.render().clock.review;assert.match(repeat.text,/ · Mon, Wed · /);await repeat.confirm();
 assert.deepEqual(JSON.parse(JSON.stringify(writes.at(-1))).days,[2,4]);writes.pop();// keep later write indexes stable
 chips().find(d=>d.label==='Mon').toggle();chips().find(d=>d.label==='Wed').toggle();assert.equal(f.render().clock.repeatText,'One time');}
// Without native EXTRA_DAYS support (no clockRepeatDaysVersion) the chips are hidden and a repeat is never sent.
// days is null, not []: the template renders its Repeat group for any array.
{repeatVersion=0;const plain=await fixture();assert.equal(plain.render().clock.repeatAvailable,false);assert.equal(plain.render().clock.days,null);
 const before=writes.length;plain.render().clock.prepare();assert.equal(plain.render().clock.review.text.includes('repeating'),false);plain.shell.componentWillUnmount();assert.equal(writes.length,before);repeatVersion=1;}
// All other standard intents require a fresh review; no broad alarm identity is inferred.
for(const [name,action] of [['Show alarms','show'],['Snooze','snooze'],['Dismiss','dismiss']]){
 f.render().clock.actions.find(a=>a.label===name).pick();f.render().clock.prepare();const review=f.render().clock.review;
 if(action==='snooze'){assert.equal(review.text,'Snooze 10 min');}
 if(action==='dismiss')assert.equal(review.text,'Dismiss alarm');
 await review.confirm();assert.equal(writes.at(-1).action,action);
}
assert.equal(writes[2].snoozeMinutes,10);
response={status:'unavailable',message:'No installed Clock app handles this action'};f.render().clock.prepare();await f.render().clock.review.confirm();assert.match(f.render().clock.message,/No installed Clock/);
for(const status of ['denied','failed']){response={status,message:`Clock ${status}`};f.render().clock.prepare();await f.render().clock.review.confirm();assert.equal(f.render().clock.message,`Clock ${status}`);}
response=new Error('lost response');f.render().clock.prepare();await f.render().clock.review.confirm();assert.match(f.render().clock.message,/unknown/i);const count=writes.length;
f.shell.componentWillUnmount();f=await fixture();assert.match(f.render().clock.message,/unknown/i);assert.equal(writes.length,count,'recreation must not dispatch or retry');
failStorage=true;f.render().clock.prepare();await f.render().clock.review.confirm();assert.equal(writes.length,count);assert.equal(f.render().clock.message,"Can’t reach Clock");failStorage=false;
hidden=true;f.render().clock.prepare();await f.render().clock.review.confirm();assert.equal(writes.length,count);hidden=false;
// A mode change during the opening write must also prevent the synthetic handoff.
f.render().clock.close();f.render().openClock();await settle();f.render().clock.prepare();
holdOpening=true;const awaitingOpening=f.render().clock.review.confirm();await settle();
assert.equal(typeof holdOpening,'function');document.documentElement.dataset.connectionMode='mock';holdOpening();holdOpening=null;
await awaitingOpening;document.documentElement.dataset.connectionMode='live';assert.equal(writes.length,count,'a mock request cannot dispatch after its opening write');
// Leaving the view invalidates even a retained confirmation callback.
f.render().clock.prepare();const departed=f.render().clock.review,staleOpener=f.render().openClock;f.leave();await departed.confirm();assert.equal(writes.length,count);assert.equal(f.render().clock,null);assert.equal(f.shell.clockSelection(),undefined);
staleOpener();assert.equal(f.render().clock,null,'an opener from a departed Workflows visit cannot create a Clock draft');
f.enter();staleOpener();assert.equal(f.render().clock,null,'returning to Workflows cannot revive an old opener');
f.render().openClock();assert.equal(f.render().clock.review,null);
// Both startup mock and a mode switch during review prevent the native call.
// Without ELIZA_DEV_ALLOW_TEST_MOCKS there is no simulation: a mock request fails closed.
for(const startupMock of [true,false]){const mock=await fixture(startupMock);mock.render().clock.prepare();document.documentElement.dataset.connectionMode='mock';const review=mock.render().clock.review;assert.equal(review.label,testMocksEnabled?'Simulate Clock request':'Open Clock');await review.confirm();assert.equal(writes.length,count);assert.match(mock.render().clock.message,testMocksEnabled?/simulated/:/^Offline$/);mock.shell.componentWillUnmount();document.documentElement.dataset.connectionMode='live';}
}
console.log('PASS actual Clock adapter flow: review/snapshot, invalid input, duplicate taps, all four operations, no handler, response loss/recreation, storage failure, foreground and mock isolation, with and without ELIZA_DEV_ALLOW_TEST_MOCKS. Native boundary is synthetic.');
