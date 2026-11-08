import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';

const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://alpha.invalid'});
const globals={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
const previous=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
for(const [key,value]of Object.entries(globals))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
const {createRoot}=await import('react-dom/client');
after(()=>{dom.window.close();for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});

const code=buildSync({entryPoints:['apps/app/src/runtime/cloud-membership-ui.tsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime'],loader:{'.css':'empty'}}).outputFiles[0].text;
const module={exports:{}};
new Function('require','module','exports',code)(createRequire(import.meta.url),module,module.exports);
const controls=extra=>React.createElement(module.exports.CloudMembershipControls,{balance:'unavailable',busy:false,onRedeem:async()=>false,onAddFunds(){},onRefresh(){},...extra});
async function mountControls(content){
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 await act(async()=>root.render(content));
 return {container,root,close:async()=>{await act(async()=>root.unmount());container.remove();}};
}
async function openControls(content){
 const view=await mountControls(content),{container}=view;
 assert.equal(container.querySelector('input'),null,'approved B without a retained code error starts with one direct code-entry action');
 const buttons=[...container.querySelectorAll('button')].filter(button=>button.textContent==='Enter membership code');assert.ok(buttons.length);
 await act(async()=>{for(const button of buttons)button.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));});
 return view;
}

test('membership code error is shown once and describes its invalid input',async()=>{
 const view=await openControls(controls({}));try{
  await act(async()=>view.root.render(controls({error:'Check this code.'})));
  const input=view.container.querySelector('input'),id=input.getAttribute('aria-describedby'),error=document.getElementById(id);
  assert.ok(id);assert.equal(error.getAttribute('role'),'alert');assert.equal(error.textContent,'Check this code.');
  assert.equal([...view.container.querySelectorAll('[role="alert"]')].filter(node=>node.textContent==='Check this code.').length,1);
  assert.equal(input.getAttribute('aria-invalid'),'true');assert.equal(document.activeElement,input,'one click exposes and focuses the code field');
  await act(async()=>view.root.render(controls({})));
  assert.equal(input.getAttribute('aria-invalid'),null);assert.equal(input.getAttribute('aria-describedby'),null);assert.equal(view.container.querySelectorAll('[role="alert"]').length,0);
 }finally{await view.close();}
});

test('separate membership forms associate errors with distinct IDs',async()=>{
 const view=await mountControls(React.createElement(React.Fragment,null,controls({error:'First error.'}),controls({error:'Second error.'})));try{
  const ids=[...view.container.querySelectorAll('input')].map(input=>input.getAttribute('aria-describedby'));
  assert.equal(ids.length,2);assert.notEqual(ids[0],ids[1]);
  for(const [index,id]of ids.entries()){const error=document.getElementById(id);assert.equal(error.getAttribute('role'),'alert');assert.equal(error.textContent,index===0?'First error.':'Second error.');}
 }finally{await view.close();}
});
test('retained redemption error exposes and focuses its associated field without submitting',async()=>{
 let redeemed=0;
 const view=await mountControls(controls({error:'Retained code error.',onRedeem:async()=>{redeemed++;return false;}}));try{
  const input=view.container.querySelector('input');assert.ok(input,'the retained error never hides its code field');assert.equal(document.activeElement,input);
  const error=document.getElementById(input.getAttribute('aria-describedby'));assert.equal(error.textContent,'Retained code error.');assert.equal(error.getAttribute('role'),'alert');assert.equal(redeemed,0);
  assert.equal([...view.container.querySelectorAll('button')].some(button=>button.textContent==='Enter membership code'),false,'no extra reveal is needed for a retained error');
 }finally{await view.close();}
});
test('connection failures do not impersonate a redemption error or reveal the code field',async()=>{
 const view=await mountControls(controls({connectionError:'Connection unavailable.'}));try{
  assert.equal(view.container.querySelector('input'),null);assert.equal(view.container.querySelector('[role="alert"]').textContent,'Connection unavailable.');
  assert.equal([...view.container.querySelectorAll('button')].filter(button=>button.textContent==='Enter membership code').length,1);
 }finally{await view.close();}
});
