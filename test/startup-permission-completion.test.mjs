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
const BASE=process.env.REQUIRED_SOURCE_ROOT||resolve(import.meta.dirname,'..');
const temp=await mkdtemp(join(tmpdir(),'alpha-required-onboarding-')),bridge=pathToFileURL(join(temp,'bridge.mjs')).href,connection=pathToFileURL(join(temp,'connection.mjs')).href,style=pathToFileURL(join(temp,'style.mjs')).href;
await writeFile(new URL(bridge),`export const Capacitor={getPlatform:()=>globalThis.requiredPlatform||'web'};export function registerPlugin(name){return new Proxy({},{get:(_,method)=>(...args)=>globalThis.requiredPorts[name][method](...args)});}`);
await writeFile(new URL(connection),`export const connectionController={subscribe:()=>()=>{},getSnapshot:()=>globalThis.requiredConnection};const listeners=new Set();globalThis.requiredGoogleListeners=listeners;export const googleConnectionController={subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},getSnapshot:()=>globalThis.requiredGoogle===true};`);await writeFile(new URL(style),'export{}');
const hooks=registerHooks({resolve(name,ctx,next){if(name==='@capacitor/core'||name==='./platform-plugins')return {url:bridge,shortCircuit:true};if(/(?:^|\/)(?:google-)?connection-ui(?:\.tsx?)?(?:\?.*)?$/.test(name))return {url:connection,shortCircuit:true};if(name.split('?')[0].endsWith('.css'))return {url:style,shortCircuit:true};return next(name,ctx);}});
const options={parentURL:import.meta.url,tsconfig:join(BASE,'tsconfig.json')};
const {StartupPermissions}=await tsImport(pathToFileURL(BASE+'/apps/app/src/startup-permissions.tsx').href,options),{browserStartupPermission}=await tsImport(pathToFileURL(BASE+'/apps/app/src/startup-browser-permissions.ts').href,options),{readStartupPermissionProgress,writeStartupPermissionProgress,startupPermissionProgressKey}=await tsImport(pathToFileURL(BASE+'/apps/app/src/startup-permission-progress.ts').href,options),{STARTUP_PERMISSIONS_REOPEN}=await tsImport(pathToFileURL(BASE+'/apps/app/src/startup-permission-flow.ts').href,options);hooks.deregister();test.after(()=>rm(temp,{recursive:true,force:true}));
async function fixture(t,{native=false,denied=false,unsupported=false,legacy=null,durable=null,writeFailure=false,badLocation=false,deniedLocation=false,deniedFiles=false,review=false,connection={},active=true,deferStatus=false}={}){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://required.invalid',pretendToBeVisual:true}),saved={};for(const key of ['window','document','localStorage','sessionStorage','Event','CustomEvent','dispatchEvent','navigator','Notification','IS_REACT_ACT_ENVIRONMENT','requiredPlatform','requiredPorts','requiredConnection','requiredGoogle'])saved[key]=Object.getOwnPropertyDescriptor(globalThis,key);
 for(const [key,value]of Object.entries({window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,dispatchEvent:e=>dom.window.dispatchEvent(e),IS_REACT_ACT_ENVIRONMENT:true,requiredPlatform:native?'android':'web',requiredGoogle:false,requiredConnection:{cloudAccount:{credentialId:'fixture',email:'owner@example.invalid'},open:false,...connection}}))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const state={notifications:true,microphone:true,camera:true,location:!deniedLocation,calendar:true,photos:'selected',files:deniedFiles?'denied':'granted',accuracy:badLocation?'invalid':'approximate'},calls=[],held=[],resumed=[];
 let holding=false;const read=value=>holding?new Promise(done=>held.push(()=>done(value))):value;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'Alpha required onboarding fixture',permissions:{async query({name}){return {state:state[name==='geolocation'?'location':name]?'granted':'denied'};}},mediaDevices:{async getUserMedia(input){calls.push({kind:'media',input});return {getTracks:()=>[{stop(){calls.push({kind:'track-stop'});}}]};}},geolocation:{getCurrentPosition(ok){calls.push({kind:'location'});ok({coords:{latitude:1,longitude:1}});}}}});
 Object.defineProperty(globalThis,'Notification',{configurable:true,value:unsupported?{}:{get permission(){return typeof state.notifications==='string'?state.notifications:state.notifications?'granted':'denied';},async requestPermission(){calls.push({kind:'notifications-request'});return state.notifications?'granted':'denied';}}});
 globalThis.requiredPorts={AlphaNotifications:{async status(){return read({permissionGranted:state.notifications,appEnabled:state.notifications});}},DailyApps:{async checkPermissions(){return read({camera:state.camera?'granted':'denied'});},async requestPermissions(input){calls.push({kind:'native-request',input});},async addListener(event,fn){if(event==='appResumed')resumed.push(fn);return {async remove(){}};}},AlphaVoiceCloud:{async checkPermissions(){return read({microphone:state.microphone?'granted':'denied'});},async requestPermissions(input){calls.push({kind:'native-request',input});}},ElizaLocation:{async checkPermissions(){return read({location:state.location?'granted':'denied',accuracy:state.location?state.accuracy:'none'});},async requestPermissions(){calls.push({kind:'native-location'});}},AlphaCalendar:{async checkPermissions(){return read({calendar:state.calendar?'granted':'denied'});},async requestAccess(){calls.push({kind:'calendar-access'});}},AlphaPhotoLibrary:{async scope(){return read({scope:state.photos,locked:false});},async requestAccess(){calls.push({kind:'photos-access'});}},AlphaDevice:{async openSettings(input){calls.push({kind:'settings',input});}},AlphaFiles:{async storageState(){return read({status:'ready',access:state.files});},async storageRequestAccess(options){calls.push({kind:'files-access',options});if(state.grantFilesOnReturn)state.files='granted';return read({status:'ready',access:state.files});}}};
 if(denied)state.notifications=false;
 if(legacy)sessionStorage.setItem('alpha:startup-permission-progress:v1',JSON.stringify(legacy));if(durable)localStorage.setItem(startupPermissionProgressKey,JSON.stringify(durable));
 localStorage.setItem('alpha.startup-permissions.v1',JSON.stringify({dismissed:true,attempted:{camera:true}}));
 let failures=0;const setItem=dom.window.Storage.prototype.setItem;dom.window.Storage.prototype.setItem=function(key,value){if(key===startupPermissionProgressKey&&(writeFailure||failures>0)){failures--;throw Error('Unavailable');}return setItem.call(this,key,value);};
 const {createRoot}=await import('react-dom/client');let root=createRoot(document.getElementById('root'));const render=()=>root.render(React.createElement(StartupPermissions,{active:review?false:active}));await React.act(async()=>render());if(review)await React.act(async()=>dom.window.dispatchEvent(new dom.window.Event(STARTUP_PERMISSIONS_REOPEN)));holding=deferStatus;
 t.after(async()=>{await React.act(async()=>root.unmount());dom.window.Storage.prototype.setItem=setItem;dom.window.close();for(const [key,value]of Object.entries(saved)){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}});
 const heading=()=>document.querySelector('h2')?.textContent,buttons=()=>[...document.querySelectorAll('button')].map(x=>x.textContent),button=name=>{const n=[...document.querySelectorAll('button')].find(x=>x.textContent===name);assert(n,`Missing ${name}; ${document.body.textContent}`);return n;};
 return {held,buttons,dialog:()=>document.querySelector('dialog'),settle:async reads=>React.act(async()=>{for(const done of reads)done();}),resume:async()=>React.act(async()=>{for(const fn of resumed)fn();document.dispatchEvent(new dom.window.Event('visibilitychange'));}),visibility:async()=>React.act(async()=>document.dispatchEvent(new dom.window.Event('visibilitychange'))),reopen:async permission=>React.act(async()=>dom.window.dispatchEvent(permission?new dom.window.CustomEvent(STARTUP_PERMISSIONS_REOPEN,{detail:{permission}}):new dom.window.Event(STARTUP_PERMISSIONS_REOPEN))),auth:async(patch={})=>React.act(async()=>{globalThis.requiredConnection={...globalThis.requiredConnection,...patch,setupRevision:(globalThis.requiredConnection.setupRevision||0)+1};render();}),setActive:async value=>React.act(async()=>{active=value;render();}),failNextWrite:()=>{failures=1;},google:async value=>React.act(async()=>{globalThis.requiredGoogle=value;for(const fn of globalThis.requiredGoogleListeners)fn();}),state,calls,dom,heading,button,click:async name=>React.act(async()=>button(name).click()),progress:()=>JSON.parse(localStorage.getItem(startupPermissionProgressKey)||'null'),cancel:async()=>React.act(async()=>document.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel',{cancelable:true}))),back:async()=>React.act(async()=>dom.window.dispatchEvent(new dom.window.Event('alpha-back',{cancelable:true}))),open:async permission=>React.act(async()=>dom.window.dispatchEvent(new dom.window.CustomEvent('alpha:startup-permissions-reopen',{detail:{permission}}))),remount:async()=>{await React.act(async()=>root.unmount());root=createRoot(document.getElementById('root'));await React.act(async()=>render());}};
}
test('actual recovered order is required, no Skip/Not now/Back/footer/count, then Ready and Home',async t=>{
 const f=await fixture(t);let homes=0;window.addEventListener('launcher-home',()=>homes++);
 for(const title of ['Notifications','Microphone','Camera','Location']){assert.equal(f.heading(),title);assert(![...document.querySelectorAll('button')].some(x=>/Skip|Not now|Back/.test(x.textContent)));assert.equal(document.querySelector('.alpha-startup-header'),null);await f.click('Continue');}
 assert.equal(f.heading(),'Setup finished');assert.equal(f.calls.length,0);await f.click('Go to Alpha');assert.equal(document.querySelector('dialog'),null);assert.equal(homes,1);assert.deepEqual(f.progress(),{version:1,status:'completed',step:4});assert.deepEqual(JSON.parse(localStorage.getItem('alpha.startup-permissions.v1')).attempted,{camera:true});await f.remount();assert.equal(document.querySelector('dialog'),null);
});
test('denied native permission stays on required step, blocks dismissal, and settings never repeats its prompt',async t=>{
 const f=await fixture(t,{native:true,denied:true});assert.equal(f.heading(),'Notifications');await f.click('Allow');assert.equal(f.heading(),'Notifications');assert.equal(document.querySelector('[role=status]').textContent,'Off.');assert.equal(f.calls.filter(x=>x.kind==='native-request').length,1);await f.cancel();await f.back();assert.equal(f.heading(),'Notifications');await f.click('Open Android settings');assert.equal(f.calls.filter(x=>x.kind==='native-request').length,1);assert.equal(f.calls.filter(x=>x.kind==='settings').length,1);assert.equal(f.progress().step,0);
});
test('unsupported browser permission is honest and cannot be skipped or inferred granted',async t=>{const f=await fixture(t,{unsupported:true});assert.equal(f.heading(),'Notifications');assert.match(document.body.textContent,/Could not check/);await f.click('Try again');assert.equal(f.heading(),'Notifications');assert.equal(f.calls.length,0);assert.equal(f.progress().step,0);});
test('a hung browser notification prompt releases Checking without granting access or retrying, and late completion cannot advance setup',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=await fixture(t);let requests=0,complete;
 f.state.notifications='default';
 Notification.requestPermission=()=>{requests++;return new Promise(resolve=>{complete=resolve;});};
 await React.act(async()=>document.dispatchEvent(new f.dom.window.Event('visibilitychange')));
 assert.equal(f.heading(),'Notifications');
 await f.click('Allow');assert.equal(f.button('Checking…').disabled,true);assert.equal(requests,1);
 await React.act(async()=>t.mock.timers.tick(14999));assert.equal(f.button('Checking…').disabled,true);
 await React.act(async()=>t.mock.timers.tick(1));
 assert.equal(f.button('Check access').disabled,false);assert.equal(f.progress().step,0);assert.match(document.body.textContent,/Access is still off/);assert.equal(requests,1);
 await React.act(async()=>complete('granted'));
 assert.equal(f.heading(),'Notifications');assert.equal(f.button('Check access').disabled,false);assert.equal(f.progress().step,0);
 await f.click('Check access');assert.equal(f.heading(),'Notifications');assert.equal(requests,1);
 f.state.notifications=true;await f.click('Check access');
 assert.equal(f.heading(),'Microphone');assert.equal(f.progress().step,1);assert.equal(requests,1);
});
test('durable reviewed progress resumes without reopening an earlier revoked permission',async t=>{const f=await fixture(t);await f.click('Continue');assert.equal(f.progress().step,1);await f.remount();assert.equal(f.heading(),'Microphone');f.state.notifications=false;await f.remount();assert.equal(f.heading(),'Microphone');assert.equal(f.progress().step,1);assert.equal(f.calls.length,0);});
test('legacy skipped choices resume reviewed setup and old session data is preserved',async t=>{const legacy={version:1,step:2,choices:['allowed','skipped']};const f=await fixture(t,{legacy});assert.equal(f.heading(),'Camera');assert.deepEqual(JSON.parse(sessionStorage.getItem('alpha:startup-permission-progress:v1')),legacy);assert.equal(f.progress().step,2);});
test('storage write/readback failure keeps session progress with an honest warning',async t=>{const f=await fixture(t,{writeFailure:true});await f.click('Continue');assert.equal(f.heading(),'Microphone');assert.match(document.body.textContent,/Setup progress could not be saved/);assert.equal(f.calls.length,0);});
test('targeted Settings review has Done and never rewrites completed progress',async t=>{const marker={version:1,status:'completed',step:4};const f=await fixture(t,{durable:marker});assert.equal(document.querySelector('dialog'),null);f.state.camera=false;await f.open('camera');assert.equal(f.heading(),'Camera');await f.click('Done');assert.equal(document.querySelector('dialog'),null);assert.deepEqual(f.progress(),marker);assert.equal(f.calls.length,0);});
test('historical completed v1/v2 installations remain completed with native Calendar/Photos extension',async t=>{for(const version of [1,2]){const marker={version,status:'completed',step:version===1?4:5};assert.deepEqual(readStartupPermissionProgress({getItem:()=>JSON.stringify(marker)},true),marker);}const f=await fixture(t,{native:true,durable:{version:2,status:'completed',step:5}});assert.equal(document.querySelector('dialog'),null);assert.equal(f.calls.length,0);});
test('new native setup advances already-granted access without asking again',async t=>{const f=await fixture(t,{native:true});assert.equal(f.heading(),'Setup finished');await f.click('Go to Alpha');assert.deepEqual(f.progress(),{version:4,status:'completed',step:7});assert.equal(f.calls.length,0);});
test('completed six-step native setup stays completed; unfinished v3 progress continues as v4',async t=>{assert.deepEqual(readStartupPermissionProgress({getItem:()=>JSON.stringify({version:3,status:'completed',step:6})},true),{version:3,status:'completed',step:6});assert.deepEqual(readStartupPermissionProgress({getItem:()=>JSON.stringify({version:3,status:'pending',step:5})},true),{version:4,status:'pending',step:5});const f=await fixture(t,{native:true,durable:{version:3,status:'completed',step:6}});assert.equal(document.querySelector('dialog'),null);assert.equal(f.calls.length,0);});
test('Files opens Android all-files access and reads access back on return',async t=>{const f=await fixture(t,{native:true,deniedFiles:true,durable:{version:4,status:'pending',step:6}});f.state.grantFilesOnReturn=true;await f.remount();assert.equal(f.heading(),'Files');await f.click('Allow');assert.deepEqual(f.calls.map(c=>c.kind),['files-access']);assert.equal(f.heading(),'Setup finished');});
test('Files access denied on return stays on Files and offers Android settings without another prompt',async t=>{const f=await fixture(t,{native:true,deniedFiles:true,durable:{version:4,status:'pending',step:6}});await f.remount();await f.click('Allow');assert.equal(f.heading(),'Files');await f.click('Open Android settings');assert.equal(f.calls.filter(c=>c.kind==='files-access').length,2);assert.deepEqual(f.calls.filter(c=>c.kind==='files-access').map(c=>c.options),[undefined,{settings:true}],'Allow asks (API 29: the storage permission request); the settings action asks for the settings page');assert.equal(f.heading(),'Files');assert.equal(f.progress().step,6);});
test('completed walkthrough stays complete when access changes and never grants platform access',async t=>{const f=await fixture(t);for(let i=0;i<4;i++)await f.click('Continue');assert.equal(f.heading(),'Setup finished');f.state.camera=false;await f.click('Go to Alpha');assert.equal(document.querySelector('dialog'),null);assert.equal(f.progress().status,'completed');assert.equal(f.state.camera,false);assert.equal(f.calls.length,0);});
test('progress writes require exact readback',()=>{let raw=null;assert.throws(()=>writeStartupPermissionProgress({getItem:()=>raw,setItem(){}},{version:1,status:'pending',step:1}),/could not be saved/);});
for(const code of [2,3])test(`original browser location fix preserves permission grant despite provider code ${code}`,async()=>{let state='prompt',requests=0;const flow=browserStartupPermission('location',{permissions:{async query(){return {state};}},geolocation:{getCurrentPosition(_ok,fail){requests++;state='granted';fail({code});}}});await flow.request();assert.equal((await flow.status()).granted,true);assert.equal(requests,1);});
test('original browser camera asks only for camera and stops every track, including cleanup failure',async()=>{const stopped=[];let input;const flow=browserStartupPermission('camera',{media:{async getUserMedia(value){input=value;return {getTracks:()=>[{stop(){stopped.push(1);throw Error('stop');}},{stop(){stopped.push(2);}}]};}}});await assert.rejects(flow.request(),/cleanup/);assert.deepEqual(input,{video:true,audio:false});assert.deepEqual(stopped,[1,2]);});

