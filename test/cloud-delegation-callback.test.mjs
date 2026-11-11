import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
import React,{act} from 'react';import {JSDOM} from 'jsdom';import {build} from 'esbuild';
const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(root,'.delegation-callback-test-')),file=path.join(temp,'panel.mjs');
after(()=>fs.rmSync(temp,{recursive:true,force:true}));
// The native plugin and secure store are replaced by per-test in-memory fixtures on globalThis.
await build({entryPoints:[path.join(root,'apps/app/src/runtime/cloud-delegation-ui.tsx')],bundle:true,platform:'node',format:'esm',outfile:file,external:['react','react/jsx-runtime','@capacitor/core'],logLevel:'silent',plugins:[{name:'delegation-fixture',setup(b){
 b.onResolve({filter:/platform-plugins$|native-connection$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path.endsWith('platform-plugins')?'export const registerPlugin=()=>new Proxy({},{get:(_,k)=>globalThis.__delegationNative[k]});':'export const secureConnectionStore=new Proxy({},{get:(_,k)=>globalThis.__delegationStore[k]});export const openConnectionBrowser=async()=>{};'}));
}}]});
const state='s'.repeat(43),other='o'.repeat(43);
function fixture({record,callback,status}){
 const calls=[],listeners=[],slots=new Map();if(record)slots.set('cloud-delegation:v1:email',record);
 let native=callback,statusGate=null,readGate=null,active=true;
 globalThis.__delegationNative={
  addListener:async(_e,fn)=>{listeners.push(fn);return{remove(){}};},
  readDelegationCallback:async()=>({callback:native??null}),
  clearDelegationCallback:async({state:s})=>{calls.push(['clearNative',s]);if(native?.state===s)native=null;},
 };
 globalThis.__delegationStore={
  read:async slot=>{const captured=slots.get(slot)??null;if(readGate){const hold=readGate;readGate=null;hold.entered();await hold.promise;}return captured;},
  compareExchange:async(slot,expected,next)=>{if(JSON.stringify(slots.get(slot)??null)!==JSON.stringify(expected))return{status:'conflict'};if(next)slots.set(slot,next);else slots.delete(slot);return{status:'saved'};},
 };
 const client={delegation:async(kind,input)=>{calls.push([kind,input.state??null]);if(kind==='revocations')return{grants:[]};if(kind==='status'){if(statusGate)await statusGate;return status(input,calls);}return{};}};
 return{calls,slots,client,deliver(value){native=value;for(const fn of listeners)fn();},hold(){let release;statusGate=new Promise(r=>release=r);return()=>{statusGate=null;release();};},
  holdRead(){let entered,release;const waiting=new Promise(resolve=>entered=resolve),promise=new Promise(resolve=>release=resolve);readGate={entered,promise};return {waiting,release};},
  current:()=>active,retire(){active=false;},get native(){return native;}};
}
async function mount(f,run){
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});const keys=['window','document','HTMLElement','IS_REACT_ACT_ENVIRONMENT'],saved={};
 for(const k of keys){saved[k]=Object.getOwnPropertyDescriptor(globalThis,k);Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:k==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[k]});}
 const {CloudDelegationPanel}=await import(pathToFileURL(file).href),{createRoot}=await import('react-dom/client');
 const container=document.getElementById('root'),r=createRoot(container),signal=new AbortController().signal;
 try{await act(async()=>r.render(React.createElement(CloudDelegationPanel,{client:f.client,scope:'email',signal,current:f.current,onConnected(){}})));await settle();await run(()=>container.textContent,(scope,client=f.client)=>act(async()=>r.render(React.createElement(CloudDelegationPanel,{client,scope,signal,current:f.current,onConnected(){}}))));}
 finally{await act(async()=>r.unmount());dom.window.close();for(const [k,v] of Object.entries(saved)){if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];}}
}
const settle=()=>act(async()=>{for(let i=0;i<20;i++)await new Promise(r=>setTimeout(r,0));});
const future=()=>new Date(Date.now()+600000).toISOString();

