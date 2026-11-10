import {readGmailAccountChoice,saveGmailAccountChoice} from '../apps/app/src/runtime/gmail-account-selection';
import assert from 'node:assert/strict';
import {GmailReadAhead} from '../apps/app/src/runtime/gmail-read-ahead';
const signal=()=>new AbortController().signal;
const gate=()=>Promise.withResolvers<string>();
let calls=0,now=0;const loader=new GmailReadAhead<string>(30,()=>now),a=gate();
loader.prepare('owner-a/query','cursor',async()=>{calls++;return a.promise;});
loader.prepare('owner-a/query','cursor',async()=>{calls++;return 'duplicate';});
const pending=loader.take('owner-a/query','cursor',signal());a.resolve('owned page');
assert.equal(await pending,'owned page');assert.equal(calls,1,'Load more joins the one speculative request');
assert.equal(await loader.take('owner-a/query','cursor',signal()),undefined,'cursor consumed once');
loader.prepare('owner-a/query','cursor',async()=>{calls++;return 'private';});
assert.equal(await loader.take('owner-b/query','cursor',signal()),undefined,'another account cannot consume the page');
loader.invalidate();
let cancelled=false;loader.prepare('owner-a/query','cursor',async s=>{s.addEventListener('abort',()=>{cancelled=true;});return 'page';});loader.invalidate();assert.equal(cancelled,true);
loader.prepare('owner-a/query','cursor',async()=> 'expired');now=30;assert.equal(await loader.take('owner-a/query','cursor',signal()),undefined,'TTL expires without a timer or poll');
const failure=new Error('provider failed');loader.prepare('owner-a/query','cursor',async()=>{throw failure;});await assert.rejects(loader.take('owner-a/query','cursor',signal()),e=>e===failure);
assert.equal(await loader.take('owner-a/query','cursor',signal()),undefined,'failed read does not replay itself');
const b=gate(),abort=new AbortController();loader.prepare('owner-a/query','cursor',async()=>b.promise);const taken=loader.take('owner-a/query','cursor',abort.signal);abort.abort();b.resolve('late');await assert.rejects(taken,e=>e instanceof Error && e.name==='AbortError');
console.log('PASS Gmail read-ahead: one-page budget, in-flight reuse, consumption, owner key isolation, cancellation, TTL and failures.');

const rows=new Map<string,string>(),port={getItem:(k:string)=>rows.get(k)??null,setItem:(k:string,v:string)=>{rows.set(k,v);},removeItem:(k:string)=>{rows.delete(k);}};
const owner={environment:'production',userId:'user',organizationId:'org'};saveGmailAccountChoice(owner,'grant',port);assert.equal(readGmailAccountChoice(owner,port),'grant');for(const changed of [{...owner,userId:'other'},{...owner,organizationId:'other'},{...owner,environment:'staging'}])assert.equal(readGmailAccountChoice(changed,port),null);saveGmailAccountChoice(owner,null,port);assert.equal(readGmailAccountChoice(owner,port),null);
console.log('PASS account hints: non-secret IDs only, environment/user/organization isolation and invalidation.');

const retained=new GmailReadAhead<string>();let reads=0;retained.prepare('owner/query','next',async()=>{reads++;return 'ready';});await Promise.resolve();retained.pause();retained.prepare('owner/query','next',async()=>{reads++;return 'duplicate';});assert.equal(await retained.take('owner/query','next',signal()),'ready');assert.equal(reads,1,'completed next page survives a brief visit Home without another RPC');