test('completed installation can explicitly review all permissions without automatic requests or losing Settings context',async t=>{
 const f=await fixture(t,{durable:{version:1,status:'completed',step:4}});let homes=0;window.addEventListener('launcher-home',()=>homes++);assert.equal(document.querySelector('dialog'),null);await f.open(undefined);assert.equal(f.heading(),'Notifications');assert.equal(f.calls.length,0);for(let i=0;i<4;i++)await f.click('Continue');await f.click('Go to Alpha');assert.equal(document.querySelector('dialog'),null);assert.equal(homes,0);assert.equal(f.calls.length,0);
});
test('native approximate location and selected Photos keep their actual access descriptions',async t=>{
 const f=await fixture(t,{native:true,review:true});for(let i=0;i<3;i++)await f.click('Continue');assert.equal(f.heading(),'Location');assert.match(document.body.textContent,/Approximate location allowed/);await f.click('Continue');await f.click('Continue');assert.equal(f.heading(),'Photos');assert.match(document.body.textContent,/Selected photos and videos only/);
});
test('malformed native accuracy cannot be read as a usable location grant',async t=>{const f=await fixture(t,{native:true,badLocation:true});assert.equal(f.heading(),'Location');assert.match(document.body.textContent,/Could not check/);await f.click('Try again');assert.equal(f.heading(),'Location');assert.equal(f.calls.length,0);});

