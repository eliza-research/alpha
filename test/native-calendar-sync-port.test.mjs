import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {stripTypeScriptTypes} from 'node:module';import {webcrypto} from 'node:crypto';
const binding={environment:'production',userId:'owner',organizationId:'org',connectionId:'11111111-1111-4111-8111-111111111111',providerAccountId:'google',calendarId:'primary',agentId:'agent',localSourceId:'native:7',localSourceRevision:'22222222-2222-4222-8222-222222222222'};
const event={title:'Synthetic Calendar event',description:'',location:'',startAt:'2026-10-16',endAt:'2026-10-17',timeZone:null,isAllDay:true,attendees:[],recurrence:[]};
function fixture(){
 const calls=[],state={permission:true,requested:0,enabled:false,outcome:'saved',phase:'deleted',current:true,abortAfterApply:false,invalidEnd:false};const abort=new AbortController();
 const projection=()=>({status:'ready',lease:'33333333-3333-4333-8333-333333333333',binding:{...binding},destination:{account:'owner@example.invalid',calendar:'Personal'},events:[{id:'42',revision:'a'.repeat(64)}],enabled:state.enabled});
 const bridge={requestAccess:async()=>{state.requested++;state.permission=true;return {status:'granted'};},addListener:async()=>({remove:async()=>{}}),sync:async input=>{
  calls.push(structuredClone(input));
  if(input.kind==='prepare')return state.permission?projection():{status:'permission-required'};
  if(input.kind==='enable')return state.outcome==='cancelled'?{status:'cancelled'}:(state.enabled=true,projection());
  if(input.kind==='status')return projection();
  if(input.kind==='get')return {status:'ready',snapshot:null,...(state.recoveries?{recoveries:state.recoveries}:{})};
  if(input.kind==='apply'){if(state.abortAfterApply)abort.abort();return state.outcome==='saved'?{status:'saved',snapshot:{eventId:'42',revision:'b'.repeat(64),event:{...structuredClone(input.event),...(state.invalidEnd?{endAt:'invalid-date'}:{})}}}:{status:state.outcome};}
  if(input.kind==='delete')return {status:'queued',receipt:{phase:'queued'}};
  if(input.kind==='deletion')return {status:'receipt',receipt:{phase:state.phase}};
  if(input.kind==='ack')return {status:'acknowledged'};
  if(input.kind==='pause'){state.enabled=false;return {status:'paused'};}
  if(input.kind==='cancel')return {status:'cancelled'};
  throw Error('Unexpected native operation');
 }};
 const context=vm.createContext({crypto:webcrypto,TextEncoder,document:{hidden:false},Event,DOMException,Date,AbortController,setTimeout,clearTimeout,window:{dispatchEvent(){}},Capacitor:{isNativePlatform:()=>true},registerPlugin:()=>bridge});
 const fields=stripTypeScriptTypes(fs.readFileSync('apps/app/src/browser/calendar-sync-fields.ts','utf8'),{mode:'transform'}).replace(/^export /gm,'');vm.runInContext(fields,context);
 const source=stripTypeScriptTypes(fs.readFileSync('apps/app/src/runtime/native-calendar-sync.ts','utf8'),{mode:'transform'}).replace(/^import[^\n]+\n/gm,'').replace('export const nativeCalendarSync =','globalThis.nativeCalendarSync =');vm.runInContext(source,context);
 const api=context.nativeCalendarSync,current=()=>state.current,prepare=()=>api.prepare({environment:'production',connectionId:binding.connectionId,calendarId:'primary'},current,abort.signal);
 return {api,state,calls,abort,prepare,current};
}
test('only an explicit native review may ask for Calendar permission',async()=>{
 const f=fixture();f.state.permission=false;await assert.rejects(f.prepare(),/Allow Calendar access/);assert.equal(f.state.requested,0);
 await f.api.prepare({environment:'production',connectionId:binding.connectionId,calendarId:'primary'},f.current,f.abort.signal,true);assert.equal(f.state.requested,1);assert.equal(f.calls.filter(c=>c.kind==='prepare').length,3);
});
test('native consent cancellation dispatches no event mutation',async()=>{
 const f=fixture();await f.prepare();f.state.outcome='cancelled';await assert.rejects(f.api.enable(f.current),/not enabled/);assert.equal(f.calls.some(c=>['apply','delete'].includes(c.kind)),false);
});
test('confirmed native save returns its readback and acknowledges only the observed receipt',async()=>{
 const f=fixture(),admitted=await f.prepare();const port=f.api.port(admitted,f.current,f.abort.signal);const saved=await port.applyProviderEvent('42',event,'a'.repeat(64));assert.equal(saved.revision,'b'.repeat(64));assert.equal(f.calls.filter(c=>c.kind==='apply').length,1);assert.equal(f.calls.filter(c=>c.kind==='ack').length,1);assert.match(f.calls.find(c=>c.kind==='apply').operationId,/^[a-f0-9]{64}$/);
});
for(const failure of ['unknown','conflict','context-changed'])test(`native ${failure} is never retried or acknowledged`,async()=>{
 const f=fixture(),admitted=await f.prepare();f.state.outcome=failure;await assert.rejects(f.api.port(admitted,f.current,f.abort.signal).applyProviderEvent('42',event,'a'.repeat(64)));assert.equal(f.calls.filter(c=>c.kind==='apply').length,1);assert.equal(f.calls.filter(c=>c.kind==='ack').length,0);
});
test('a changed context refuses before native dispatch; an abort after dispatch never retries',async()=>{
 const f=fixture(),admitted=await f.prepare(),port=f.api.port(admitted,f.current,f.abort.signal);f.state.current=false;await assert.rejects(port.applyProviderEvent('42',event,'a'.repeat(64)),/context changed/);assert.equal(f.calls.filter(c=>c.kind==='apply').length,0);f.state.current=true;f.state.abortAfterApply=true;await assert.rejects(port.applyProviderEvent('42',event,'a'.repeat(64)),{name:'AbortError'});assert.equal(f.calls.filter(c=>c.kind==='apply').length,1);assert.equal(f.calls.filter(c=>c.kind==='ack').length,0);
});
test('Undo keeps the event and returns an explicit review state without a second delete',async()=>{
 const f=fixture(),admitted=await f.prepare();f.state.phase='undone';await assert.rejects(f.api.port(admitted,f.current,f.abort.signal).delete('42','a'.repeat(64)),/Deletion undone/);assert.equal(f.calls.filter(c=>c.kind==='delete').length,1);assert.equal(f.calls.filter(c=>c.kind==='ack').length,1);
});
test('native deletion succeeds only after its receipt and exact-ID absence agree',async()=>{
 const f=fixture(),admitted=await f.prepare();await f.api.port(admitted,f.current,f.abort.signal).delete('42','a'.repeat(64));assert.deepEqual(f.calls.map(c=>c.kind),['prepare','delete','deletion','get','ack']);
});
test('paused or uncertain deletion receipts do not dispatch or report a second deletion',async()=>{
 const f=fixture(),admitted=await f.prepare();f.state.phase='paused';await assert.rejects(f.api.port(admitted,f.current,f.abort.signal).delete('42','a'.repeat(64)),/paused or unconfirmed/);assert.equal(f.calls.filter(c=>c.kind==='delete').length,1);assert.equal(f.calls.filter(c=>c.kind==='ack').length,0);
});

test('an invalid native readback date is rejected without acknowledging or replaying the write',async()=>{
 const f=fixture(),admitted=await f.prepare();f.state.invalidEnd=true;await assert.rejects(f.api.port(admitted,f.current,f.abort.signal).applyProviderEvent('42',event,'a'.repeat(64)),/Invalid device Calendar event/);assert.equal(f.calls.filter(c=>c.kind==='apply').length,1);assert.equal(f.calls.filter(c=>c.kind==='ack').length,0);
});

test('a staging selection never falls through to a production native request',async()=>{const f=fixture();await assert.rejects(f.api.prepare({environment:'staging',connectionId:binding.connectionId,calendarId:'primary'},f.current,f.abort.signal),/different Cloud environment/);assert.equal(f.calls.length,0);});

test('a recovered native receipt is acknowledged through a read-only get, without a write',async()=>{const f=fixture(),admitted=await f.prepare();f.state.recoveries=['c'.repeat(64)];assert.equal(await f.api.port(admitted,f.current,f.abort.signal).get('42'),null);assert.deepEqual(f.calls.map(c=>c.kind),['prepare','get','ack']);});
