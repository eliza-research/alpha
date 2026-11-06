import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';import {stripTypeScriptTypes,createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {JSDOM}=require('jsdom');
const source=fs.readFileSync(new URL('../apps/app/src/prototype/camera-adapter.ts',import.meta.url),'utf8');
const ui=source.slice(source.indexOf('  function hideAccess()'),source.indexOf('  async function stop()'));
const lifecycle=source.slice(source.indexOf('  async function start(retry'),source.indexOf('  async function finishVideo()'));
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(permission=false){
 const env=new JSDOM('<div data-alpha-camera-root data-alpha-layer><button aria-label="Viewfinder. Tap to focus, hold to ask Alpha, swipe to change mode"></button></div>');const timers=new Map();let timerId=0;
 env.window.setTimeout=(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;};env.window.clearTimeout=id=>timers.delete(id);
 const calls={starts:0,masked:false,states:[]};let failed=true;
 const camera={startPreview:async()=>{calls.starts++;if(failed)throw {permission};}};
 const context=vm.createContext({window:env.window,document:env.window.document,console,camera,mediaAccessDenied:error=>error.permission?'camera':undefined,mask:enable=>calls.masked=enable,active:()=>true,Capacitor:{isPluginAvailable:()=>true}});
 const prelude=`let accessPanel,denied,disposed=false,recordingStarting=false,finalizing=false,phase='off',epoch=0,direction='back',flash=false,controlBusy=false,capturing=false,recording=false;const browserMode=true,stopping=Promise.resolve();const finder='[aria-label="Viewfinder. Tap to focus, hold to ask Alpha, swipe to change mode"]';let state={said:''};const api={set:patch=>Object.assign(state,patch),get:()=>state};`;
 vm.runInContext(stripTypeScriptTypes(prelude+ui+lifecycle+`;globalThis.testCamera={start,control,state:()=>({phase,denied,said:state.said})};`,{mode:'strip'}),context);
 return {env,timers,calls,api:context.testCamera,recover:()=>failed=false};
}
{
 const f=fixture();await f.api.start();assert.equal(f.api.state().phase,'error');assert.equal(f.api.state().denied,undefined,'A hardware/start failure is not a permission denial');assert.equal(f.timers.size,0,'Unavailable panel cannot disappear with transient toast timer');
 assert.equal(f.env.window.document.querySelector('[role="alert"]').getAttribute('aria-label'),'Camera unavailable');await f.api.start();assert.equal(f.calls.starts,1,'No automatic retry loop');
 f.recover();f.env.window.document.querySelector('[role="alert"] button').click();await settle();assert.equal(f.calls.starts,2);assert.equal(f.api.state().phase,'ready');assert.equal(f.env.window.document.querySelector('[role="alert"]'),null);assert.equal(f.calls.masked,true);f.env.window.close();
}
{
 const f=fixture(true);await f.api.start();assert.equal(f.api.state().denied,'camera');assert.equal(f.env.window.document.querySelector('[role="alert"]').getAttribute('aria-label'),'Camera access is off');assert.equal(f.timers.size,0);f.recover();f.env.window.document.querySelector('[role="alert"] button').click();await settle();assert.equal(f.api.state().denied,undefined);assert.equal(f.env.window.document.querySelector('[role="alert"]'),null);f.env.window.close();
}
{
 const f=fixture();f.recover();await f.api.start();await f.api.control(async()=>{throw Error('unsupported');},()=>{throw Error('must not complete');});assert.equal(f.timers.size,1);const timer=[...f.timers.values()][0];assert.equal(timer.ms,5000);assert.match(f.api.state().said,/does not support/);timer.fn();assert.equal(f.api.state().said,'');f.env.window.close();
}
console.log('PASS 3 actual camera lifecycle/DOM cases: generic preview failure retains retry, permission denial keeps correct recovery, unsupported control still expires. Synthetic camera boundary; no camera frames/provider/native writes.');