test('Ready retains verified new-account, AI readiness and prior-key revocation warnings without another popup',async t=>{
 const message='Signed in. Eliza Cloud did not confirm revoking the sign-in this phone used before.';const f=await fixture(t,{connection:{accountCreated:true,residentInference:'unknown',message,previousSignInUnconfirmed:true,error:'Cloud binding could not be verified.'}});for(let i=0;i<4;i++)await f.click('Continue');assert.equal(f.heading(),'Setup finished');assert.match(document.body.textContent,/AI connection isn’t confirmed yet\./);assert.match(document.body.textContent,/Account created: owner@example\.invalid\./);assert(document.body.textContent.includes(message));assert.equal(document.querySelectorAll('dialog').length,1);assert.equal(f.calls.length,0);
});

test('Ready while the agent still starts after sign-in makes no AI claim',async t=>{
 // Setup no longer waits for the agent (owner report 2026-10-30): its AI binding is not known yet.
 const starting=await fixture(t,{connection:{residentInference:null}});for(let i=0;i<4;i++)await starting.click('Continue');assert.equal(starting.heading(),'Setup finished');assert.doesNotMatch(document.body.textContent,/AI connection|AI is off|AI needs an active Cloud plan/);
});
test('Ready after saving own API keys makes no false AI-not-ready claim',async t=>{
 // Own Cerebras keys bind the agent's inference directly ('direct'): AI is ready (#772 regression).
 const own=await fixture(t,{connection:{residentInference:'direct'}});for(let i=0;i<4;i++)await own.click('Continue');assert.equal(own.heading(),'You’re all set');assert.doesNotMatch(document.body.textContent,/AI connection|AI is off|AI needs an active Cloud plan/);
});
test('Ready shows a needs-plan admission before the agent that setup no longer waits for has started',async t=>{
 const f=await fixture(t,{connection:{residentInference:null,residentPlanNotice:'needs-plan'}});for(let i=0;i<4;i++)await f.click('Continue');assert.equal(f.heading(),'Setup finished');assert.match(document.body.textContent,/AI needs an active Cloud plan\. Manage it in Settings\./);
});

