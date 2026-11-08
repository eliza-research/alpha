import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {transformSync} from 'esbuild';
// The staged canonical client, controller and snapshot state run with
// WebView113's static AbortSignal surface. Only the resident transport is a fixture.
function fixture({wait=false}={}){
 const compile=file=>transformSync(fs.readFileSync(file,'utf8'),{loader:'ts',target:'es2022',format:'cjs'}).code;
 const globals={AbortController,AbortSignal:{},DOMException,structuredClone};
 const modules=new Map();
 const load=file=>{
  file=path.resolve(file);if(!fs.existsSync(file)&&file.endsWith('.js'))file=file.slice(0,-3)+'.ts';
  if(modules.has(file))return modules.get(file).exports;
  const module={exports:{}};modules.set(file,module);
  const require=name=>{assert.match(name,/^\.\.?\//,'The Notes browser path must not load host dependencies');return load(path.resolve(path.dirname(file),name));};
  vm.runInNewContext(compile(file),{...globals,exports:module.exports,module,require},{filename:file});
  return module.exports;
 };
 const phases=[],snapshots=[],requests=[];let observedSignal;
 const port={sessionId:'s',identity:{ownerId:'o',agentId:'a',sessionId:'s',origin:'native'},current:()=>true,request:async(path,method,body,signal)=>{requests.push({path,method,body});observedSignal=signal;if(wait)return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));return {success:true,data:{notes:[],revision:1}};}};
 const {CanonicalNotesController}=load('apps/app/src/prototype/canonical-notes-controller.ts');
 const controller=new CanonicalNotesController(port,{phase:value=>phases.push(value),snapshot:value=>snapshots.push(value)});
 return {controller,port,phases,snapshots,requests,signal:()=>observedSignal};
}
test('Notes reaches ready and dispatches exactly once without AbortSignal.any',async()=>{const f=fixture();await f.controller.refresh();assert.deepEqual(f.phases,['loading','ready']);assert.equal(f.requests.length,1);assert.equal(f.requests[0].path,'/api/notes/state');assert.equal(f.controller.revision,1);f.controller.retire();});
test('retiring a pending Notes read still cancels the request on old WebView',async()=>{const f=fixture({wait:true});const pending=f.controller.refresh();await Promise.resolve();assert.equal(f.requests.length,1);f.controller.retire();await assert.rejects(pending);assert.equal(f.signal().aborted,true);assert.equal(f.snapshots.length,0);assert.equal(f.controller.current,false);});
test('retired or rebound Notes controllers cannot attach invalidation listeners',()=>{
 for(const retire of [false,true]){
  const f=fixture(),listeners=new Set(),target={addEventListener:(_name,listener)=>listeners.add(listener),removeEventListener:(_name,listener)=>listeners.delete(listener)};
  f.controller.listen(target);assert.equal(listeners.size,1);
  if(retire)f.controller.retire();else f.port.identity.ownerId='another-owner';
  assert.throws(()=>f.controller.listen(target),{name:'AbortError'});assert.equal(listeners.size,0);assert.equal(f.requests.length,0);
 }
});
test('the affected app-record, automation and reminder paths use the same fallback',()=>{const source=fs.readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8');assert.doesNotMatch(source,/AbortSignal\.any\(/);assert.match(source,/bounded=anyAbortSignal\(\[signal,controller\.signal\]\)/);for(const file of ['agent-calendar-client.ts','owner-reminder-notification-port.ts'])assert.doesNotMatch(fs.readFileSync('apps/app/src/runtime/'+file,'utf8'),/AbortSignal\.any\(/);});
