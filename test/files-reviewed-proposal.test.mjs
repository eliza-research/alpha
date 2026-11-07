import test from 'node:test';
import assert from 'node:assert/strict';
import {tsImport} from 'tsx/esm/api';

const {DeviceActions,setFilesReviewIdentity}=await tsImport('../apps/app/src/runtime/device-actions.ts',import.meta.url);

const context={view:'files',revision:1,sensitive:false};
const token=letter=>letter.repeat(43);
const signal=()=>new AbortController().signal;
function fixture(){
 let state='pending',entry,dispatched;
 const id='files-review',digest='b'.repeat(64),expiresAt=new Date(Date.now()+60000).toISOString();
 const proposal=()=>({id,digest,state,subjectUserId:'owner',requestedBy:'agent',action:'device_action',expiresAt,
  payload:{version:1,action:'device_action',installationId:'device',enrollmentId:'enrollment',
   operation:{type:'files_move',paths:['Download/reviewed.txt'],dest:'Documents',reviewed:[token('x')]}},
  execution:state==='executing'?{attemptId:'attempt-one'}:undefined});
 const request=async(path,body)=>{
  if(body===undefined)return {proposals:[proposal()]};
  if(path.endsWith('/decision'))state='approved';
  if(path.endsWith('/claim'))state='executing';
  return {proposal:proposal(),digest};
 };
 const journal={reserve:async input=>({created:true,entry:entry={...input,phase:'reserved'}}),
  markApplying:async input=>Object.assign(entry,{phase:'applying',attemptId:input.attemptId}),
  finish:async input=>Object.assign(entry,input,{phase:'terminal'}),get:async()=>({entry}),list:async()=>({entries:entry?[entry]:[]})};
 const client=new DeviceActions({ownerId:'owner',agentId:'agent',origin:'https://agent.invalid',sessionId:'session'},
  {installationId:'device',enrollmentId:'enrollment',key:'a'.repeat(64),capabilities:['files.browser.v1']},
  'c'.repeat(64),request,journal,async operation=>{dispatched=operation;return {status:'succeeded',summary:'Synthetic receipt'};});
 return {id,client,get entry(){return entry},get dispatched(){return dispatched}};
}

test('refresh keeps the originally reviewed token and the journal records that token',async()=>{
 const f=fixture();let identity=token('a'),reads=0;
 setFilesReviewIdentity(async()=>{reads++;return [identity];});
 assert.ok((await f.client.pendingReview(context,signal()))[0].proposal);
 identity=token('b');
 assert.ok((await f.client.pendingReview(context,signal()))[0].proposal);
 assert.equal(reads,1,'Refreshing the same proposal cannot bind a replacement');
 const approved=await f.client.approve(f.id,context,signal());
 assert.equal(approved.status,'succeeded');
 assert.deepEqual(f.dispatched.reviewed,[token('a')]);
 assert.deepEqual(f.entry.record.operation.reviewed,[token('a')]);
 assert.equal(f.entry.phase,'terminal');
});

test('an unbound Files proposal cannot be approved or written to the journal',async()=>{
 const f=fixture();setFilesReviewIdentity(async()=>{throw Error('File missing');});
 const items=await f.client.pendingReview(context,signal());
 assert.equal(items[0].proposal,null);
 await assert.rejects(f.client.approve(f.id,context,signal()),/Review this action again/);
 assert.equal(f.entry,undefined);assert.equal(f.dispatched,undefined);
});
