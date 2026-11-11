import fs from 'node:fs';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';

// Both recovery screens with a stubbed Capacitor: no device, WebView or Settings activity.
// jsdom cannot navigate: a Reload tap shows up as its 'not implemented' report.
const reloads=[];
const {VirtualConsole}=await import('jsdom');
const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>{if(/navigation|reload/i.test(error.message))reloads.push(error.message);});
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://alpha.invalid',virtualConsole});
const globals={window:dom.window,location:dom.window.location,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
const previous=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
for(const [key,value]of Object.entries(globals))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
const {createRoot}=await import('react-dom/client');
after(()=>{dom.window.close();for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});

const code=buildSync({entryPoints:['apps/app/src/runtime/error-boundary.tsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime','@capacitor/core'],define:{'import.meta.env':'{}',__APP_VERSION__:'"test"'},loader:{'.css':'empty'}}).outputFiles[0].text;
const HOME='Switch Home';
const settle=()=>act(async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setTimeout(resolve,0));});

/** A fresh module per case: showRecoveryScreen shows once per page. */
function load({native=true,available=true,launcher=true,open=async()=>{}}={}){
 const calls={open:0,reload:0};
 const plugin=name=>new Proxy({},{get:(_,method)=>{
  if(method==='then')return undefined;
  if(name==='ElizaSystem'&&method==='getBuildInfo')return async()=>({launcher});
  if(name==='DeviceApps'&&method==='openHomeChooser')return()=>{calls.open++;return open();};
  return async()=>undefined;
 }});
 const Capacitor={isNativePlatform:()=>native,getPlatform:()=>native?'android':'web',isPluginAvailable:name=>available&&name==='DeviceApps'};
 const base=createRequire(import.meta.url);
 const require=id=>id==='@capacitor/core'?{Capacitor,registerPlugin:plugin}:base(id);
 const module={exports:{}};
 new Function('require','module','exports',code)(require,module,module.exports);
 return {exports:module.exports,calls};
}
const buttons=root=>[...root.querySelectorAll('button')].map(button=>button.textContent);
const click=button=>button.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));

async function startupScreen(options){
 const {exports,calls}=load(options);
 exports.showRecoveryScreen('startup',new TypeError('boom'));
 await settle();
 const screen=document.querySelector('.alpha-recovery');assert.ok(screen);
 return {screen,calls,close:()=>{screen.remove();for(const node of document.body.children)node.inert=false;}};
}
async function renderScreen(options){
 const {exports,calls}=load(options);
 const Broken=()=>{throw new Error('render failed');};
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container,{onCaughtError(){}});
 await act(async()=>root.render(React.createElement(exports.RootErrorBoundary,null,React.createElement(Broken))));
 await settle();
 const screen=container.querySelector('.alpha-recovery');assert.ok(screen);
 return {screen,calls,close:async()=>{await act(async()=>root.unmount());container.remove();}};
}

for(const [name,mount]of [['startup recovery',startupScreen],['render recovery',renderScreen]]){
 test(`${name} offers a way out of HOME on a launcher build, after Reload`,async()=>{
  const view=await mount();try{
   assert.deepEqual(buttons(view.screen),['Reload',HOME]);
   click([...view.screen.querySelectorAll('button')].find(button=>button.textContent===HOME));
   assert.equal(view.calls.open,1,'the tap asks Android for the Home chooser');
  }finally{await view.close();}
 });
 test(`${name} keeps Reload alone off a launcher build`,async()=>{
  for(const options of [{launcher:false},{native:false},{available:false}]){
   const view=await mount(options);try{
    assert.deepEqual(buttons(view.screen),['Reload'],JSON.stringify(options));
    assert.equal(view.calls.open,0);
   }finally{await view.close();}
  }
 });
 test(`${name} keeps Reload working when the Home chooser fails`,async()=>{
  for(const open of [async()=>{throw new Error('No Home or Settings screen');},()=>{throw new Error('plugin missing');}]){
   const view=await mount({open});try{
    click([...view.screen.querySelectorAll('button')].find(button=>button.textContent===HOME));
    await settle();
    assert.equal(view.calls.open,1);
    const reload=[...view.screen.querySelectorAll('button')].find(button=>button.textContent==='Reload');
    assert.ok(reload?.isConnected,'Reload stays on screen');
    const before=reloads.length;await act(async()=>click(reload));
    assert.equal(reloads.length,before+1,'Reload still reloads the page');
   }finally{await view.close();}
  }
 });
}


test("native Home chooser honors the existing foreground launch fence",()=>{const native=fs.readFileSync("android/app/src/main/java/ai/alphacompute/alphaphone/AlphaDeviceAppsPlugin.java","utf8");assert.match(native,/LateLaunch\.ask\(call,\(\)->/);});
