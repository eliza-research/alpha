import {digestFixtureProvider} from './digest-fixture-types.ts';
import assert from 'node:assert/strict';
import {DigestInbox} from '../apps/app/src/runtime/hosted-digests.ts';
const now=new Date().toISOString();
const result={cursor:1,runId:'run-one',workflowId:'workflow',workflowVersionId:'version',templateVersion:'template',scheduledAt:now,source:{kind:'tasks'},status:'completed',startedAt:now,completedAt:now,output:'Synthetic',error:null};
function storage(){const data=new Map(),calls: any[]=[];return {data,calls,read:async (key: any)=>{calls.push(['read',key]);return structuredClone(data.get(key)??null);},write:async(key: any,value: any)=>{calls.push(['write',key]);data.set(key,structuredClone(value));},remove:async (key: any)=>{calls.push(['remove',key]);data.delete(key);}};}
function deferred(){let resolve!:(value?:unknown)=>void;const promise=new Promise<unknown>(done=>resolve=done);return {promise,resolve};}
{
 const store=storage(),controller=new AbortController();controller.abort();
 await assert.rejects(new DigestInbox(store,'cancel-before-start').sync(digestFixtureProvider({results:async()=>{throw Error('Unexpected request');}}),controller.signal),{name:'AbortError'});
 assert.deepEqual(store.calls,[],'Already cancelled work accessed storage');
}
{
 const store=storage(),scope='cancel-queued',entered=deferred(),release=deferred();
 const active=new DigestInbox(store,scope).sync(digestFixtureProvider({results:async()=>{entered.resolve();await release.promise;return [];}}),new AbortController().signal);
 await entered.promise;
 let queuedReads=0;const queuedStore={...store,read:async (key: any)=>{queuedReads++;return store.read(key);}};
 const controller=new AbortController();const queued=new DigestInbox(queuedStore,scope).sync(digestFixtureProvider({results:async()=>{throw Error('Cancelled queued request');}}),controller.signal);
 const rejected=assert.rejects(queued,{name:'AbortError'});controller.abort();release.resolve();await active;
 await rejected;assert.equal(queuedReads,0,'Queued cancelled work accessed storage');
}
{
 const store=storage(),scope='cancel-response',controller=new AbortController();let ack=false;
 await assert.rejects(new DigestInbox(store,scope).sync(digestFixtureProvider({results:async()=>{controller.abort();return [result];},ack:async()=>{ack=true;}}),controller.signal),{name:'AbortError'});
 assert.equal(store.data.has(scope+':run-one'),false,'Late response wrote a result');assert.equal(ack,false);
}
{
 const store=storage(),scope='cancel-during-commit',controller=new AbortController();let ack=false;
 const write=store.write;store.write=async(key: any,value: any)=>{await write(key,value);if(key===scope+':run-one')controller.abort();};
 await assert.rejects(new DigestInbox(store,scope).sync(digestFixtureProvider({results:async()=>[result],ack:async()=>{ack=true;}}),controller.signal),{name:'AbortError'});
 assert.equal(ack,false);assert.deepEqual(store.data.get(scope).ids,[],'Cancelled commit advanced the index');
 assert.deepEqual(store.data.get(scope+':run-one'),result,'An in-flight durable write must remain recoverable');
 store.write=write;
 const replay={results:async()=>ack?[]:[result],ack:async()=>{assert.deepEqual(await new DigestInbox(store,scope).history(),[result]);ack=true;}};
 assert.deepEqual(await new DigestInbox(store,scope).sync(digestFixtureProvider(replay),new AbortController().signal),[result]);assert.equal(ack,true);
}
console.log('Cancelled queued work, late responses and in-flight commit recovery passed.');