test('opening an existing Google panel hides required setup and closing it resumes the same step without permission requests',async t=>{
 const f=await fixture(t);await f.click('Continue');assert.equal(f.heading(),'Microphone');const before=f.progress();await f.google(true);assert.equal(document.querySelector('dialog'),null);await f.google(false);assert.equal(f.heading(),'Microphone');assert.deepEqual(f.progress(),before);assert.equal(f.calls.length,0);
});

test('a known denied native location grant goes to Settings and never re-asks without an eligible prompt',async t=>{const f=await fixture(t,{native:true,deniedLocation:true,durable:{version:3,status:'pending',step:3}});assert.equal(f.heading(),'Location');await f.click('Open Android settings');assert.equal(f.calls.filter(x=>x.kind==='native-location').length,0);assert.equal(f.calls.filter(x=>x.kind==='settings').length,1);assert.equal(f.progress().step,3);});

test('explicit sign-in Ready preserves a completed legacy installation without forcing newly added grants',async t=>{
 const marker={version:1,status:'completed',step:4};const f=await fixture(t,{native:true,durable:marker});f.state.calendar=false;f.state.photos='denied';let homes=0;window.addEventListener('launcher-home',()=>homes++);await f.auth();assert.equal(f.heading(),undefined);assert.deepEqual(f.progress(),marker);assert.equal(f.calls.length,0);assert.equal(homes,0);
});


