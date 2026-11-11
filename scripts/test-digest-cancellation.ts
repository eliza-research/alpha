import assert from 'node:assert/strict';
import {DigestInbox,type DigestResult,type DigestStorage} from '../apps/app/src/runtime/hosted-digests.ts';
import {fixtureDigestProtocol} from './fixtures/hosted-digest-protocol.ts';
const now=new Date().toISOString();
const result:DigestResult={cursor:1,runId:'run-one',workflowId:'workflow',workflowVersionId:'version',templateVersion:'template',scheduledAt:now,source:{kind:'tasks'},status:'completed',startedAt:now,completedAt:now,output:'Synthetic',error:null};
function storage(): DigestStorage & {data:Map<string,unknown>;calls:[operation:string, key:string][]} {
 const data=new Map<string,unknown>();
 const calls:[operation:string, key:string][]=[];
 return {
  data,calls,
  read:async <T>(key:string)=>{calls.push(['read',key]);return structuredClone((data.get(key)??null) as T|null);},
  write:async(key,value)=>{calls.push(['write',key]);data.set(key,structuredClone(value));},
  remove:async key=>{calls.push(['remove',key]);data.delete(key);},
 };
}
{
 const store=storage(),controller=new AbortController();controller.abort();
 await assert.rejects(new DigestInbox(store,'cancel-before-start').sync(fixtureDigestProtocol(async()=>{throw Error('Unexpected request');}),controller.signal),{name:'AbortError'});
 assert.deepEqual(store.calls,[],'Already cancelled work accessed storage');
}
{
 const store=storage(),scope='cancel-queued',entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
 const active=new DigestInbox(store,scope).sync(fixtureDigestProtocol(async()=>{entered.resolve();await release.promise;return [];}),new AbortController().signal);
 await entered.promise;
 let queuedReads=0;const queuedStore={...store,read:async <T>(key:string)=>{queuedReads++;return store.read<T>(key);}};
 const controller=new AbortController();const queued=new DigestInbox(queuedStore,scope).sync(fixtureDigestProtocol(async()=>{throw Error('Cancelled queued request');}),controller.signal);
 const rejected=assert.rejects(queued,{name:'AbortError'});controller.abort();release.resolve();await active;
 await rejected;assert.equal(queuedReads,0,'Queued cancelled work accessed storage');
}
{
 const store=storage(),scope='cancel-response',controller=new AbortController();let ack=false;
 await assert.rejects(new DigestInbox(store,scope).sync(fixtureDigestProtocol(async()=>{controller.abort();return [result];},async()=>{ack=true;}),controller.signal),{name:'AbortError'});
 assert.equal(store.data.has(scope+':run-one'),false,'Late response wrote a result');assert.equal(ack,false);
}
{
 const store=storage(),scope='cancel-during-commit',controller=new AbortController();let ack=false;
 const write=store.write;store.write=async(key,value)=>{await write(key,value);if(key===scope+':run-one')controller.abort();};
 await assert.rejects(new DigestInbox(store,scope).sync(fixtureDigestProtocol(async()=>[result],async()=>{ack=true;}),controller.signal),{name:'AbortError'});
 assert.equal(ack,false);
 const index=store.data.get(scope);assert.ok(index&&typeof index==='object'&&'ids' in index);
 assert.deepEqual(index.ids,[],'Cancelled commit advanced the index');
 assert.deepEqual(store.data.get(scope+':run-one'),result,'An in-flight durable write must remain recoverable');
 store.write=write;
 const replay=fixtureDigestProtocol(async()=>ack?[]:[result],async()=>{assert.deepEqual(await new DigestInbox(store,scope).history(),[result]);ack=true;});
 assert.deepEqual(await new DigestInbox(store,scope).sync(replay,new AbortController().signal),[result]);assert.equal(ack,true);
}
console.log('Cancelled queued work, late responses and in-flight commit recovery passed.');