test('a return that arrives while a status request runs is consumed after it',async()=>{
 const record={state,authUrl:'https://cloud.example/app-auth/authorize?state='+state,expiresAt:future(),phase:'waiting'};
 const f=fixture({record,status:({},calls)=>calls.filter(c=>c[0]==='complete').length?{status:'complete',grantId:'g1'}:{status:'waiting'}});
 await mount(f,async text=>{
  assert.equal(f.calls.filter(c=>c[0]==='status').length,0);
  const release=f.hold();
  const check=[...document.querySelectorAll('button')].find(b=>b.textContent==='Check authorization status');
  await act(async()=>check.click());
  await act(async()=>f.deliver({state,code:'c1'}));
  release();await settle();
  assert.deepEqual(f.calls.filter(c=>c[0]==='complete'),[['complete',state]]);
  assert.match(text(),/Cloud read access is connected/);
  assert.equal(f.native,null);assert.equal(f.slots.size,0);
 });
});
test('an expired record clears the native return',async()=>{
 const record={state,authUrl:'https://cloud.example/app-auth/authorize?state='+state,expiresAt:new Date(Date.now()-1000).toISOString(),phase:'waiting'};
 const f=fixture({record,callback:{state,code:'c1'},status:()=>({status:'waiting'})});
 await mount(f,async text=>{
  assert.match(text(),/Authorization expired/);
  assert.deepEqual(f.calls.filter(c=>c[0]==='clearNative'),[['clearNative',state]]);
  assert.equal(f.calls.filter(c=>c[0]==='complete').length,0);
 });
});
test('a return with no pending record here says nothing about another account and stays in the slot',async()=>{
 const f=fixture({callback:{state:other,code:'c2'},status:()=>({status:'waiting'})});
 await mount(f,async text=>{
  assert.doesNotMatch(text(),/another account/);
  assert.match(text(),/Allow this agent to read selected Google data/);
  assert.deepEqual(f.native,{state:other,code:'c2'});
  assert.equal(f.calls.filter(c=>c[0]==='clearNative').length,0);
 });
});
test('a finished status releases the native return for that state',async()=>{
 const record={state,authUrl:'https://cloud.example/app-auth/authorize?state='+state,expiresAt:future(),phase:'waiting'};
 const f=fixture({record,status:()=>({status:'failed'})});
 await mount(f,async text=>{
  const check=[...document.querySelectorAll('button')].find(b=>b.textContent==='Check authorization status');
  await act(async()=>check.click());await settle();
  assert.match(text(),/expired or was cancelled/);
  assert.deepEqual(f.calls.filter(c=>c[0]==='clearNative'),[['clearNative',state]]);
 });
});
test('a callback secure read that outlives its owner cannot consume the native return or stage its code',async()=>{
 const record={state,authUrl:'https://cloud.example/app-auth/authorize?state='+state,expiresAt:future(),phase:'waiting'};
 const f=fixture({record,status:()=>({status:'waiting'})});
 await mount(f,async()=>{
  const held=f.holdRead();
  await act(async()=>{f.deliver({state,code:'synthetic-return'});await held.waiting;});
  f.retire();held.release();await settle();
  assert.deepEqual(f.slots.get('cloud-delegation:v1:email'),record);
  assert.deepEqual(f.native,{state,code:'synthetic-return'});
  assert.ok(!f.calls.some(([kind])=>['clearNative','complete','status'].includes(kind)));
 });
});
test('status lookup cannot complete a replaced same-scope authorization',async()=>{
 const record={state,authUrl:'https://cloud.example/app-auth/authorize?state='+state,expiresAt:future(),phase:'finishing',code:'synthetic-return'};
 const f=fixture({record,status:()=>({status:'waiting'})});
 await mount(f,async()=>{
  const release=f.hold();
  const check=[...document.querySelectorAll('button')].find(b=>b.textContent==='Check authorization status');
  await act(async()=>check.click());
  const replacement={...record,state:other,phase:'waiting',code:undefined};
  f.slots.set('cloud-delegation:v1:email',replacement);
  release();await settle();
  assert.deepEqual(f.slots.get('cloud-delegation:v1:email'),replacement);
  assert.ok(!f.calls.some(([kind])=>kind==='complete'));
 });
});

