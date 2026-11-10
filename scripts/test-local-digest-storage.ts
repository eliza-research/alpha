import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localAgentStorage} from './local-agent-dev-storage.ts';
import {developmentDigestStore} from '../apps/app/src/runtime/local-agent-storage.ts';
import {createDigestInbox} from '../apps/app/src/runtime/digest-inbox.ts';
import {DigestInbox,type DigestResult} from '../apps/app/src/runtime/hosted-digests.ts';
import {fixtureDigestProtocol} from './fixtures/hosted-digest-protocol.ts';
const dir=mkdtempSync(join(tmpdir(),'alpha-digests-'));
const scope='hosted-digests:v1:'+'a'.repeat(64),androidScope='renderer-'+scope;
const request: NonNullable<Parameters<typeof developmentDigestStore>[0]>=async input=>localAgentStorage(dir,input);
const store=()=>developmentDigestStore(request);
try {
 const first=store(),second=store();
 assert.equal(await first.read(scope+':pending'),null);
 assert.equal(await second.read(scope+':pending'),null);
 const pending={path:'sources',body:{id:'mutation-one'},summary:'Synthetic source'};
 await first.write(scope+':pending',pending);
 await assert.rejects(second.write(scope+':pending',{...pending,body:{id:'mutation-two'}}),/another tab/);
 await assert.rejects(second.remove(scope+':pending'),/another tab/);
 assert.deepEqual(await store().read(scope+':pending'),pending);
 await assert.rejects(first.write(scope+':pending',{...pending,body:{id:'mutation-two'}}),/awaiting recovery/);
 await first.remove(scope+':pending');
 assert.equal(await store().read(scope+':pending'),null);
 await assert.rejects(first.write('device:'+'a'.repeat(64),{}),/scope/);
 await assert.rejects(first.write(scope+':large','x'.repeat(800001)),/Invalid digest/);
 assert.equal(await store().read('hosted-digests:v1:'+'b'.repeat(64)),null);
 const now=new Date().toISOString();
 const result: DigestResult={cursor:1,runId:'run-one',workflowId:'workflow',workflowVersionId:'version',templateVersion:'template',scheduledAt:now,source:{kind:'tasks',selection:{label:'Synthetic tasks',ids:['one','two']}},status:'completed',startedAt:now,completedAt:now,output:'Synthetic digest',error:null};
 let nativeCalls=0;
 const nativeInbox={history:async()=>[],sync:async()=>{nativeCalls++;return [];}};
 const resident=()=>createDigestInbox({android:true,nativeReady:false,storage:store(),scope,native:()=>{throw Error('Unverified session must not use native polling');}});
 const remote=createDigestInbox({android:true,nativeReady:true,storage:store(),scope,native:()=>nativeInbox});
 await remote.sync(fixtureDigestProtocol(async()=>{throw Error('Native sync must not read renderer results');}),new AbortController().signal);assert.equal(nativeCalls,1);
 let acked=false,ackAttempts=0;
 const replay={...result,source:{selection:{ids:['one','two'],label:'Synthetic tasks'},kind:'tasks'}};
 const client=fixtureDigestProtocol(async()=>acked?[]:[ackAttempts?replay:result],async()=>{
  // Inspect a fresh store before allowing the host to advance its cursor.
  assert.deepEqual(await new DigestInbox(store(),androidScope).history(),[result]);
  if(++ackAttempts===1)throw Error('Lost synthetic ack');
  acked=true;
 });
 await assert.rejects(resident().sync(client,new AbortController().signal),/Lost synthetic ack/);
 assert.deepEqual(await resident().sync(client,new AbortController().signal),[result]);
 assert.equal(ackAttempts,2);
 assert.equal(await store().read(scope+':run-one'),null,'Android fallback must not populate native-authority namespace');
 for(const slot of ['renderer-hosted-digests:v1:wrong','renderer-hosted-digests:v1:'+('a'.repeat(64))+':../escape','workflow-notice-taps:v1','hosted-background:v1:active'])await assert.rejects(store().read(slot),/scope/);
 assert.equal(JSON.stringify(await store().read(androidScope+':run-one')),JSON.stringify(result),'Replay must preserve originally saved bytes');
 for(const source of [{...replay.source,selection:{...replay.source.selection,label:'Changed'}},{...replay.source,selection:{...replay.source.selection,ids:['two','one']}}]){
  let changedAck=false;
  await assert.rejects(resident().sync(fixtureDigestProtocol(async()=>[{...replay,source}],async()=>{changedAck=true;}),new AbortController().signal),/Saved digest result changed/);
  assert.equal(changedAck,false);assert.deepEqual(await resident().history(),[result]);
 }
 let falseAck=false;
 const failingStore=developmentDigestStore(async input=>{
  if(input.operation==='digestCompareExchange'&&typeof input.slot==='string'&&input.slot.endsWith(':run-two'))throw Error('Synthetic disk failure');
  return request(input);
 });
 await assert.rejects(new DigestInbox(failingStore,androidScope).sync(fixtureDigestProtocol(async()=>[{...result,cursor:2,runId:'run-two'}],async()=>{falseAck=true;}),new AbortController().signal),/disk failure/);
 assert.equal(falseAck,false);
 assert.deepEqual(await new DigestInbox(store(),androidScope).history(),[result]);
 console.log('Local digest persistence, stale tabs, scope isolation, commit-before-ack and lost-ack recovery passed.');
} finally {rmSync(dir,{recursive:true,force:true});}
