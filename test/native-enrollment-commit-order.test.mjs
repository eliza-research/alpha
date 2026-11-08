import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const start=source.indexOf('    credential.enrollmentId=registered.enrollmentId;await store.write(slot,credential);'),end=source.indexOf('    client.deviceHeaders=headers;',start);
assert.ok(start>=0&&end>start);
const execute=new Function('store','slot','credential','registered','signal','request','session','isAndroid',`return(async()=>{${stripTypeScriptTypes(source.slice(start,end),{mode:'transform'})}})();`);
const run=(...args)=>execute(...args,true);
function fixture(){
 const committed=Promise.withResolvers(),entered=Promise.withResolvers(),order=[];
 const credential={installationId:'installation',key:'private-fixture'},registered={enrollmentId:'enrollment'},session={ownerId:'owner',agentId:'agent'};
 let saved;const store={async write(slot,value){order.push('write-start');entered.resolve();await committed.promise;saved=structuredClone(value);order.push('write-committed');}};
 let reads=0;const request=async(path,body,signal)=>{signal.throwIfAborted();reads++;order.push('native-enroll-ensure');assert.deepEqual(saved,{...credential,enrollmentId:'enrollment'});assert.equal(path,'/api/client-devices/context');assert.equal(body,undefined);return{subjectUserId:session.ownerId,agentId:session.agentId,installationId:credential.installationId,enrollmentId:credential.enrollmentId};};
 return{store,credential,registered,session,request,entered:entered.promise,release:()=>committed.resolve(),order,reads:()=>reads};
}
test('resident enrollment wakes existing native path only after final slot commit',async()=>{
 const f=fixture(),pending=run(f.store,'device:fixture',f.credential,f.registered,new AbortController().signal,f.request,f.session);
 await f.entered;assert.equal(f.reads(),0);f.release();await pending;
 assert.deepEqual(f.order,['write-start','write-committed','native-enroll-ensure']);assert.equal(f.reads(),1);
});
test('changed committed identity is refused',async()=>{
 for(const field of ['subjectUserId','agentId','installationId','enrollmentId']){
  const f=fixture(),pending=run(f.store,'device:fixture',f.credential,f.registered,new AbortController().signal,async(...args)=>({...await f.request(...args),[field]:'foreign'}),f.session);f.release();await assert.rejects(pending,/Committed device enrollment changed/);
 }
});
test('failed or canceled durable enrollment never wakes the observer',async()=>{
 const f=fixture();let reads=0;await assert.rejects(run({write:async()=>{throw Error('write failed');}},'device:fixture',f.credential,f.registered,new AbortController().signal,async()=>{reads++;},f.session),/write failed/);assert.equal(reads,0);
 const controller=new AbortController(),pending=run(f.store,'device:fixture',f.credential,f.registered,controller.signal,f.request,f.session);await f.entered;controller.abort();f.release();await assert.rejects(pending);assert.equal(f.reads(),0);
});

test('browser enrollment adds no native notification wake request',async()=>{
 const f=fixture(),pending=execute(f.store,'device:fixture',f.credential,f.registered,new AbortController().signal,f.request,f.session,false);f.release();await pending;assert.equal(f.reads(),0);
});
