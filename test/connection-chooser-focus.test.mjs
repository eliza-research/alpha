import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React, {act} from 'react';
import {JSDOM} from 'jsdom';
import {stripTypeScriptTypes} from 'node:module';
import {execFileSync} from 'node:child_process';
const baseline=process.env.ALPHA_FOCUS_BASELINE==='1';
const source=baseline?execFileSync('git',['show','51bcc46d4338ed4363739a751302a6cd6778e41c:apps/app/src/runtime/connection-ui.tsx'],{cwd:new URL('..',import.meta.url),encoding:'utf8'}):readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const start=source.indexOf('  useEffect(() => {\n    if (!visible) return;\n    const previous = document.activeElement');
const end=source.indexOf('  const env = (): CloudEnvironment',start);
assert.ok(start>=0&&end>start);
const inert=stripTypeScriptTypes(readFileSync(new URL('../apps/app/src/runtime/modal-inert.ts',import.meta.url),'utf8').replace('export function','function'),{mode:'transform'});
const effects=stripTypeScriptTypes(source.slice(start,end),{mode:'transform'});
const make=new Function('React','useRef','useEffect','holdPhoneInert','connectionController',`return function Chooser({visible,snapshot}){const panel=useRef(null);${effects};return visible?React.createElement('div',{role:'dialog',tabIndex:-1,ref:panel},React.createElement('input',{'aria-label':'Email'})):null;}`);
const hold=new Function(inert+';return holdPhoneInert;')();
async function fixture(run){
 const dom=new JSDOM('<div class="os"><button id="opener">Sign in</button></div><div id="root"></div>',{url:'http://localhost/'});
 const saved={};for(const key of ['window','document','HTMLElement','getComputedStyle','IS_REACT_ACT_ENVIRONMENT']){saved[key]=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:key==='getComputedStyle'?dom.window.getComputedStyle.bind(dom.window):dom.window[key]});}
 const {createRoot}=await import('react-dom/client');const root=createRoot(document.getElementById('root'));const calls=[];let snapshot={busy:false,purpose:'cloud-account',billingReviewEmail:undefined};
 const Chooser=make(React,React.useRef,React.useEffect,hold,{getSnapshot:()=>snapshot,cancelSignIn:()=>calls.push('signIn'),cancel:()=>calls.push('cancel'),close:()=>calls.push('close')});
 const opener=document.getElementById('opener');opener.focus();let restores=0;const focus=opener.focus.bind(opener);opener.focus=()=>{restores++;focus();};
 const render=async(patch={},visible=true)=>{snapshot={...snapshot,...patch};await act(()=>root.render(React.createElement(Chooser,{visible,snapshot})));};
 let unmounted=false;try{await render();await run({render,opener,calls,get restores(){return restores;},unmount:async()=>{await act(()=>root.unmount());unmounted=true;}});}finally{if(!unmounted)await act(()=>root.unmount());dom.window.close();for(const [k,v]of Object.entries(saved)){if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];}}
}
test('actual chooser effects retain focused input across busy, purpose and billing updates',async()=>fixture(async f=>{
 const input=document.querySelector('input');input.focus();
 for(const change of [{busy:true},{busy:false},{purpose:'plan'},{billingReviewEmail:'owner@example.invalid'},{billingReviewEmail:'other@example.invalid'}]){
  await f.render(change);assert.ok(document.activeElement===input,'Focused input must remain active');assert.equal(f.restores,0);assert.equal(document.querySelector('.os').inert,true);
 }
 await f.render({},false);assert.ok(document.activeElement===f.opener,'Original opener must regain focus');assert.equal(f.restores,1);assert.notEqual(document.querySelector('.os').inert,true);
}));
test('unmount restores the opening control once and refreshed Escape handler uses current busy state',async()=>fixture(async f=>{
 document.querySelector('input').focus();await f.render({busy:true});
 document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.deepEqual(f.calls,['cancel']);assert.equal(f.restores,0);
 await f.unmount();assert.ok(document.activeElement===f.opener,'Original opener must regain focus');assert.equal(f.restores,1);
}));