test('blocked access exposes a per-step skip after 20 seconds and completed choices survive refresh and auth',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=await fixture(t,{denied:true});
 assert.equal(document.querySelector('.alpha-permission-skip'),null);
 await f.click('Check access');assert.match(document.body.textContent,/Access is still off\. Change it using the site controls\./);assert.doesNotMatch(document.body.textContent,/skip this step/);
 await React.act(async()=>t.mock.timers.tick(19999));assert.equal(document.querySelector('.alpha-permission-skip'),null);
 await React.act(async()=>t.mock.timers.tick(1));await f.click('Skip for now');
 assert.equal(f.heading(),'Microphone');assert.equal(document.querySelector('.alpha-permission-skip'),null);
 assert.deepEqual(f.progress().choices,['skipped']);
 await f.remount();assert.equal(f.heading(),'Microphone');
 for(let i=0;i<3;i++){await React.act(async()=>t.mock.timers.tick(20000));await f.click('Skip for now');}
 assert.equal(f.heading(),'Setup finished');assert.deepEqual(f.progress().choices,Array(4).fill('skipped'));
 await f.click('Go to Alpha');await f.remount();await f.auth();
 assert.equal(document.querySelector('dialog'),null);assert.equal(f.state.notifications,false);assert.equal(f.calls.length,0);
});
test('skip escapes a pending media request and its late result cannot advance the next step',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=await fixture(t);await f.click('Continue');
 let resolveMedia,stops=0;
 navigator.permissions.query=async({name})=>({state:name==='microphone'?'prompt':'granted'});
 navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>{resolveMedia=resolve;});
 await React.act(async()=>document.dispatchEvent(new f.dom.window.Event('visibilitychange')));
 await f.click('Allow');assert.equal(f.button('Checking…').disabled,true);
 await React.act(async()=>t.mock.timers.tick(20000));await f.click('Skip for now');
 assert.equal(f.heading(),'Camera');assert.equal(f.progress().step,2);
 await React.act(async()=>resolveMedia({getTracks:()=>[{readyState:'live',stop(){stops++;}}]}));
 assert.equal(stops,1);assert.equal(f.heading(),'Camera');assert.equal(f.progress().step,2);assert.equal(f.button('Continue').disabled,false);
});
test('unsupported browser access can be skipped without a grant or a permission request',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=await fixture(t,{unsupported:true});
 assert.match(document.body.textContent,/Could not check/);
 await React.act(async()=>t.mock.timers.tick(20000));await f.click('Skip for now');
 assert.equal(f.heading(),'Microphone');assert.equal(f.progress().choices[0],'skipped');assert.equal(f.calls.length,0);
});
test('blocked storage still allows the timed fallback and never claims durable choices',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=await fixture(t,{writeFailure:true,unsupported:true});
 for(let i=0;i<4;i++){await React.act(async()=>t.mock.timers.tick(20000));await f.click('Skip for now');}
 assert.equal(f.heading(),'Setup finished');assert.match(document.body.textContent,/Could not save setup\. Go to Alpha to try again\./);
 await f.click('Go to Alpha');assert.equal(document.querySelector('dialog'),null);assert.equal(f.calls.length,0);
});

