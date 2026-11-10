// Actual renderer adapter with a controlled native boundary. No real alarms are changed.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {prototypeScript} from './fixtures/prototype-script.ts';
import {randomUUID} from 'node:crypto';
import {createInlineModal} from '../apps/app/src/runtime/inline-modal.ts';
import {currentClockTimeZone,buildClockRequest,describeClockDays} from '../apps/app/src/runtime/clock-contract.ts';
import type {ClockRequest,ClockResult} from '../apps/app/src/daily.ts';
import type {ClockHandoffEnvelope} from '../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/clock-handoff-history.ts';
import {createClockHandoffHistory,clockHandoffLegacyKey,clockHandoffSlot} from '../apps/app/src/runtime/clock-handoff-history.ts';
const source=await prototypeScript('clock-adapter.ts','installClockAdapter');
type Review = {text: string; label: string; confirm(): Promise<void>};
type FieldChange = {target: {value: string}};
type DayChip = {label: string; toggle(): void};
type ClockView = {
 onTime(event: FieldChange): void; onLabel(event: FieldChange): void; prepare(): void;
 review: Review | null; close(): void; actions: {label: string; pick(): void}[];
 days: DayChip[] | null; repeatAvailable: boolean; repeatText: string; message: string;
};
type WorkflowView = {
 render(state: object,api: object): {clock?: ClockView | null; openClock?: () => void};
 onLeave?: () => void;
};
function required<T>(value: T | null | undefined): T {
 assert.ok(value,'Expected a rendered Clock control');
 return value;
}
const writes: ClockRequest[]=[];
const store=new Map<string,string>(),secure=new Map<string,ClockHandoffEnvelope>();
let failStorage=false,hidden=false;
let response: Omit<ClockResult,'action'> | Error={status:'opened',message:'Clock request sent. Check Clock.'};
let deferred: ReturnType<typeof Promise.withResolvers<ClockResult>> | undefined;
let openingGate: ReturnType<typeof Promise.withResolvers<void>> | undefined;
const document={addEventListener(){},removeEventListener(){},querySelector(){return null;},documentElement:{dataset:{connectionMode:'live'}},get hidden(){return hidden;}};
const localStorage={getItem:(key: string)=>store.get(key)||null,setItem:(key: string,value: string)=>{if(failStorage)throw Error('full');store.set(key,value);}};
let repeatVersion=1;
const DailyApps={
 surfaceInfo:async()=>({developmentBuild:false,assistant:false,...(repeatVersion?{clockRepeatDaysVersion:repeatVersion}:{})}),
 clockHandoff:async(request: ClockRequest): Promise<ClockResult>=>{
  writes.push(request);
  if(deferred)return deferred.promise;
  if(response instanceof Error)throw response;
  return {...response,action:request.action};
 },
};
const secureConnectionStore={
 read:async(slot: string)=>structuredClone(secure.get(slot)??null),
 compareExchange:async(slot: string,expected: ClockHandoffEnvelope | null,value: ClockHandoffEnvelope)=>{
  if(value.record.status==='opening'&&openingGate)await openingGate.promise;
  if(failStorage)throw Error('full');
  if(JSON.stringify(secure.get(slot)??null)!==JSON.stringify(expected))return {status:'conflict'};
  secure.set(slot,structuredClone(value));return {status:'saved'};
 },
};
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
let testMocksEnabled=false;
async function fixture(simulated=false){
 class Shell {
  declare clockSelection: () => object | undefined;
  componentDidMount() {}
  componentWillUnmount() {}
  vset() {}
 }
 let active=true;
 const views: {workflows: WorkflowView}={workflows:{render:()=>({})}};
 vm.runInNewContext(source+'\ninstallClockAdapter(Shell,views,{simulated});',{testMocksEnabled,devSurfacesEnabled:testMocksEnabled,createClockHandoffHistory,clockHandoffLegacyKey,secureConnectionStore,createInlineModal,currentClockTimeZone,buildClockRequest,describeClockDays,DailyApps,Shell,views,simulated,document,window:{addEventListener(){},removeEventListener(){}},queueMicrotask,localStorage,crypto:{randomUUID},Date,Intl,console});
 const shell=new Shell();
 shell.componentDidMount();
 const render=()=>views.workflows.render({},{isActive:()=>active});
 const open=()=>required(render().openClock)();
 const clock=()=>required(render().clock);
 const review=()=>required(clock().review);
 open();
 await settle();
 return {shell,render,open,clock,review,leave:()=>{active=false;required(views.workflows.onLeave)();},enter:()=>{active=true;}};
}
for(const mockBuild of [true,false]){
testMocksEnabled=mockBuild;writes.length=0;store.clear();secure.clear();failStorage=false;hidden=false;deferred=undefined;response={status:'opened',message:'Clock request sent. Check Clock.'};
let f=await fixture();let ui=f.clock();
assert.equal(writes.length,0);ui.onTime({target:{value:'25:03'}});f.clock().prepare();assert.equal(f.clock().review,null);
ui=f.clock();ui.onTime({target:{value:'06:45'}});ui.onLabel({target:{value:'Morning'}});f.clock().prepare();
const first=f.review();assert.match(first.text,/06:45/);assert.equal(writes.length,0);
// Changing a draft invalidates an old review callback.
f.clock().onLabel({target:{value:'Changed'}});await first.confirm();assert.equal(writes.length,0);
f.clock().prepare();const exact=f.review();const handoff=Promise.withResolvers<ClockResult>();deferred=handoff;const pending=exact.confirm();await exact.confirm();await settle();assert.equal(writes.length,1);assert.equal(required(secure.get(clockHandoffSlot)).record.status,'opening');
assert.deepEqual(JSON.parse(JSON.stringify(writes[0])),{action:'set',hour:6,minute:45,label:'Changed',timeZone:currentClockTimeZone(),reviewed:true});
handoff.resolve({action:'set',status:'opened',message:'Clock request sent. Check Clock.'});deferred=undefined;await pending;assert.equal(required(secure.get(clockHandoffSlot)).record.status,'opened');await exact.confirm();assert.equal(writes.length,1);
// Repeat days: chips toggle a sorted EXTRA_DAYS list on a new review; clearing them is one-time again.
{const chips=()=>required(f.clock().days);assert.deepEqual(JSON.parse(JSON.stringify(chips().map(d=>d.label))),['Mon','Tue','Wed','Thu','Fri','Sat','Sun']);
 required(chips().find(d=>d.label==='Wed')).toggle();required(chips().find(d=>d.label==='Mon')).toggle();assert.equal(f.clock().repeatText,'Repeats Mon, Wed');
 f.clock().prepare();const repeat=f.review();assert.match(repeat.text,/repeating alarm \(Mon, Wed\)/);await repeat.confirm();
 assert.deepEqual(JSON.parse(JSON.stringify(writes.at(-1))).days,[2,4]);writes.pop();// keep later write indexes stable
 required(chips().find(d=>d.label==='Mon')).toggle();required(chips().find(d=>d.label==='Wed')).toggle();assert.equal(f.clock().repeatText,'One time');}
// Without native EXTRA_DAYS support (no clockRepeatDaysVersion) the chips are hidden and a repeat is never sent.
// days is null, not []: the template renders its Repeat group for any array.
{repeatVersion=0;const plain=await fixture();assert.equal(plain.clock().repeatAvailable,false);assert.equal(plain.clock().days,null);
 const before=writes.length;plain.clock().prepare();assert.equal(plain.review().text.includes('repeating'),false);plain.shell.componentWillUnmount();assert.equal(writes.length,before);repeatVersion=1;}
// All other standard intents require a fresh review; no broad alarm identity is inferred.
for(const [name,action] of [['Show alarms','show'],['Snooze','snooze'],['Dismiss','dismiss']]){
 required(f.clock().actions.find(a=>a.label===name)).pick();f.clock().prepare();const review=f.review();
 if(action==='snooze'){assert.match(review.text,/requesting 10 minutes/);assert.match(review.text,/default duration/);assert.match(review.text,/all ringing alarms/);}
 if(action==='dismiss')assert.match(review.text,/one-time alarm is disabled/);
 await review.confirm();assert.equal(required(writes.at(-1)).action,action);
}
const snoozed=writes[2];assert.ok(snoozed.action==='snooze');assert.equal(snoozed.snoozeMinutes,10);
response={status:'unavailable',message:'No installed Clock app handles this action'};f.clock().prepare();await f.review().confirm();assert.match(f.clock().message,/No installed Clock/);
for(const status of ['denied','failed'] as const){response={status,message:`Clock ${status}`};f.clock().prepare();await f.review().confirm();assert.equal(f.clock().message,`Clock ${status}`);}
response=new Error('lost response');f.clock().prepare();await f.review().confirm();assert.match(f.clock().message,/unknown/);const count=writes.length;
f.shell.componentWillUnmount();f=await fixture();assert.match(f.clock().message,/unknown/);assert.equal(writes.length,count,'recreation must not dispatch or retry');
failStorage=true;f.clock().prepare();await f.review().confirm();assert.equal(writes.length,count);assert.equal(f.clock().message,"Can’t reach Clock. Reopen it and try again.");failStorage=false;
hidden=true;f.clock().prepare();await f.review().confirm();assert.equal(writes.length,count);hidden=false;
// A mode change during the opening write must also prevent the synthetic handoff.
f.clock().close();f.open();await settle();f.clock().prepare();
const blockedOpening=Promise.withResolvers<void>();openingGate=blockedOpening;
const awaitingOpening=f.review().confirm();await settle();
document.documentElement.dataset.connectionMode='mock';blockedOpening.resolve();openingGate=undefined;
await awaitingOpening;document.documentElement.dataset.connectionMode='live';assert.equal(writes.length,count,'a mock request cannot dispatch after its opening write');
// Leaving the view invalidates even a retained confirmation callback.
f.clock().prepare();const departed=f.review(),staleOpener=required(f.render().openClock);f.leave();await departed.confirm();assert.equal(writes.length,count);assert.equal(f.render().clock,null);assert.equal(f.shell.clockSelection(),undefined);
staleOpener();assert.equal(f.render().clock,null,'an opener from a departed Workflows visit cannot create a Clock draft');
f.enter();staleOpener();assert.equal(f.render().clock,null,'returning to Workflows cannot revive an old opener');
f.open();assert.equal(f.clock().review,null);
// Both startup mock and a mode switch during review prevent the native call.
// Without ELIZA_DEV_ALLOW_TEST_MOCKS there is no simulation: a mock request fails closed.
for(const startupMock of [true,false]){const mock=await fixture(startupMock);mock.clock().prepare();document.documentElement.dataset.connectionMode='mock';const review=mock.review();assert.equal(review.label,testMocksEnabled?'Simulate Clock request':'Continue to Clock');await review.confirm();assert.equal(writes.length,count);assert.match(mock.clock().message,testMocksEnabled?/simulated/:/unavailable without a live connection/);mock.shell.componentWillUnmount();document.documentElement.dataset.connectionMode='live';}
}
console.log('PASS actual Clock adapter flow: review/snapshot, invalid input, duplicate taps, all four operations, no handler, response loss/recreation, storage failure, foreground and mock isolation, with and without ELIZA_DEV_ALLOW_TEST_MOCKS. Native boundary is synthetic.');