const button=label=>[...document.querySelectorAll('button')].find(b=>b.textContent===label);
test('an authorization whose completion never arrived can still be cancelled',async()=>{
 const record={state,authUrl:'https://cloud.example/app-auth/authorize?state='+state,expiresAt:future(),phase:'finishing',code:'c1'};
 const f=fixture({record,status:()=>({status:'waiting'})});
 await mount(f,async text=>{
  const cancel=button('Cancel authorization');
  assert.equal(cancel.disabled,false);
  await act(async()=>cancel.click());await settle();
  assert.match(text(),/Authorization cancelled/);
  // Cloud's state is read first; the code is not sent again by Cancel.
  assert.deepEqual(f.calls.filter(c=>c[0]==='status'||c[0]==='cancel'||c[0]==='complete').map(c=>c[0]),['status','cancel']);
  assert.equal(f.slots.size,0);
 });
});
test('cancelling an authorization Cloud already completed adopts the grant instead',async()=>{
 const record={state,authUrl:'https://cloud.example/app-auth/authorize?state='+state,expiresAt:future(),phase:'finishing',code:'c1'};
 const f=fixture({record,status:()=>({status:'complete',grantId:'g1'})});
 await mount(f,async text=>{
  await act(async()=>button('Cancel authorization').click());await settle();
  assert.match(text(),/Cloud read access is connected/);
  assert.equal(f.calls.filter(c=>c[0]==='cancel').length,0);
  assert.equal(f.slots.size,0);
 });
});
test('cancelling while Cloud is still finishing leaves the authorization pending',async()=>{
 const record={state,authUrl:'https://cloud.example/app-auth/authorize?state='+state,expiresAt:future(),phase:'finishing',code:'c1'};
 const f=fixture({record,status:()=>({status:'finishing'})});
 await mount(f,async text=>{
  await act(async()=>button('Cancel authorization').click());await settle();
  assert.match(text(),/Cloud is finishing authorization/);
  assert.equal(f.calls.filter(c=>c[0]==='cancel').length,0);
  assert.equal(f.slots.size,1);
 });
});
test('a revoke outcome survives a failed list read, and a grant is not shown for another account',async()=>{
 const record={state,authUrl:'https://cloud.example/app-auth/authorize?state='+state,expiresAt:future(),phase:'waiting'};
 const f=fixture({record,status:()=>({status:'complete',grantId:'g1'})});
 await mount(f,async(text,rescope)=>{
  await act(async()=>button('Check authorization status').click());await settle();
  assert.ok(button('Revoke this Cloud read grant'));
  await rescope('calendar');await settle();
  assert.equal(button('Revoke this Cloud read grant'),undefined);
 });
 const g=fixture({record,status:()=>({status:'complete',grantId:'g1'})});
 await mount(g,async text=>{
  await act(async()=>button('Check authorization status').click());await settle();
  const base=g.client.delegation;
  g.client.delegation=async(kind,input)=>{if(kind==='revocations')throw Error('offline');if(kind==='revoke')return{remoteRevocation:'confirmed'};return base(kind,input);};
  await act(async()=>button('Revoke this Cloud read grant').click());await settle();
  assert.match(text(),/Cloud read access revoked/);
  assert.doesNotMatch(text(),/not confirmed/);
 });
});

test('a status answer retained across a scope change cannot adopt the previous scope grant',async()=>{
 const record={state,authUrl:'https://cloud.example/app-auth/authorize?state='+state,expiresAt:future(),phase:'finishing',code:'c1'};
 const f=fixture({record,status:()=>({status:'complete',grantId:'old-scope-grant'})});
 await mount(f,async(text,rescope)=>{
  const release=f.hold();
  await act(async()=>button('Check authorization status').click());
  await rescope('calendar');await settle();
  release();await settle();
  assert.equal(button('Revoke this Cloud read grant'),undefined);
  assert.deepEqual(f.slots.get('cloud-delegation:v1:email'),record);
 });
});

test('a status answer retained across a client replacement cannot adopt the retired client grant',async()=>{
 const record={state,authUrl:'https://cloud.example/app-auth/authorize?state='+state,expiresAt:future(),phase:'finishing',code:'c1'};
 const f=fixture({record,status:()=>({status:'complete',grantId:'old-client-grant'})});
 await mount(f,async(text,rescope)=>{
  const release=f.hold();
  await act(async()=>button('Check authorization status').click());
  await rescope('email',{...f.client});await settle();
  release();await settle();
  assert.equal(button('Revoke this Cloud read grant'),undefined);
  assert.deepEqual(f.slots.get('cloud-delegation:v1:email'),record);
 });
});