test('a newly created account still gets its Ready notice without reopening completed access steps',async t=>{
 const marker={version:1,status:'completed',step:4};const f=await fixture(t,{durable:marker,connection:{accountCreated:true}});
 await f.auth();assert.equal(f.heading(),'Setup finished');assert.match(document.body.textContent,/Account created/);
 await f.click('Go to Alpha');assert.equal(document.querySelector('dialog'),null);assert.deepEqual(f.progress(),marker);assert.equal(f.calls.length,0);
});

test('targeted Settings review can escape a hung request after20s without rewriting completed setup',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const marker={version:1,status:'completed',step:4};const f=await fixture(t,{durable:marker});
 let resolveMedia,stops=0;navigator.permissions.query=async()=>({state:'prompt'});navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>{resolveMedia=resolve;});
 await f.open('microphone');await f.click('Allow');assert.equal(f.button('Done').disabled,true);
 await React.act(async()=>t.mock.timers.tick(20000));await f.click('Skip for now');assert.equal(document.querySelector('dialog'),null);assert.deepEqual(f.progress(),marker);
 await React.act(async()=>resolveMedia({getTracks:()=>[{readyState:'live',stop(){stops++;}}]}));assert.equal(stops,1);assert.equal(document.querySelector('dialog'),null);assert.deepEqual(f.progress(),marker);
});

