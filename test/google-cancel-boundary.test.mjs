import test from 'node:test';
import assert from 'node:assert/strict';
import {googleCancelBoundary,flush} from './fixtures/google-cancel-boundary.mjs';
const root=new URL('../',import.meta.url);
const unavailable=error=>error?.code==='unavailable';

for(const [name,reply] of [
 ['unreadable JSON',()=>({ok:true,json:async()=>{throw Error('truncated');}})],
 ['null',f=>f.response(null)],['array',f=>f.response([])],['scalar',f=>f.response('cancelled')],
 ['empty object',f=>f.response({})],['unknown status',f=>f.response({status:'unavailable'})],
 ['ambiguous cancellation',f=>f.response({status:'cancelled',extra:true})],
 ['wrong committed attempt',f=>f.response({...f.outcome('another-attempt')})],
])test(`${name} cannot confirm cancellation or stop polling`,{timeout:3000},async()=>{
 const f=googleCancelBoundary(root),running=f.begin();await flush();const id=f.started[0],controller=f.port.googleController;
 f.setCancel(async()=>reply(f));
 await assert.rejects(f.client.cancelGoogleSignIn(),unavailable);
 assert.equal(controller.signal.aborted,false);assert.equal(f.popups[0].closed,false);
 const committed=f.outcome(id);f.polls.get(id).resolve(committed);
 assert.deepEqual(await running.result,committed);await running.browserResult();
});

test('a failed cancellation can be retried and explicit cancellation ends the same attempt',{timeout:3000},async()=>{
 const f=googleCancelBoundary(root),running=f.begin();await flush();
 f.setCancel(async()=>{throw Error('RPC lost');});
 await assert.rejects(f.client.cancelGoogleSignIn(),/RPC lost/);
 assert.equal(f.popups[0].closed,false);
 f.setCancel(async()=>f.response({status:'cancelled'}));
 assert.equal(await f.client.cancelGoogleSignIn(),false);
 await assert.rejects(running.result,error=>error.name==='AbortError');
 assert.equal(f.popups[0].closed,true);
});

test('a committed cancellation response is parsed and reconciled without aborting its poll',{timeout:3000},async()=>{
 const f=googleCancelBoundary(root),running=f.begin();await flush();const id=f.started[0],committed=f.outcome(id);
 f.setCancel(async()=>f.response(committed));
 assert.equal(await f.client.cancelGoogleSignIn(),true);
 assert.deepEqual(await running.result,committed);assert.equal(f.popups[0].closed,false);
 f.polls.get(id).resolve(committed);await running.browserResult();
});

test('a delayed cancellation response for A cannot abort replacement B',{timeout:3000},async()=>{
 const f=googleCancelBoundary(root),a=f.begin();await flush();const idA=f.started[0],replyA=Promise.withResolvers();let held=false;
 f.setCancel(async data=>{if(data.attemptId===idA&&!held){held=true;return replyA.promise;}return f.response({status:'cancelled'});});
 const cancellingA=f.client.cancelGoogleSignIn();
 f.polls.get(idA).reject(Error('old poll ended'));
 await assert.rejects(a.result,/old poll ended/);
 const b=f.begin();await flush();const idB=f.started[1],controllerB=f.port.googleController;
 replyA.resolve(f.response({status:'cancelled'}));assert.equal(await cancellingA,false);
 assert.notEqual(idB,idA);assert.equal(controllerB.signal.aborted,false);assert.equal(f.popups[1].closed,false);
 const committed=f.outcome(idB);f.polls.get(idB).resolve(committed);
 assert.deepEqual(await b.result,committed);await b.browserResult();
});

test('protocol refuses malformed committed metadata and leaves the ordinary outcome pending',{timeout:3000},async()=>{
 const f=googleCancelBoundary(root),pending=Promise.withResolvers();
 const port={startGoogle:()=>pending.promise,cancelGoogleSignIn:async()=>({status:'authenticated',environment:'production'})};
 const client=new f.client.constructor(port);
 const running=client.signInStep(new AbortController().signal,()=>pending.promise,value=>{assert.equal(typeof value.credentialId,'string');return value;},()=>{});
 running.catch(()=>{});await flush();
 await assert.rejects(client.cancelGoogleSignIn());assert.ok(client.activeLogin);assert.equal(client.activeLogin.signal.aborted,false);
 const committed=f.outcome('test-attempt');pending.resolve(committed);assert.deepEqual(await running,committed);
});
