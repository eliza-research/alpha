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
 let native=callback,statusGate=null;
 globalThis.__delegationNative={
  addListener:async(_e,fn)=>{listeners.push(fn);return{remove(){}};},
  readDelegationCallback:async()=>({callback:native??null}),
  clearDelegationCallback:async({state:s})=>{calls.push(['clearNative',s]);if(native?.state===s)native=null;},
 };
 globalThis.__delegationStore={
  read:async slot=>slots.get(slot)??null,
  compareExchange:async(slot,expected,next)=>{if(JSON.stringify(slots.get(slot)??null)!==JSON.stringify(expected))return{status:'conflict'};if(next)slots.set(slot,next);else slots.delete(slot);return{status:'saved'};},
 };
 const client={delegation:async(kind,input)=>{calls.push([kind,input.state??null]);if(kind==='revocations')return{grants:[]};if(kind==='status'){if(statusGate)await statusGate;return status(input,calls);}return{};}};
 return{calls,slots,client,deliver(value){native=value;for(const fn of listeners)fn();},hold(){let release;statusGate=new Promise(r=>release=r);return()=>{statusGate=null;release();};},get native(){return native;}};
}
async function mount(f,run){
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});const keys=['window','document','HTMLElement','IS_REACT_ACT_ENVIRONMENT'],saved={};
 for(const k of keys){saved[k]=Object.getOwnPropertyDescriptor(globalThis,k);Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:k==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[k]});}
 const {CloudDelegationPanel}=await import(pathToFileURL(file).href),{createRoot}=await import('react-dom/client');
 const container=document.getElementById('root'),r=createRoot(container),signal=new AbortController().signal;
 try{await act(async()=>r.render(React.createElement(CloudDelegationPanel,{client:f.client,scope:'email',signal,current:()=>true,onConnected(){}})));await settle();await run(()=>container.textContent);}
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
  const check=[...document.querySelectorAll('button')].find(b=>b.textContent==='Refresh');
  await act(async()=>check.click());
  await act(async()=>f.deliver({state,code:'c1'}));
  release();await settle();
  assert.deepEqual(f.calls.filter(c=>c[0]==='complete'),[['complete',state]]);
  assert.match(text(),/Connected/);
  assert.equal(f.native,null);assert.equal(f.slots.size,0);
 });
});
test('an expired record clears the native return',async()=>{
 const record={state,authUrl:'https://cloud.example/app-auth/authorize?state='+state,expiresAt:new Date(Date.now()-1000).toISOString(),phase:'waiting'};
 const f=fixture({record,callback:{state,code:'c1'},status:()=>({status:'waiting'})});
 await mount(f,async text=>{
  assert.match(text(),/Expired/);
  assert.deepEqual(f.calls.filter(c=>c[0]==='clearNative'),[['clearNative',state]]);
  assert.equal(f.calls.filter(c=>c[0]==='complete').length,0);
 });
});
test('a return with no pending record here says nothing about another account and stays in the slot',async()=>{
 const f=fixture({callback:{state:other,code:'c2'},status:()=>({status:'waiting'})});
 await mount(f,async text=>{
  assert.doesNotMatch(text(),/Wrong account/);
  assert.match(text(),/Expires in 7 days/);
  assert.deepEqual(f.native,{state:other,code:'c2'});
  assert.equal(f.calls.filter(c=>c[0]==='clearNative').length,0);
 });
});
test('a finished status releases the native return for that state',async()=>{
 const record={state,authUrl:'https://cloud.example/app-auth/authorize?state='+state,expiresAt:future(),phase:'waiting'};
 const f=fixture({record,status:()=>({status:'failed'})});
 await mount(f,async text=>{
  const check=[...document.querySelectorAll('button')].find(b=>b.textContent==='Refresh');
  await act(async()=>check.click());await settle();
  assert.match(text(),/Expired/);
  assert.deepEqual(f.calls.filter(c=>c[0]==='clearNative'),[['clearNative',state]]);
 });
});