for(const [connection,heading,line] of [[{residentInference:'cloud'},'You’re all set',null],[{residentInference:'direct',error:'Cloud binding could not be verified.'},'Setup finished','Cloud binding could not be verified.'],[{residentInference:'unknown'},'Setup finished','AI connection isn’t confirmed yet.'],[{residentInference:'unavailable'},'Setup finished','AI is off. Sign in or choose a plan in Settings.'],[{residentInference:'cloud',residentPlanNotice:'needs-plan'},'Setup finished','AI needs an active Cloud plan. Manage it in Settings.']])test(`Ready heading is ${heading} for ${JSON.stringify(connection)}`,async t=>{
 const f=await fixture(t,{connection});for(let i=0;i<4;i++)await f.click('Continue');
 assert.equal(f.heading(),heading);assert.equal(document.querySelector('dialog').getAttribute('aria-label'),heading);
 if(line)assert([...document.querySelectorAll('[role=status],[role=alert]')].some(x=>x.textContent===line),document.body.textContent);
});
test('a request retired while setup is hidden releases Checking and shows the access it got',async t=>{
 const f=await fixture(t);let complete;f.state.notifications='default';
 Notification.requestPermission=()=>new Promise(resolve=>{complete=value=>{f.state.notifications=true;resolve(value);};});
 await React.act(async()=>document.dispatchEvent(new f.dom.window.Event('visibilitychange')));
 await f.click('Allow');assert.equal(f.button('Checking…').disabled,true);
 await f.setActive(false);await React.act(async()=>complete('granted'));await f.setActive(true);
 assert.equal(f.heading(),'Notifications');assert.equal(f.button('Continue').disabled,false);assert.equal(f.progress().step,0);
 await f.click('Continue');assert.equal(f.heading(),'Microphone');assert.equal(f.progress().choices,undefined);
});
test('a new account during a review with a pending request lands on Ready with a working exit',async t=>{
 const marker={version:1,status:'completed',step:4};const f=await fixture(t,{durable:marker});let resolveMedia,stops=0,homes=0;window.addEventListener('launcher-home',()=>homes++);
 navigator.permissions.query=async({name})=>({state:name==='microphone'?'prompt':'granted'});navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>{resolveMedia=resolve;});
 await f.open(undefined);await f.click('Continue');assert.equal(f.heading(),'Microphone');await f.click('Allow');assert.equal(f.button('Checking…').disabled,true);
 await f.auth({accountCreated:true});assert.equal(f.heading(),'Setup finished');assert.equal(f.button('Go to Alpha').disabled,false);
 await f.cancel();assert.equal(document.querySelector('dialog'),null);assert.equal(homes,1);assert.deepEqual(f.progress(),marker);
 await React.act(async()=>resolveMedia({getTracks:()=>[{readyState:'live',stop(){stops++;}}]}));assert.equal(stops,1);assert.equal(document.querySelector('dialog'),null);assert.deepEqual(f.progress(),marker);
});
test('Back on Ready finishes setup',async t=>{
 const f=await fixture(t);let homes=0;window.addEventListener('launcher-home',()=>homes++);for(let i=0;i<4;i++)await f.click('Continue');
 assert.equal(f.heading(),'Setup finished');await f.back();assert.equal(document.querySelector('dialog'),null);assert.equal(homes,1);assert.equal(f.progress().status,'completed');
});
test('sign-in during an open review keeps completed setup completed',async t=>{
 const marker={version:1,status:'completed',step:4};const f=await fixture(t,{durable:marker});
 await f.open(undefined);await f.click('Continue');await f.click('Continue');assert.equal(f.heading(),'Camera');
 await f.auth({accountCreated:true});assert.equal(f.heading(),'Setup finished');assert.deepEqual(f.progress(),marker);
 await f.click('Go to Alpha');assert.equal(document.querySelector('dialog'),null);assert.deepEqual(f.progress(),marker);
});
test('a failed completion write is retried by Go to Alpha',async t=>{
 const f=await fixture(t);for(let i=0;i<3;i++)await f.click('Continue');f.failNextWrite();await f.click('Continue');
 assert.equal(f.heading(),'Setup finished');assert.match(document.body.textContent,/Could not save setup\. Go to Alpha to try again\./);assert.equal(f.progress().status,'pending');
 await f.click('Go to Alpha');assert.equal(document.querySelector('dialog'),null);assert.deepEqual(f.progress(),{version:1,status:'completed',step:4});
 await f.remount();assert.equal(document.querySelector('dialog'),null);
});
const completed={version:1,status:'completed',step:4};
test('Settings review of completed setup closes at once by button, Escape or back and never rewrites completion',async t=>{
 const f=await fixture(t,{durable:completed});assert.equal(f.dialog(),null);
 await f.reopen();assert.equal(f.heading(),'Notifications');assert.deepEqual(f.buttons(),['Continue','Close']);assert.deepEqual(f.progress(),completed);
 await f.click('Continue');assert.equal(f.heading(),'Microphone');assert.deepEqual(f.progress(),completed);
 await f.click('Close');assert.equal(f.dialog(),null);assert.deepEqual(f.progress(),completed);
 await f.reopen();assert.equal(f.heading(),'Notifications');await f.cancel();assert.equal(f.dialog(),null);
 await f.reopen();await f.back();assert.equal(f.dialog(),null);assert.deepEqual(f.progress(),completed);
 await f.remount();assert.equal(f.dialog(),null);assert.equal(f.calls.length,0);
});
test('Settings review can also be left from Ready',async t=>{
 const f=await fixture(t,{durable:completed});await f.reopen();for(let i=0;i<4;i++)await f.click('Continue');assert.equal(f.heading(),'Setup finished');await f.cancel();assert.equal(f.dialog(),null);assert.deepEqual(f.progress(),completed);
});
test('a targeted review of completed setup closes on Escape without rewriting completion',async t=>{
 const f=await fixture(t,{durable:completed});await f.reopen('camera');assert.equal(f.heading(),'Camera');assert.equal(f.buttons().includes('Close'),false);await f.cancel();assert.equal(f.dialog(),null);assert.deepEqual(f.progress(),completed);
});
test('an unfinished walkthrough reopened from Settings stays required: no Close, Escape and back keep it open',async t=>{
 const f=await fixture(t,{active:false});assert.equal(f.dialog(),null);await f.reopen();assert.equal(f.heading(),'Notifications');assert.deepEqual(f.buttons(),['Continue']);
 await f.cancel();await f.back();assert.equal(f.heading(),'Notifications');assert.deepEqual(f.progress(),{version:1,status:'pending',step:0});
});
test('a Settings review with one permission denied stops on it, can be left or skipped, and keeps completion',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=await fixture(t,{durable:completed});f.state.camera=false;
 await f.reopen();for(let i=0;i<2;i++)await f.click('Continue');assert.equal(f.heading(),'Camera');assert.deepEqual(f.buttons(),['Check access','Close']);
 await f.click('Check access');assert.equal(f.heading(),'Camera');assert.deepEqual(f.progress(),completed);
 await f.remount();assert.equal(f.dialog(),null);assert.deepEqual(f.progress(),completed);
 await f.reopen();for(let i=0;i<2;i++)await f.click('Continue');assert.equal(f.heading(),'Camera');
 await React.act(async()=>t.mock.timers.tick(20000));await f.click('Skip for now');assert.equal(f.heading(),'Location');assert.deepEqual(f.progress(),completed);
 await f.click('Continue');await f.click('Go to Alpha');assert.equal(f.dialog(),null);assert.deepEqual(f.progress(),completed);assert.equal(f.state.camera,false);assert.equal(f.calls.length,0);
 await f.remount();assert.equal(f.dialog(),null);
});
test('an older status read that answers after a newer one cannot overwrite it',async t=>{
 const f=await fixture(t,{native:true,review:true,deferStatus:true});assert.equal(f.button('Continue').disabled,false);const before=f.progress();
 await f.visibility();f.state.notifications=false;await f.visibility();
 const older=f.held.splice(0,7),newer=f.held.splice(0);assert.equal(newer.length,7);
 await f.settle(newer);assert.equal(f.heading(),'Notifications');assert(f.button('Allow'));
 await f.settle(older);assert(f.button('Allow'));assert.deepEqual(f.progress(),before);assert.equal(f.calls.length,0);
});
test('appResumed and visibilitychange together re-read access once each and never rewind a revoked earlier step',async t=>{
 const f=await fixture(t,{native:true,review:true,deferStatus:true,durable:{version:3,status:'pending',step:1}});assert.equal(f.heading(),'Microphone');const before=f.progress();
 f.state.notifications=false;f.state.microphone=false;await f.resume();assert.equal(f.held.length,14);
 await f.settle(f.held.splice(0));assert.equal(f.heading(),'Microphone');assert(f.button('Open Android settings'));assert.deepEqual(f.progress(),before);assert.equal(f.calls.length,0);
});
