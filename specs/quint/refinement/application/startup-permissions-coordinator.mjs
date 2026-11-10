import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import React from 'react';
import {JSDOM} from 'jsdom';
import {captureInputs, checkTraces, qmap, qset} from '../check-traces.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const driver = 'specs/quint/refinement/application/startup-permissions-coordinator.mjs';
const fixtureKey = '__alphaStartupCoordinatorFixture';
const reactKey = '__alphaStartupCoordinatorReact';
const progressKey = 'alpha:startup-permission-walkthrough:v1';
const memoryKey = 'alpha.startup-permissions.v1';
const permissionKeys = ['notifications', 'microphone', 'camera', 'location', 'calendar', 'photos', 'files'];

async function compileComponent() {
  const ports = `const fixture=()=>globalThis.${fixtureKey};
export const Capacitor={getPlatform:()=>fixture().platform,isNativePlatform:()=>fixture().platform==='android'};
export function registerPlugin(name){return new Proxy({},{get:(_,method)=>(...args)=>fixture().ports[name][method](...args)});}
export const connectionController={subscribe:fn=>fixture().connection.subscribe(fn),getSnapshot:()=>fixture().connection.snapshot};
export const googleConnectionController={subscribe:fn=>fixture().google.subscribe(fn),getSnapshot:()=>fixture().google.snapshot};`;
  const react = `const React=globalThis.${reactKey};export default React;
export const useState=(...args)=>{const result=React.useState(...args);globalThis.${fixtureKey}.hooks.states.push(result[0]);return result;};
export const useRef=(...args)=>{const result=React.useRef(...args);globalThis.${fixtureKey}.hooks.refs.push(result);return result;};
export const useEffect=(effect,deps)=>{
  const fixture=globalThis.${fixtureKey};
  return React.useEffect(()=>{
    if(fixture.pauseInvalidation){fixture.deferredEffects.push(effect);return;}
    return effect();
  },deps);
};
export const {useLayoutEffect,useSyncExternalStore}=React;`;
  const built = await build({
    absWorkingDir:root, stdin:{contents:`export {StartupPermissions} from './apps/app/src/startup-permissions.tsx';export {readStartupPermissionProgress} from './apps/app/src/startup-permission-progress.ts';`,resolveDir:root,loader:'ts'},
    bundle:true,write:false,format:'cjs',platform:'node',metafile:true,
    external:['react/jsx-runtime'], define:{'import.meta.env':'undefined'},
    plugins:[{name:'coordinator-observation-ports',setup(plugin) {
      plugin.onResolve({filter:/^react$/}, () => ({path:'react',namespace:'coordinator'}));
      plugin.onResolve({filter:/^@capacitor\/core$|^\.\/platform-plugins$|(?:^|\/)(?:google-)?connection-ui(?:\.tsx?)?$/}, () => ({path:'ports',namespace:'coordinator'}));
      plugin.onResolve({filter:/\.css$/}, () => ({path:'style',namespace:'coordinator'}));
      plugin.onLoad({filter:/.*/,namespace:'coordinator'}, args => ({contents:args.path==='react'?react:args.path==='ports'?ports:'export{}',loader:'js'}));
    }}],
  });
  const sources = [...new Set([...Object.keys(built.metafile.inputs)
    .filter(path => !path.startsWith('coordinator:') && path !== '<stdin>' && !path.startsWith('node_modules/')), driver,
    'test/quint-permission-coordinator-refinement.test.mjs', 'specs/quint/refinement/application/contracts.mjs',
    'specs/quint/refinement/application/support.mjs', 'specs/quint/refinement/application/index.mjs',
    'upstream.lock.json', 'scripts/prepare-client-features.ts',
    ...readdirSync(resolve(root, 'patches/eliza')).filter(name => /\.(patch|json)$/.test(name)).map(name => 'patches/eliza/' + name)])];
  const driverHashes = captureInputs(sources);
  const module = {exports:{}};
  const previousReact = Object.getOwnPropertyDescriptor(globalThis,reactKey);
  globalThis[reactKey] = React;
  try {
    new Function('require','module','exports',built.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
  } finally {
    if(previousReact)Object.defineProperty(globalThis,reactKey,previousReact);
    else delete globalThis[reactKey];
  }
  return {...module.exports,sources,driverHashes};
}

function observable(snapshot) {
  const listeners = new Set();
  return {snapshot,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    update(patch){this.snapshot={...this.snapshot,...patch};for(const listener of listeners)listener();}};
}

async function fixture(component, options = {}) {
  const dom = new JSDOM('<div id="root"></div>',{url:'https://coordinator.invalid',pretendToBeVisual:true});
  const globalValues = {window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,
    sessionStorage:dom.window.sessionStorage,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,
    navigator:dom.window.navigator,getComputedStyle:dom.window.getComputedStyle.bind(dom.window),IS_REACT_ACT_ENVIRONMENT:true};
  const saved = new Map([...Object.keys(globalValues),fixtureKey].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globalValues))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const state = {notifications:true,microphone:'granted',camera:'granted',location:'granted',calendar:'granted',photos:'selected',files:'granted',...options.permissions};
  const calls = [], held = new Map(), resumes = new Set(), inFlight = new Map();
  let instance = 0, ticket = 0;
  const runtime = {platform:'android',hooks:{states:[],refs:[]},pauseInvalidation:false,deferredEffects:[],
    connection:observable({cloudAccount:options.signedOut?null:{credentialId:'owner-a',environment:'production'},open:false}),
    google:observable(false),ports:{}};
  globalThis[fixtureKey]=runtime;
  const request = async key => {
    const owner = instance, epoch = runtime.hooks.refs[7]?.current;
    const identity = `${owner}:${key}`;
    calls.push({kind:'request',key,instance:owner,epoch});
    inFlight.set(identity,{key,instance:owner,epoch});
    try { await held.get(key)?.promise; } finally { inFlight.delete(identity); }
  };
  const read = (key,value) => {calls.push({kind:'read',key});return value;};
  const settings = async input => {calls.push({kind:'settings',page:input.page});};
  runtime.ports = {
    AlphaNotifications:{async status(){return read('notifications',{permissionGranted:state.notifications,appEnabled:state.notifications});}},
    DailyApps:{async checkPermissions(){return read('camera',{camera:state.camera});},async requestPermissions(input){await request(input.permissions[0]);},async addListener(_event,fn){resumes.add(fn);return {async remove(){resumes.delete(fn);}};}},
    AlphaVoiceCloud:{async checkPermissions(){return read('microphone',{microphone:state.microphone});},async requestPermissions(){await request('microphone');}},
    ElizaLocation:{async checkPermissions(){return read('location',{location:state.location,accuracy:state.location==='granted'?'approximate':'none'});},async requestPermissions(){await request('location');}},
    AlphaCalendar:{async checkPermissions(){return read('calendar',{calendar:state.calendar});},async requestAccess(){await request('calendar');}},
    AlphaPhotoLibrary:{async scope(){return read('photos',{scope:state.photos,locked:false});},async requestAccess(){await request('photos');}},
    AlphaDevice:{openSettings:settings},
    AlphaFiles:{async storageState(){return read('files',{access:state.files});},async storageRequestAccess(){await request('files');return {access:state.files};}},
  };
  if(options.progress)localStorage.setItem(progressKey,JSON.stringify(options.progress));
  let writeFailure=!!options.writeFailure,dropWrite=!!options.dropWrite;
  const originalSetItem=dom.window.Storage.prototype.setItem;
  dom.window.Storage.prototype.setItem=function(key,value){
    if(key===progressKey && writeFailure)throw Error('Injected progress storage failure');
    if(key===progressKey && dropWrite)return;
    return originalSetItem.call(this,key,value);
  };
  let enabled=!options.signedOut,homes=0,dismissal=null;
  dom.window.addEventListener('launcher-home',()=>homes++);
  const {createRoot}=await import('react-dom/client');
  let mounted=createRoot(document.getElementById('root'));
  function Observed(props) {
    runtime.hooks={states:[],refs:[]};
    return component.StartupPermissions(props);
  }
  const render=()=>mounted.render(React.createElement(Observed,{active:enabled}));
  await React.act(async()=>render());
  function snapshot() {
    const states=runtime.hooks.states,refs=runtime.hooks.refs;
    assert.equal(states.length,13,'Component state-hook layout changed');
    assert.equal(refs.length,12,'Component ref-hook layout changed');
    const panel=document.querySelector('dialog'),primary=panel?.querySelector('button');
    const stored=localStorage.getItem(progressKey),memory=localStorage.getItem(memoryKey);
    return {
      ui:{visible:!!panel?.open,heading:panel?.querySelector('h2')?.textContent??null,
        primary:primary?.textContent??null,disabled:primary?.disabled??false,
        status:[...document.querySelectorAll('[role="status"],[role="alert"]')].map(node=>node.textContent)},
      component:{reopened:states[0],ready:states[1],progress:states[4],active:states[5],target:states[6],
        review:states[7],states:states[8],busy:states[9],progressError:states[10]},
      refs:{actionPending:refs[6]?.current,sequence:refs[7]?.current},
      controller:{credentialId:runtime.connection.snapshot.cloudAccount?.credentialId??null,open:runtime.connection.snapshot.open,enabled},
      durable:{progress:stored?JSON.parse(stored):null,memory:memory?JSON.parse(memory):null,
        effectiveProgress:component.readStartupPermissionProgress(localStorage,true),writeWorks:!writeFailure&&!dropWrite},
      ticket,operations:[...inFlight.values()].filter(operation=>operation.instance===instance),
      calls:structuredClone(calls),homes,dismissal,
    };
  }
  return {state,calls,snapshot,
    async click(label){await React.act(async()=>{const button=[...document.querySelectorAll('button')].find(node=>node.textContent===label);assert(button,`Missing ${label}; ${document.body.textContent}`);if(!button.disabled && label!=='Done'&&label!=='Go to Alpha')ticket=runtime.hooks.refs[7]?.current;button.click();});},
    hold(key){let release,reject;const promise=new Promise((yes,no)=>{release=yes;reject=no;});held.set(key,{promise,release,reject});},
    async release(key,reject=false){await React.act(async()=>reject?held.get(key).reject(Error('Injected rejected callback')):held.get(key).release());},
    async owner(credentialId){await React.act(async()=>runtime.connection.update({cloudAccount:credentialId?{credentialId,environment:'production'}:null}));},
    async ownerAndSettle(credentialId,key,reject,deferEffect=false){
      runtime.pauseInvalidation=deferEffect;
      await React.act(async()=>{
        runtime.connection.update({cloudAccount:{credentialId,environment:'production'}});
        if(reject)held.get(key).reject(Error('Injected same-turn rejection'));
        else held.get(key).release();
        // Drain the old callback in the same act turn. The scheduler can hold
        // passive effects while the committed layout fence remains active.
        for(let turn=0;turn<8;turn++)await Promise.resolve();
      });
      runtime.pauseInvalidation=false;
      await React.act(async()=>{for(const effect of runtime.deferredEffects.splice(0))effect();});
    },
    async disableAndSettle(key,reject){
      runtime.pauseInvalidation=true;
      enabled=false;
      await React.act(async()=>render());
      await React.act(async()=>reject?held.get(key).reject(Error('Injected disabled rejection')):held.get(key).release());
      runtime.pauseInvalidation=false;
      await React.act(async()=>{for(const effect of runtime.deferredEffects.splice(0))effect();});
    },
    async connection(credentialId,value){enabled=value;await React.act(async()=>{runtime.connection.update({cloudAccount:credentialId?{credentialId,environment:'production'}:null});render();});},
    async auth(accountCreated=false){await React.act(async()=>runtime.connection.update({accountCreated,setupRevision:(runtime.connection.snapshot.setupRevision||0)+1}));},
    async enabled(value){enabled=value;await React.act(async()=>render());},
    async remount(){await React.act(async()=>mounted.unmount());instance++;ticket=0;mounted=createRoot(document.getElementById('root'));await React.act(async()=>render());},
    async resume(){await React.act(async()=>{for(const listener of resumes)listener();});},
    async target(permission){await React.act(async()=>dom.window.dispatchEvent(new dom.window.CustomEvent('alpha:startup-permissions-reopen',{detail:{permission}})));},
    async dismiss(){await React.act(async()=>{
      const cancel=new dom.window.Event('cancel',{cancelable:true});
      const back=new dom.window.Event('alpha-back',{cancelable:true});
      document.querySelector('dialog')?.dispatchEvent(cancel);
      dom.window.dispatchEvent(back);
      dismissal={cancelPrevented:cancel.defaultPrevented,backPrevented:back.defaultPrevented};
    });},
    recoverStorage(){writeFailure=false;dropWrite=false;},
    failStorage(){writeFailure=true;},
    async dispose(){await React.act(async()=>mounted.unmount());dom.window.Storage.prototype.setItem=originalSetItem;dom.window.close();for(const [key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}},
  };
}

function modelObservation(value) {
  return {
    's.signedIn':value.controller.credentialId!==null,
    's.enabled':value.controller.enabled,
    's.phase':!value.controller.credentialId?'signin':value.component.ready?'ready':value.component.active?'permissions':'home',
    's.surface':value.component.ready?'ready':value.component.active?'permissions':'home',
    's.states':qmap(permissionKeys.map((key,index)=>[index,value.component.states[key]])),
    's.attempted':qset(permissionKeys.map((key,index)=>value.durable.memory?.attempted?.[key]?index:null).filter(value=>value!==null)),
    's.requests':qmap(permissionKeys.map((key,index)=>[index,value.calls.filter(call=>call.kind==='request'&&call.key===key).length])),
    's.progress':value.component.progress?.step??-1,
    's.savedProgress':value.durable.effectiveProgress.step,
    's.completed':value.durable.effectiveProgress.status==='completed',
    's.legacyCompleted':value.durable.effectiveProgress.status==='completed'&&value.durable.effectiveProgress.version<4,
    's.pending':value.refs.actionPending?permissionKeys.indexOf(value.component.target??permissionKeys[value.component.progress?.step??0]):-1,
    's.generation':value.refs.sequence,
    's.ticket':value.ticket,
    's.target':value.component.target===null?-1:permissionKeys.indexOf(value.component.target),
    's.writeWorks':value.durable.writeWorks,
    's.operations':qmap(permissionKeys.map((key,index)=>[index,value.operations.find(operation=>operation.key===key)?.epoch??-1])),
    's.progressError':value.component.progressError,
    's.reopened':value.component.reopened,
    's.review':value.component.review,
  };
}

const action = (name,...args) => ({name,args});
const statuses = observation => permissionKeys.map((key,index)=>action('platformState',index,observation.component.states[key]));
const advance = [action('begin'),action('result',true),action('advance')];
const restart = observation => [action('restart'),...statuses(observation)];

export async function runStartupPermissionsCoordinatorRefinement() {
  const component=await compileComponent(),scenarios=[],traces=[];
  async function scenario(name,options,work) {
    const f=await fixture(component,options),checkpoints=[];
    const initial=f.snapshot();
    const trace={name,init:action('init'),expect:{'s.pending':-1},steps:[]};
    const record=(label,actions=null)=>{
      const observation=f.snapshot(),expected=modelObservation(observation);
      const mapped=typeof actions==='function'?actions(observation):actions;
      checkpoints.push({label,observation,modelObservation:expected});
      trace.steps.push({label,action:mapped,expect:expected});
      return observation;
    };
    record('mounted signed-in coordinator',[...(options.progress?.status==='completed'?[action('restoreCompleted',options.progress.step)]:[]),
      action(options.signedOut?'mountSignedOut':'signIn'),...statuses(initial),...(options.writeFailure||options.dropWrite?[action('storageFails'),action('progressWriteFailed')]:[])]);
    try {await work(f,record);scenarios.push({name,checkpoints});traces.push(trace);} finally {await f.dispose();}
  }
  await scenario('mounted-before-sign-in',{signedOut:true},async(f,record)=>{
    assert.equal(f.snapshot().ui.visible,false);
    await f.connection('owner-a',true);
    record('signed-in-caller-enables-setup',action('signIn'));
    await f.click('Continue');
    record('signed-in-continue',advance);
  });
  await scenario('all-seven-ready-normal-completion-and-remount',{},async(f,record)=>{
    for(const key of permissionKeys){assert.equal(f.snapshot().ui.heading,key[0].toUpperCase()+key.slice(1));
    await f.click('Continue');
    record(`continued-${key}`,advance);}
    await f.click('Go to Alpha');
    record('completed',action('finish'));
    await f.remount();
    record('completed-remount',restart);
  });
  await scenario('partial-remount-retains-progress-after-earlier-revocation',{},async(f,record)=>{
    await f.click('Continue');
    record('microphone-step',advance);
    await f.click('Continue');
    record('camera-step',advance);
    await f.remount();
    record('partial-remount',restart);
    f.state.notifications=false;
    await f.remount();
    record('revoked-earlier-grant',restart);
    assert.equal(f.snapshot().component.progress.step,2);
  });
  await scenario('held-request-duplicate-resume-and-completion',{permissions:{notifications:false}},async(f,record)=>{
    f.hold('notifications');
    await f.click('Allow');
    record('request-held',[action('begin'),action('request')]);
    await f.click('Checking…');
    await f.resume();
    record('duplicate-and-resume');
    f.state.notifications=true;
    await f.release('notifications');
    record('request-completed',[action('result',true),action('advance')]);
  });
  for(const rejects of [false,true])await scenario(`credential-change-held-${rejects?'rejection':'completion'}`,{permissions:{notifications:false}},async(f,record)=>{
    f.hold('notifications');
    await f.click('Allow');
    record('owner-a-held',[action('begin'),action('request')]);
    await f.owner('owner-b');
    record('owner-b-before-completion',action('ownerChange'));
    f.state.notifications=true;
    await f.release('notifications',rejects);
    record('old-request-completed',action('staleResult',0));
    assert.equal(f.snapshot().component.progress.step,0);
    await f.click('Allow');
    record('new-owner-explicit-check',advance);
  });
  await scenario('credential-aba-keeps-old-callback-retired',{permissions:{notifications:false}},async(f,record)=>{
    f.hold('notifications');await f.click('Allow');
    record('owner-a-held',[action('begin'),action('request')]);
    await f.owner('owner-b');record('owner-b',action('ownerChange'));
    await f.owner('owner-a');record('owner-a-again',action('ownerChange'));
    f.state.notifications=true;await f.release('notifications');
    record('original-callback-retired',action('staleResult',0));
    assert.equal(f.snapshot().component.progress.step,0);
    assert.equal(f.snapshot().component.states.notifications,'request');
    await f.click('Allow');record('current-owner-check',advance);
  });
  for(const rejects of [false,true])await scenario(`same-turn-owner-${rejects?'rejection':'completion'}`,{permissions:{notifications:false}},async(f,record)=>{
    f.hold('notifications');
    await f.click('Allow');
    record('old-request-held',[action('begin'),action('request')]);
    f.state.notifications=true;
    await f.ownerAndSettle('owner-b','notifications',rejects);
    record('owner-and-callback-in-same-turn',[action('ownerChange'),action('staleResult',0)]);
    assert.equal(f.snapshot().component.progress.step,0,'Old callback advanced setup during the passive-effect window');
  });
  for(const rejects of [false,true])await scenario(`deferred-effect-owner-${rejects?'rejection':'completion'}`,{permissions:{notifications:false}},async(f,record)=>{
    f.hold('notifications');
    await f.click('Allow');
    record('old-request-held',[action('begin'),action('request')]);
    f.state.notifications=true;
    await f.ownerAndSettle('owner-b','notifications',rejects,true);
    record('callback-before-owner-passive-effect',[action('ownerChange'),action('staleResult',0)]);
    assert.equal(f.snapshot().component.progress.step,0,'Old callback advanced setup before the deferred owner effect');
    assert.equal(f.snapshot().component.states.notifications,'request','Old rejection changed the new owner permission state');
  });
  for(const rejects of [false,true])await scenario(`stale-${rejects?'rejection':'completion'}-keeps-newer-busy`,{permissions:{notifications:false,microphone:'prompt'}},async(f,record)=>{
    f.hold('notifications');
    await f.click('Allow');
    record('old-request-held',[action('begin'),action('request')]);
    await f.owner('owner-b');
    record('owner-changed',action('ownerChange'));
    await f.target('microphone');
    record('target-new-permission',action('openTarget',1));
    f.hold('microphone');
    await f.click('Allow');
    record('new-request-held',[action('begin'),action('request')]);
    await f.release('notifications',rejects);
    record('old-request-settled',action('staleResult',0));
    assert.equal(f.snapshot().ui.disabled,true,JSON.stringify(f.snapshot()));
    f.state.microphone='granted';
    await f.release('microphone');
    record('new-request-completed',action('result',true));
    await f.click('Done');
    record('target-closed',action('closeTarget'));
  });
  await scenario('null-result-while-old-platform-call-is-pending',{permissions:{notifications:false}},async(f,record)=>{
    f.hold('notifications');
    await f.click('Allow');
    record('request-held',[action('begin'),action('request')]);
    await f.owner('owner-b');
    record('owner-changed',action('ownerChange'));
    await f.click('Allow');
    record('pending-flow-returns-null',action('skipPending'));
    f.state.notifications=true;
    await f.release('notifications');
    record('old-request-settled',action('staleResult',0));
    await f.click('Allow');
    record('new-owner-check',advance);
  });
  await scenario('sign-out-and-sign-in-retire-held-completion',{permissions:{notifications:false}},async(f,record)=>{
    f.hold('notifications');
    await f.click('Allow');
    record('request-held',[action('begin'),action('request')]);
    await f.connection(null,false);
    record('signed-out',action('signOut'));
    f.state.notifications=true;
    await f.release('notifications');
    record('old-result',action('staleResult',0));
    await f.connection('owner-b',true);
    record('signed-in',observation=>[action('signIn'),...statuses(observation)]);
    await f.click('Continue');
    record('new-owner-check',advance);
  });
  for(const rejects of [false,true])await scenario(`deferred-effect-disabled-${rejects?'rejection':'completion'}`,{permissions:{notifications:false}},async(f,record)=>{
    f.hold('notifications');
    await f.click('Allow');
    record('old-request-held',[action('begin'),action('request')]);
    f.state.notifications=true;
    await f.disableAndSettle('notifications',rejects);
    record('disabled-before-passive-effect',[action('suspend'),action('staleResult',0)]);
    assert.equal(f.snapshot().component.progress.step,0,'Disabled coordinator advanced before its passive effect');
    assert.equal(f.snapshot().component.states.notifications,'request','Disabled rejection changed permission UI state');
  });
  await scenario('disabled-coordinator-fences-held-completion',{permissions:{notifications:false}},async(f,record)=>{
    f.hold('notifications');
    await f.click('Allow');
    record('held',[action('begin'),action('request')]);
    await f.enabled(false);
    record('disabled-held',action('suspend'));
    f.state.notifications=true;
    await f.release('notifications');
    record('completion-while-disabled',action('staleResult',0));
    await f.enabled(true);
    record('enabled-again',observation=>[action('resume'),...statuses(observation)]);
  });
  await scenario('remount-retires-held-component',{permissions:{notifications:false}},async(f,record)=>{
    f.hold('notifications');
    await f.click('Allow');
    record('old-component-held',[action('begin'),action('request')]);
    await f.remount();
    record('remounted-with-old-request',restart);
    f.state.notifications=true;
    await f.release('notifications');
    record('old-component-completed',action('retiredResult'));
  });
  for(const mode of ['writeFailure','dropWrite'])await scenario(`progress-${mode}`,{[mode]:true},async(f,record)=>{
    await f.click('Continue');
    record('advance-retained-for-this-session',advance);
    f.recoverStorage();
    record('storage-recovered',action('storageRecovers'));
    await f.click('Continue');
    record('next-choice-after-recovery',advance);
    await f.remount();
    record('recovered-remount',restart);
  });
  await scenario('denied-request-remount-settings-and-grant',{permissions:{notifications:false}},async(f,record)=>{
    await f.click('Allow');
    record('denied',[action('begin'),action('request'),action('result',false)]);
    await f.remount();
    record('denied-remount',restart);
    await f.click('Open Android settings');
    record('settings-retry',[action('begin'),action('result',false)]);
    f.state.notifications=true;
    await f.click('Open Android settings');
    record('granted-readback',advance);
  });
  await scenario('revocation-after-completion-does-not-rewrite-reviewed-choices',{},async(f,record)=>{
    for(const key of permissionKeys){await f.click('Continue');
    record(`continued-${key}`,advance);}
    f.state.camera='denied';
    await f.resume();
    record('revoked-platform-state',statuses);
    await f.click('Go to Alpha');
    record('acknowledged-completion',action('finish'));
    assert.equal(f.snapshot().durable.effectiveProgress.status,'completed');
    assert.equal(f.snapshot().component.states.camera,'settings');
  });
  await scenario('required-flow-dismissal-is-blocked',{},async(f,record)=>{
    assert(![...document.querySelectorAll('button')].some(button=>/Skip|Not now/.test(button.textContent)));
    await f.dismiss();
    record('cancel-and-back',action('blockedDismiss'));
    assert.equal(f.snapshot().ui.heading,'Notifications');
    assert.deepEqual(f.snapshot().dismissal,{cancelPrevented:true,backPrevented:true});
  });
  for(const count of [4,5,6,7])await scenario(`auth-ready-preserves-completed-${count}`,{progress:{version:count-3,status:'completed',step:count},permissions:{camera:'denied',calendar:'denied',photos:'denied'}},async(f,record)=>{
    assert.equal(f.snapshot().ui.visible,false);
    await f.auth();
    record('existing-account-stays-home',action('authSetup',false));
    assert.equal(f.snapshot().ui.visible,false);
    await f.auth(true);
    record('new-account-ready-notice',action('authSetup',true));
    await f.click('Go to Alpha');
    record('completed-installation-returned-home',action('finish'));
  });
  await scenario('ready-acknowledgement-does-not-need-another-write',{},async(f,record)=>{
    for(const key of permissionKeys){await f.click('Continue');record(`continued-${key}`,advance);}
    f.failStorage();
    record('storage-unavailable',action('storageFails'));
    await f.click('Go to Alpha');
    record('acknowledged-completion',action('finish'));
    assert.equal(f.snapshot().durable.effectiveProgress.status,'completed');
    assert.equal(f.snapshot().component.progressError,false);
  });
  await scenario('last-choice-write-failure-retains-session-and-restarts-at-files',{},async(f,record)=>{
    for(const key of permissionKeys.slice(0,-1)){await f.click('Continue');record(`continued-${key}`,advance);}
    f.failStorage();
    record('storage-unavailable-at-files',action('storageFails'));
    await f.click('Continue');
    record('ready-with-undurable-completion',advance);
    assert.equal(f.snapshot().component.progressError,true);
    assert.equal(f.snapshot().durable.effectiveProgress.status,'pending');
    await f.click('Go to Alpha');
    record('acknowledged-for-this-session',action('finish'));
    await f.remount();
    record('restart-reviews-unsaved-choice',restart);
    assert.equal(f.snapshot().ui.heading,'Files');
  });
  await scenario('completed-setup-review-preserves-marker-with-blocked-storage',{progress:{version:4,status:'completed',step:7}},async(f,record)=>{
    f.failStorage();
    record('storage-unavailable',action('storageFails'));
    await f.target('camera');
    record('review-camera',observation=>[action('openTarget',2),...statuses(observation)]);
    await f.click('Done');
    record('closed-review',action('closeTarget'));
    assert.equal(f.snapshot().durable.effectiveProgress.status,'completed');
    assert.equal(f.snapshot().durable.effectiveProgress.step,7);
  });
  const receipt=await checkTraces({model:'PermissionWalkthrough',id:'PermissionWalkthroughCoordinator',sources:component.sources,
    driverHashes:component.driverHashes,traces,scope:'bounded-orchestration',assumptions:[
      'Actual React component, progress storage helpers and permission-flow implementation execute in JSDOM.',
      'Seven native permission bridges and connection subscriptions are controlled ports. No device permission or provider action occurs.',
      'React state and ref observations are captured by hook wrappers forwarding every call to the real React runtime.',
      'Generation is bounded to six in the model. These traces cover finite owner, lifecycle, callback and storage schedules.',
      'Progress writes may fail or drop silently. Permission-attempt marker writes succeed in these traces.',
    ]});
  const after=captureInputs(component.sources);
  assert.deepEqual(after,component.driverHashes,'Source or driver changed while the coordinator executed');
  return {receipt,scenarios,sourceHashes:after,obligations:[
    {model:'PermissionWalkthrough',obligation:'Browser permission provider timeout and media cleanup composition',reason:'This adapter exercises the native seven-permission coordinator ports. Browser-specific providers retain separate tests.'},
    {model:'PermissionWalkthrough',obligation:'Every platform status and external panel combination',reason:'The state vocabulary and lifecycle schedules are sampled finitely. The traces do not establish universal refinement.'},
  ]};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runStartupPermissionsCoordinatorRefinement(),null,2));
}
