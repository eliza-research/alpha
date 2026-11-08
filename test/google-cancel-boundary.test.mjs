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

test('a Cancel right after the host commits reports the commit and sends no cleanup cancel',{timeout:3000},async()=>{
 const f=googleCancelBoundary(root),running=f.begin();await flush();const id=f.started[0],committed=f.outcome(id),held=Promise.withResolvers();
 f.setCancel(async()=>{await held.promise;return f.response({});});
 f.polls.get(id).resolve(committed);await flush();
 assert.equal(await f.client.cancelGoogleSignIn(),true);held.resolve();
 assert.deepEqual(await running.result,committed);assert.equal(f.cancelCalls,0);
});

test('an attempt that ends without a commit still retires its host attempt',{timeout:3000},async()=>{
 const f=googleCancelBoundary(root),running=f.begin();await flush();
 f.polls.get(f.started[0]).reject(Error('poll lost'));
 await assert.rejects(running.result,/poll lost/);assert.equal(f.cancelCalls,1);
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

test('a Google step committed by its own poll answers a later cancel as committed without a host call',{timeout:3000},async()=>{
 const f=googleCancelBoundary(root),running=f.begin();await flush();const id=f.started[0],committed=f.outcome(id);
 f.polls.get(id).resolve(committed);assert.deepEqual(await running.result,committed);await running.browserResult();const calls=f.cancelCalls;
 assert.equal(await f.client.cancelGoogleSignIn(),true);assert.equal(f.cancelCalls,calls);
});

test('a step without the Google flag keeps ordinary abort on a commit-aware port',{timeout:3000},async()=>{
 const f=googleCancelBoundary(root),pending=Promise.withResolvers(),abort=new AbortController();let cancels=0,googleCancels=0;
 const port={cancel:async()=>{cancels++;},cancelGoogleSignIn:async()=>{googleCancels++;return {status:'cancelled'};}};
 const client=new f.client.constructor(port);
 const running=client.signInStep(abort.signal,()=>pending.promise,value=>value);
 abort.abort(new DOMException('Cancelled','AbortError'));
 await assert.rejects(running,error=>error.name==='AbortError');
 assert.equal(cancels,1);assert.equal(googleCancels,0);assert.equal(await client.cancelGoogleSignIn(),false);
});


test('a failed attempt does not borrow a later attempt commit for its delayed cancel failure',{timeout:3000},async()=>{
 const f=googleCancelBoundary(root),a=f.begin(),lateReply=Promise.withResolvers(),cancelEntered=Promise.withResolvers();
 let b,cancellingA,firstA=true;
 try{
  await flush();const idA=f.started[0];
  f.setCancel(async data=>{
   if(data.attemptId===idA&&firstA){firstA=false;cancelEntered.resolve();return lateReply.promise;}
   return f.response({status:'cancelled'});
  });
  cancellingA=f.client.cancelGoogleSignIn();cancellingA.catch(()=>{});await cancelEntered.promise;
  f.polls.get(idA).reject(Error('A poll failed'));
  await assert.rejects(a.result,/A poll failed/);await assert.rejects(a.browserResult(),/A poll failed/);
  b=f.begin();await flush();const idB=f.started[1],committedB=f.outcome(idB);
  f.polls.get(idB).resolve(committedB);assert.deepEqual(await b.result,committedB);await b.browserResult();
  lateReply.reject(Error('A cancel reply lost'));
  await assert.rejects(cancellingA,/A cancel reply lost/);
  assert.equal(await f.client.cancelGoogleSignIn(),true,'the current completed B still reports its own commit');
 }finally{
  f.setCancel(async()=>f.response({status:'cancelled'}));lateReply.reject(Error('test cleanup'));
  for(const poll of f.polls.values())poll.reject(Error('test cleanup'));
  await Promise.allSettled([a.result,b?.result,cancellingA].filter(Boolean));
 }
});
