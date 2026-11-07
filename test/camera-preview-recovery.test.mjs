import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';import {stripTypeScriptTypes,createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {JSDOM}=require('jsdom');
const source=fs.readFileSync(new URL('../apps/app/src/prototype/camera-adapter.ts',import.meta.url),'utf8');
// The adapter's access panel and lifecycle presentation run against the real shared camera session.
const ui=source.slice(source.indexOf('  function hideAccess()'),source.indexOf('  async function stop()'));
const lifecycle=source.slice(source.indexOf('  // A start in flight is shared'),source.indexOf('  /** The session\'s recordingSaved hook'));
const sessionSource=fs.readFileSync(new URL('../.eliza/client-features/plugins/plugin-native-camera/src/session.ts',import.meta.url),'utf8');
const hostPorts=fs.readFileSync(new URL('../.eliza/client-features/plugins/plugin-native-camera/src/host-ports.ts',import.meta.url),'utf8');
const shared=stripTypeScriptTypes((hostPorts+sessionSource).replace(/^import[^;]*;$/gm,'').replace(/^export /gm,''),{mode:'strip'});
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(permission=false){
 const env=new JSDOM('<div data-alpha-camera-root data-alpha-layer><button data-alpha-camera="viewfinder" aria-label="Camera preview"></button></div>');const timers=new Map();let timerId=0;
 env.window.setTimeout=(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;};env.window.clearTimeout=id=>timers.delete(id);
 const calls={starts:0,masked:false,states:[]};let failed=true;
 const camera={startPreview:async()=>{calls.starts++;if(failed)throw permission?Object.assign(Error('Camera permission denied'),{code:'CAMERA_PERMISSION_DENIED'}):Error('Camera in use');},stopPreview:async()=>{}};
 const context=vm.createContext({window:env.window,document:env.window.document,console,camera,mask:enable=>calls.masked=enable,active:()=>true,Capacitor:{isPluginAvailable:()=>true}});
 const prelude=`let accessPanel,disposed=false,direction='back',flash=false;const browserMode=true;const finder='[data-alpha-camera="viewfinder"]';let state={said:''};const api={set:patch=>Object.assign(state,patch),get:()=>state};const session=createCameraSession({camera,active,available:()=>true,preview:()=>({direction}),recording:()=>({})});`;
 vm.runInContext(shared+stripTypeScriptTypes(prelude+ui+lifecycle+`;globalThis.testCamera={start,control,flip:zooms=>flipCamera(api,zooms),setFlash:on=>{flash=on;},direction:()=>direction,state:()=>({phase:session.phase,denied:session.denied,said:state.said,flash:state.flash,zoom:state.zoom,front:state.front})};`,{mode:'strip'}),context);
 return {env,timers,calls,camera,api:context.testCamera,state:vm.runInContext('state',context),recover:()=>failed=false};
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
{
 // Flip with flash on and zoom 2x: both reset before the switch; a switch the lens refuses puts them back.
 const f=fixture();f.recover();await f.api.start();const zooms=[{label:'.5'},{label:'1×'},{label:'2'},{label:'5'}],calls=[];let refuse=true;
 Object.assign(f.camera,{setSettings:async({settings})=>{calls.push('flash '+settings.flash);},setZoom:async({zoom})=>{calls.push('zoom '+zoom);},switchCamera:async({direction})=>{calls.push('switch '+direction);if(refuse)throw Object.assign(Error('No flash unit'),{code:'FLASH_UNSUPPORTED'});}});
 f.api.setFlash(true);Object.assign(f.state,{flash:true,zoom:2});
 f.api.flip(zooms);await settle();await settle();
 assert.deepEqual(calls.splice(0),['flash off','zoom 1','switch front','flash on','zoom 2']);assert.equal(f.api.direction(),'back');assert.equal(f.api.state().said,"This camera can't use that flash or zoom.");assert.equal(f.api.state().flash,true);assert.equal(f.api.state().zoom,2);
 refuse=false;f.api.flip(zooms);await settle();await settle();
 assert.deepEqual(calls,['flash off','zoom 1','switch front']);assert.equal(f.api.direction(),'front');assert.deepEqual([f.api.state().front,f.api.state().flash,f.api.state().zoom],[true,false,1]);
}
console.log('PASS 4 actual camera lifecycle/DOM cases: generic preview failure retains retry, permission denial keeps correct recovery, unsupported control still expires, flip resets and restores flash and zoom. Synthetic camera boundary; no camera frames/provider/native writes.');
