/** Execute the actual browser-return caller; no browser, credential, phone or network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=await readFile(new URL('../apps/app/src/runtime/native-connection.ts',import.meta.url),'utf8');
const start=source.indexOf('export async function openConnectionBrowser(');
assert.ok(start>=0);
const code=stripTypeScriptTypes(source.slice(start).replace(/^export /,''),{mode:'transform'});
class Target extends EventTarget {
  hidden=false;
  listeners=new Set();
  addEventListener(name,listener,options){super.addEventListener(name,listener,options);this.listeners.add(listener);}
  removeEventListener(name,listener,options){super.removeEventListener(name,listener,options);this.listeners.delete(listener);}
}
function fixture(){
 const document=new Target(),window=new Target(),calls=[];
 let resolveNative,rejectNative;
 const nativeResult=new Promise((resolve,reject)=>{resolveNative=resolve;rejectNative=reject;});
 const native={openExternal(input){calls.push({kind:'open',input});return nativeResult;},async cancel(input){calls.push({kind:'cancel',input});rejectNative(new Error('Native browser request retired'));}};
 const context=vm.createContext({document,window,native,crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},Promise,DOMException});
 vm.runInContext(code,context);
 return {document,window,calls,resolveNative,rejectNative,
  open:signal=>context.openConnectionBrowser('https://eliza.app/auth/cli-login',signal||new AbortController().signal),
  visible(value){document.hidden=!value;document.dispatchEvent(new Event('visibilitychange'));},
  focus(){window.dispatchEvent(new Event('focus'));},
  listeners(){return document.listeners.size+window.listeners.size;}};
}
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
test('foreground return releases wait when the native reply is delayed',async t=>{
 const f=fixture();t.after(()=>f.resolveNative());let settled=false;
 const result=f.open().then(()=>{settled=true;});
 f.visible(false);f.visible(true);await flush();
 assert.equal(settled,true);await result;
 assert.equal(f.calls.filter(c=>c.kind==='open').length,1);assert.equal(f.calls.filter(c=>c.kind==='cancel').length,1);assert.equal(f.calls.find(c=>c.kind==='cancel').input.requestId,f.calls.find(c=>c.kind==='open').input.requestId);assert.equal(f.listeners(),0);
});
test('focus before a background transition cannot complete a browser handoff',async()=>{
 const f=fixture();let settled=false;const result=f.open().then(()=>{settled=true;});
 f.focus();await flush();assert.equal(settled,false);f.resolveNative();await result;assert.equal(f.listeners(),0);
});
test('focus while the document is still hidden cannot complete a browser handoff',async()=>{
 const f=fixture();let settled=false;const result=f.open().then(()=>{settled=true;});
 f.visible(false);f.focus();await flush();assert.equal(settled,false);f.resolveNative();await result;assert.equal(f.listeners(),0);
});
test('the normal native return still completes without visibility events',async()=>{
 const f=fixture();const result=f.open();f.resolveNative();await result;assert.equal(f.calls.filter(c=>c.kind==='cancel').length,0);assert.equal(f.listeners(),0);
});
test('cancellation retires the same native request and removes return listeners',async()=>{
 const f=fixture(),controller=new AbortController();const result=f.open(controller.signal);f.visible(false);
 controller.abort(new DOMException('Cancelled','AbortError'));await assert.rejects(result,{name:'AbortError'});
 f.visible(true);f.focus();await flush();assert.equal(f.calls.filter(c=>c.kind==='cancel').length,1);assert.equal(f.listeners(),0);f.resolveNative();
});
test('a late native rejection after foreground completion is observed without a second continuation',async()=>{
 const f=fixture();let completions=0;const result=f.open().then(()=>{completions++;});
 f.visible(false);f.visible(true);await result;f.rejectNative(new Error('Late native failure'));await flush();
 assert.equal(completions,1);assert.equal(f.calls.filter(c=>c.kind==='open').length,1);assert.equal(f.calls.filter(c=>c.kind==='cancel').length,1);assert.equal(f.listeners(),0);
});
test('native launch failure removes listeners and does not wait for a return',async()=>{
 const f=fixture();const result=f.open();f.rejectNative(new Error('Browser unavailable'));await assert.rejects(result,/Browser unavailable/);assert.equal(f.listeners(),0);
});
test('cancellation wins even when a foreground event just resolved the return',async()=>{
 const f=fixture(),controller=new AbortController();const result=f.open(controller.signal);
 f.visible(false);f.visible(true);controller.abort(new DOMException('Cancelled','AbortError'));
 await assert.rejects(result,{name:'AbortError'});assert.equal(f.calls.filter(c=>c.kind==='cancel').length,1);assert.equal(f.listeners(),0);f.resolveNative();
});
