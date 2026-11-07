import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';
import {registerHooks} from 'node:module';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tsImport} from 'tsx/esm/api';
// Settings > Set up Alpha access on a completed installation is a review: it can be left at once and never re-arms first-run setup.
const BASE=process.env.REQUIRED_SOURCE_ROOT||resolve(import.meta.dirname,'..');
const temp=await mkdtemp(join(tmpdir(),'alpha-access-review-')),bridge=pathToFileURL(join(temp,'bridge.mjs')).href,connection=pathToFileURL(join(temp,'connection.mjs')).href,style=pathToFileURL(join(temp,'style.mjs')).href;
await writeFile(new URL(bridge),`export const Capacitor={getPlatform:()=>'web'};export function registerPlugin(){return new Proxy({},{get:()=>()=>Promise.reject(Error('native port'))});}`);
await writeFile(new URL(connection),`export const connectionController={subscribe:()=>()=>{},getSnapshot:()=>globalThis.reviewConnection};export const googleConnectionController={subscribe:()=>()=>{},getSnapshot:()=>false};`);await writeFile(new URL(style),'export{}');
const hooks=registerHooks({resolve(name,ctx,next){if(name==='@capacitor/core'||name==='./platform-plugins')return {url:bridge,shortCircuit:true};if(/(?:^|\/)(?:google-)?connection-ui(?:\.tsx?)?(?:\?.*)?$/.test(name))return {url:connection,shortCircuit:true};if(name.split('?')[0].endsWith('.css'))return {url:style,shortCircuit:true};return next(name,ctx);}});
const options={parentURL:import.meta.url,tsconfig:join(BASE,'tsconfig.json')};
const {StartupPermissions}=await tsImport(pathToFileURL(BASE+'/apps/app/src/startup-permissions.tsx').href,options),{STARTUP_PERMISSIONS_REOPEN}=await tsImport(pathToFileURL(BASE+'/apps/app/src/startup-permission-flow.ts').href,options),{startupPermissionProgressKey}=await tsImport(pathToFileURL(BASE+'/apps/app/src/startup-permission-progress.ts').href,options);hooks.deregister();test.after(()=>rm(temp,{recursive:true,force:true}));
const completed={version:1,status:'completed',step:4};
async function fixture(t,{durable=null,denied=false,active=true}={}){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://review.invalid',pretendToBeVisual:true}),saved={};for(const key of ['window','document','localStorage','sessionStorage','Event','CustomEvent','navigator','Notification','IS_REACT_ACT_ENVIRONMENT','reviewConnection'])saved[key]=Object.getOwnPropertyDescriptor(globalThis,key);
 for(const [key,value]of Object.entries({window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,IS_REACT_ACT_ENVIRONMENT:true,reviewConnection:{cloudAccount:{credentialId:'fixture'},open:false}}))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const granted=denied?'denied':'granted',calls=[];
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'Alpha access review fixture',permissions:{async query(){return {state:granted};}},mediaDevices:{async getUserMedia(input){calls.push({kind:'media',input});return {getTracks:()=>[{stop(){}}]};}},geolocation:{getCurrentPosition(ok){calls.push({kind:'location'});ok({coords:{latitude:1,longitude:1}});}}}});
 Object.defineProperty(globalThis,'Notification',{configurable:true,value:{get permission(){return granted;},async requestPermission(){calls.push({kind:'notifications-request'});return granted;}}});
 if(durable)localStorage.setItem(startupPermissionProgressKey,JSON.stringify(durable));
 const {createRoot}=await import('react-dom/client');let root=createRoot(document.getElementById('root'));const render=()=>React.act(async()=>root.render(React.createElement(StartupPermissions,{active})));await render();
 t.after(async()=>{await React.act(async()=>root.unmount());dom.window.close();for(const [key,value]of Object.entries(saved)){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}});
 const button=name=>[...document.querySelectorAll('button')].find(x=>x.textContent===name);
 return {calls,dialog:()=>document.querySelector('dialog'),heading:()=>document.querySelector('h2')?.textContent,button,buttons:()=>[...document.querySelectorAll('button')].map(x=>x.textContent),click:async name=>{const n=button(name);assert(n,`Missing ${name}; ${document.body.textContent}`);await React.act(async()=>n.click());},progress:()=>JSON.parse(localStorage.getItem(startupPermissionProgressKey)||'null'),cancel:async()=>React.act(async()=>document.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel',{cancelable:true}))),back:async()=>React.act(async()=>dom.window.dispatchEvent(new dom.window.Event('alpha-back',{cancelable:true}))),reopen:async permission=>React.act(async()=>dom.window.dispatchEvent(permission?new dom.window.CustomEvent(STARTUP_PERMISSIONS_REOPEN,{detail:{permission}}):new dom.window.Event(STARTUP_PERMISSIONS_REOPEN))),remount:async()=>{await React.act(async()=>root.unmount());root=createRoot(document.getElementById('root'));await render();}};
}
test('Settings review of completed setup closes at once by button, Escape or back and never rewrites completion',async t=>{
 const f=await fixture(t,{durable:completed});assert.equal(f.dialog(),null);
 await f.reopen();assert.equal(f.heading(),'Notifications');assert.deepEqual(f.buttons(),['Continue','Close']);assert.deepEqual(f.progress(),completed);
 await f.click('Continue');assert.equal(f.heading(),'Microphone');assert.deepEqual(f.progress(),completed);
 await f.click('Close');assert.equal(f.dialog(),null);assert.deepEqual(f.progress(),completed);
 await f.reopen();assert.equal(f.heading(),'Notifications');await f.cancel();assert.equal(f.dialog(),null);
 await f.reopen();await f.back();assert.equal(f.dialog(),null);assert.deepEqual(f.progress(),completed);
 await f.remount();assert.equal(f.dialog(),null);assert.equal(f.calls.length,0);
});
test('Settings review can also be left from Ready, and finishing it keeps completion',async t=>{
 const f=await fixture(t,{durable:completed});await f.reopen();for(let i=0;i<4;i++)await f.click('Continue');assert.equal(f.heading(),'You’re all set');await f.cancel();assert.equal(f.dialog(),null);
 await f.reopen();for(let i=0;i<4;i++)await f.click('Continue');await f.click('Go to Alpha');assert.equal(f.dialog(),null);assert.deepEqual(f.progress(),completed);await f.remount();assert.equal(f.dialog(),null);
});
test('a targeted review of completed setup closes on Escape without rewriting completion',async t=>{
 const f=await fixture(t,{durable:completed});await f.reopen('camera');assert.equal(f.heading(),'Camera');assert(!f.button('Close'));await f.cancel();assert.equal(f.dialog(),null);assert.deepEqual(f.progress(),completed);
});
test('an unfinished walkthrough reopened from Settings stays required: no Close, Escape and back keep it open',async t=>{
 const f=await fixture(t,{active:false});assert.equal(f.dialog(),null);await f.reopen();assert.equal(f.heading(),'Notifications');assert.deepEqual(f.buttons(),['Continue']);
 await f.cancel();await f.back();assert.equal(f.heading(),'Notifications');assert.deepEqual(f.progress(),{version:1,status:'pending',step:0});
});
test('blocked browser access only mentions skipping once Skip for now is on screen',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=await fixture(t,{denied:true});
 await f.click('Check access');assert.match(document.body.textContent,/Access is still off\. Change it using the site controls\./);assert.doesNotMatch(document.body.textContent,/skip this step/);assert(!f.button('Skip for now'));
 await React.act(async()=>t.mock.timers.tick(20000));assert(f.button('Skip for now'));
});
