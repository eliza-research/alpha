import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {tsImport} from 'tsx/esm/api';
const {applyMailSelection} = await tsImport('../apps/app/src/runtime/mail-selection.ts', import.meta.url);
function fixture() {
  const slots=new Map(), dispatched=[], applied=[];let active=true, reject='', unknown='';
  const store={read:async key=>structuredClone(slots.get(key)??null),compareExchange:async(key,expected,value)=>{
    if(JSON.stringify(slots.get(key)??null)!==JSON.stringify(expected))return {status:'conflict'};
    if(value===null)slots.delete(key);else slots.set(key,structuredClone(value));return {status:'saved'};
  }};
  const client={
    gmailInboxCapabilities:async()=>({mailboxMutations:true}),
    gmailRead:async(_grant,id)=>({message:{id},historyId:'history-'+id}),
    gmailPrepareOperation:async(_grant,requestId,proposal)=>{
      const review={...proposal,from:'owner@example.invalid'};
      const reviewDigest=createHash('sha256').update(JSON.stringify(review)).digest('hex');
      return {review,receipt:{requestId,kind:proposal.kind,state:'prepared',reviewDigest,providerResult:null,rejectionCode:null}};
    },
    gmailDispatchOperation:async(_grant,requestId,reviewDigest,proposal)=>{
      dispatched.push(proposal.messageId);
      if(proposal.messageId===unknown)throw Error('Connection lost');
      return {requestId,kind:proposal.kind,state:proposal.messageId===reject?'rejected':'succeeded',reviewDigest,providerResult:{messageId:proposal.messageId},rejectionCode:null};
    },
    gmailOperation:async()=>{throw Error('Still unknown');},
  };
  return {slots,dispatched,applied,client,store,setReject:id=>reject=id,setUnknown:id=>unknown=id,retire:()=>active=false,
    run:(ids,action='archive')=>applyMailSelection({owner:'owner',grantId:'grant',client,store,ids,action,signal:new AbortController().signal,current:()=>active,settlePriorSend:async()=>{},applied:id=>applied.push(id)})};
}
test('a confirmed selection applies each distinct email once through the journal',async()=>{
 const f=fixture(),result=await f.run(['one','two','one']);
 assert.equal(result.error,'');assert.deepEqual(result.completed,['one','two']);assert.deepEqual(f.dispatched,['one','two']);assert.equal(f.slots.size,0);
});
test('a rejected item stops the selection before later items',async()=>{
 const f=fixture();f.setReject('two');const result=await f.run(['one','two','three']);
 assert.deepEqual(result.completed,['one']);assert.deepEqual(f.dispatched,['one','two']);assert.match(result.error,/did not accept/);assert.equal(f.slots.size,1);
});
test('a lost reply is retained and cannot be replayed by another selection',async()=>{
 const f=fixture();f.setUnknown('one');const first=await f.run(['one','two']);assert.ok(first.error);assert.deepEqual(f.dispatched,['one']);
 const second=await f.run(['one','two']);assert.ok(second.error);assert.deepEqual(f.dispatched,['one']);assert.equal(f.slots.size,1);
});
test('a changed owner stops before the next request',async()=>{
 const f=fixture();f.client.gmailRead=async(_grant,id)=>{f.retire();return {message:{id},historyId:'revision'};};
 const result=await f.run(['one']);assert.ok(result.error);assert.deepEqual(f.dispatched,[]);
});

test('Star requires the explicit server capability and uses the same journal', async()=>{
 const f=fixture();
 const unavailable=await f.run(['one'],'star');
 assert.ok(unavailable.error);assert.deepEqual(f.dispatched,[]);
 f.client.gmailInboxCapabilities=async()=>({mailboxMutations:true,stars:true});
 const applied=await f.run(['one'],'star');
 assert.equal(applied.error,'');assert.deepEqual(f.dispatched,['one']);
});
