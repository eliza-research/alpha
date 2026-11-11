import test from 'node:test';
import assert from 'node:assert/strict';
import {CalendarApprovalClient} from '../apps/app/src/runtime/calendar-approval-client.ts';
import {calendarApprovalResolvePath,parseCalendarApprovalResolution} from '../apps/app/src/runtime/calendar-approval.ts';
const id='11111111-2222-4333-8444-555555555555';
const dto=(extra={})=>({id,subjectUserId:'owner',state:'pending',action:'cancel_event',payload:{action:'cancel_event',side:'owner',calendarId:'primary',eventId:'event',notifyAttendees:false},reason:'Cancel the reviewed event.',expiresAt:'2099-01-01T00:00:00.000Z',updatedAt:'2026-11-10T12:00:00.000Z',...extra});
function fixture(){
 const f={epoch:0,calls:[],row:dto(),reply:{requestId:id,decision:'approve',kind:'succeeded',text:'Completed Calendar cancel event.'}};
 const client=new CalendarApprovalClient(signal=>{const epoch=f.epoch;return {ownerId:'owner',current(){signal.throwIfAborted();if(f.epoch!==epoch)throw Error('Owner changed');},async request(path,body,signal,headers,method){f.calls.push({path,body,headers,method});return f.request?f.request(path,body,signal):body?f.reply:{approvals:[f.row]};}};});
 return {f,client,signal:new AbortController().signal};
}
test('an exact read admission sends one typed decision with the reviewed revision and finite receipt',async()=>{
 const {f,client,signal}=fixture(),row=await client.read(id,signal);
 const receipt=await client.resolve(row,'approve',signal);
 assert.equal(receipt.kind,'succeeded');
 assert.deepEqual(f.calls[1],{path:calendarApprovalResolvePath(id),body:{decision:'approve',revision:row.revision},headers:{},method:'POST'});
 await assert.rejects(client.resolve(row,'approve',signal),/Check this Calendar request again/);
 await assert.rejects(client.resolve({...row},'approve',signal),/Check this Calendar request again/);
 assert.equal(f.calls.length,2);
});
test('a lost decision reply and concurrent second tap cannot dispatch again',async()=>{
 const {f,client,signal}=fixture(),row=await client.read(id,signal);let fail;
 f.request=()=>new Promise((_,reject)=>fail=reject);
 const first=client.resolve(row,'approve',signal);await assert.rejects(client.resolve(row,'approve',signal));
 fail(Error('Connection lost'));await assert.rejects(first,/Connection lost/);
 await assert.rejects(client.resolve(row,'approve',signal));assert.equal(f.calls.length,2);
});
test('mutating the same admitted object cannot change any part of the reviewed request',async()=>{
 const mutations=[row=>row.id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',row=>row.revision='another revision',row=>row.reason='Changed after review',row=>row.payload.eventId='another event',row=>row.ownerVerified=false,row=>row.state='approved'];
 for(const mutate of mutations){const {f,client,signal}=fixture(),row=await client.read(id,signal);mutate(row);await assert.rejects(client.resolve(row,'approve',signal));assert.equal(f.calls.length,1);}
 for(const extra of [{subjectUserId:'other'},{state:'done'}]){const {f,client,signal}=fixture();f.row=dto(extra);const row=await client.read(id,signal);row.ownerVerified=true;row.state='pending';await assert.rejects(client.resolve(row,'approve',signal));assert.equal(f.calls.length,1);}
});
test('owner, conversation or visibility retirement before dispatch refuses the read admission',async()=>{
 const {f,client,signal}=fixture(),row=await client.read(id,signal);f.epoch++;
 await assert.rejects(client.resolve(row,'approve',signal),/Owner changed/);assert.equal(f.calls.length,1);
});
test('late reads and decisions cannot publish to a replacement owner',async()=>{
 const {f,client,signal}=fixture();let done;
 f.request=()=>new Promise(resolve=>done=resolve);const pending=client.read(id,signal);f.epoch++;done({approvals:[f.row]});await assert.rejects(pending,/Owner changed/);
 delete f.request;const row=await client.read(id,signal);f.request=()=>new Promise(resolve=>done=resolve);const resolving=client.resolve(row,'approve',signal);f.epoch++;done(f.reply);await assert.rejects(resolving,/Owner changed/);
});
test('expired, foreign, terminal and aborted reads never admit a decision',async()=>{
 for(const extra of [{expiresAt:'2000-01-01T00:00:00Z'},{subjectUserId:'other'},{state:'done'}]){
  const {f,client,signal}=fixture();f.row=dto(extra);const row=await client.read(id,signal);await assert.rejects(client.resolve(row,'approve',signal));assert.equal(f.calls.length,1);
 }
 const {f,client}=fixture(),abort=new AbortController(),row=await client.read(id,abort.signal);abort.abort();await assert.rejects(client.resolve(row,'approve',new AbortController().signal));assert.equal(f.calls.length,1);
});
test('resolution receipts must match the exact request and selected decision',()=>{
 const reply={requestId:id,decision:'reject',kind:'rejected',text:'Nothing was changed.'};
 assert.equal(parseCalendarApprovalResolution(reply,id,'reject').kind,'rejected');
 for(const patch of [{requestId:'other'},{decision:'approve'},{kind:'succeeded'},{kind:'invented'},{failure:{code:'x',retryable:false,acceptance:'unknown'}}])assert.throws(()=>parseCalendarApprovalResolution({...reply,...patch},id,'reject'),/not confirmed/);
 const unknown=parseCalendarApprovalResolution({requestId:id,decision:'approve',kind:'blocked',failure:{code:'CALENDAR_REVIEW_UNCONFIRMED',retryable:false,acceptance:'unknown'}},id,'approve');assert.match(unknown.text,/not confirmed/);
});
