import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import React from 'react';
import {JSDOM} from 'jsdom';
import {captureInputs, checkTraces, qmap, qset} from '../check-traces.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const driver = 'specs/quint/refinement/application/permission-choices.mjs';
const fixtureKey = '__alphaPermissionChoicesFixture';
const reactKey = '__alphaPermissionChoicesReact';
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
      plugin.onLoad({filter:/startup-permissions\.tsx$/}, args => {
        const source=readFileSync(args.path,'utf8');
        const needle='const ticket = sequence.current, credentialId = connection.cloudAccount?.credentialId;';
        const allow=source.indexOf('async function allow() {');
        const at=source.indexOf(needle,allow);
        assert.ok(allow>=0&&at>allow,'Permission action capture changed');
        return {contents:source.slice(0,at)+source.slice(at).replace(needle,`${needle} globalThis.${fixtureKey}.captured = {ticket, key, state};`),loader:'tsx'};
      });
      plugin.onLoad({filter:/components\/permissions\/permission-walkthrough\.ts$/}, args => {
        const source=readFileSync(args.path,'utf8');
        const needle='      pending = current;';
        assert.equal(source.split(needle).length,2,'Shared permission ownership assignment changed');
        return {contents:source.replace(needle,`${needle}\n      globalThis.${fixtureKey}.observeFlow(options.attemptKey, () => ({pending, state, attempted}));`),loader:'ts'};
      });
      plugin.onResolve({filter:/^react$/}, () => ({path:'react',namespace:'coordinator'}));
      plugin.onResolve({filter:/^@capacitor\/core$|^\.\/platform-plugins$|(?:^|\/)(?:google-)?connection-ui(?:\.tsx?)?$/}, () => ({path:'ports',namespace:'coordinator'}));
      plugin.onResolve({filter:/\.css$/}, () => ({path:'style',namespace:'coordinator'}));
      plugin.onLoad({filter:/.*/,namespace:'coordinator'}, args => ({contents:args.path==='react'?react:args.path==='ports'?ports:'export{}',loader:'js'}));
    }}],
  });
  const sources = [...new Set([...Object.keys(built.metafile.inputs)
    .filter(path => !path.startsWith('coordinator:') && path !== '<stdin>' && !path.startsWith('node_modules/')), driver,
    'test/quint-permission-choices.test.mjs', 'specs/quint/refinement/application/contracts.mjs',
    'specs/quint/refinement/application/support.mjs', 'specs/quint/refinement/application/index.mjs'])];
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
    update(patch){this.snapshot=patch!==null&&typeof patch==='object'?{...this.snapshot,...patch}:patch;for(const listener of listeners)listener();}};
}

async function fixture(component, options = {}) {
  const dom = new JSDOM('<div id="root"></div>',{url:'https://coordinator.invalid',pretendToBeVisual:true});
  const skipTimers=new Map();
  const nativeSetTimeout=globalThis.setTimeout,nativeClearTimeout=globalThis.clearTimeout;
  let timerId=1000000;
  const globalValues = {window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,
    sessionStorage:dom.window.sessionStorage,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,
    navigator:dom.window.navigator,getComputedStyle:dom.window.getComputedStyle.bind(dom.window),IS_REACT_ACT_ENVIRONMENT:true,
    setTimeout:(callback,delay,...args)=>{
      if(delay!==20000)return nativeSetTimeout(callback,delay,...args);
      const id=timerId++;skipTimers.set(id,()=>callback(...args));return id;
    },
    clearTimeout:id=>{if(skipTimers.has(id))skipTimers.delete(id);else nativeClearTimeout(id);}};
  const saved = new Map([...Object.keys(globalValues),fixtureKey].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globalValues))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const state = {notifications:true,microphone:'granted',camera:'granted',location:'granted',calendar:'granted',photos:'selected',files:'granted',...options.permissions};
  const calls = [], held = new Map(), resumes = new Set(), inFlight = new Map();
  let instance = 0;
  const runtime = {platform:options.native===false?'web':'android',hooks:{states:[],refs:[]},pauseInvalidation:false,deferredEffects:[],
    connection:observable({cloudAccount:options.signedOut?null:{credentialId:'owner-a',environment:'production'},open:false}),
    google:observable(false),ports:{},captured:null,flows:new Map(),
    observeFlow(key,inspect){this.flows.set(key,{ticket:this.captured?.ticket,inspect});}};
  globalThis[fixtureKey]=runtime;
  const request = async key => {
    const owner = instance, epoch = runtime.captured?.ticket;
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
    ElizaLocation:{async checkPermissions(){return read('location',{location:state.location,accuracy:state.location==='granted'?(state.locationAccuracy??'approximate'):'none'});},async requestPermissions(){await request('location');}},
    AlphaCalendar:{async checkPermissions(){return read('calendar',{calendar:state.calendar});},async requestAccess(){await request('calendar');}},
    AlphaPhotoLibrary:{async scope(){return read('photos',{scope:state.photos,locked:false});},async requestAccess(){await request('photos');}},
    AlphaDevice:{openSettings:settings},
    AlphaFiles:{async storageState(){return read('files',{access:state.files});},async storageRequestAccess(input){if(input?.settings)return settings({page:'files'});await request('files');return {access:state.files};}},
  };
  if(options.native===false){
    Object.defineProperty(navigator,'permissions',{configurable:true,value:{async query({name}){
      const key=name==='geolocation'?'location':name;
      return read(key,{state:state[key]});
    }}});
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:options.unsupportedMedia?undefined:{async getUserMedia(input){
      const key=input.video?'camera':'microphone';await request(key);
      if(state[key]!=='granted')throw new dom.window.DOMException('Permission denied','NotAllowedError');
      const track={readyState:'live',stop(){this.readyState='ended';calls.push({kind:'stop',key});}};
      return {getTracks:()=>[track]};
    }}});
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(success,failure){
      void request('location').then(()=>state.location==='granted'?success({}):failure({code:1}));
    }}});
    saved.set('Notification',Object.getOwnPropertyDescriptor(globalThis,'Notification'));
    Object.defineProperty(globalThis,'Notification',{configurable:true,value:{
      get permission(){return state.notifications?'granted':'default';},
      async requestPermission(){await request('notifications');return state.notifications?'granted':'default';},
    }});
  }
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
      ui:{visible:!!panel?.open,heading:panel?.querySelector('[aria-current=step] .alpha-permission-name')?.textContent??panel?.querySelector('h2')?.textContent??null,
        primary:primary?.textContent??null,disabled:primary?.disabled??false,
        status:[...document.querySelectorAll('[role="status"],[role="alert"]')].map(node=>node.textContent)},
      component:{reopened:states[0],ready:states[1],progress:states[4],active:states[5],target:states[6],
        review:states[7],states:states[8],busy:states[9],progressError:states[10],canSkip:states[11],checkNotice:states[12]},
      refs:{locationDescription:refs[0]?.current,photoDescription:refs[1]?.current,completedReady:!!states[1]&&states[4]===null,actionPending:refs[6]?.current,sequence:refs[7]?.current},
      controller:{credentialId:runtime.connection.snapshot.cloudAccount?.credentialId??null,open:runtime.connection.snapshot.open,
        googleOpen:runtime.google.snapshot,native:runtime.platform==='android',enabled,
        setupRevision:runtime.connection.snapshot.setupRevision,accountCreated:runtime.connection.snapshot.accountCreated},
      durable:{progress:stored?JSON.parse(stored):null,memory:memory?JSON.parse(memory):null,
        effectiveProgress:component.readStartupPermissionProgress(localStorage,runtime.platform==='android'),writeWorks:!writeFailure&&!dropWrite},
      captured:runtime.captured,ticket:runtime.captured?.ticket??0,operations:[...inFlight.values()].filter(operation=>operation.instance===instance),
      flowTickets:permissionKeys.map(key=>{const flow=runtime.flows.get(runtime.platform==='android'?key:'browser'+key);return flow?.inspect().pending!=null?flow.ticket:-1;}),
      calls:structuredClone(calls),homes,dismissal,
    };
  }
  return {state,calls,snapshot,
    async click(label){await React.act(async()=>{const button=[...document.querySelectorAll('button')].find(node=>node.textContent===label);assert(button,`Missing ${label}; ${document.body.textContent}`);button.click();});},
    hold(key){let release,reject;const promise=new Promise((yes,no)=>{release=yes;reject=no;});held.set(key,{promise,release,reject});},
    async release(key,reject=false){await React.act(async()=>reject?held.get(key).reject(Error('Injected rejected callback')):held.get(key).release());},
    async owner(credentialId){await React.act(async()=>runtime.connection.update({cloudAccount:credentialId?{credentialId,environment:'production'}:null}));},
    async ownerAndSettle(credentialId,key,reject,deferEffect=false,environment='production'){
      runtime.pauseInvalidation=deferEffect;
      await React.act(async()=>{
        runtime.connection.update({cloudAccount:{credentialId,environment}});
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
    async setupAndSettle(key){
      runtime.pauseInvalidation=true;
      await React.act(async()=>{
        runtime.connection.update({setupRevision:(runtime.connection.snapshot.setupRevision||0)+1,accountCreated:false});
        held.get(key).release();
        for(let turn=0;turn<8;turn++)await Promise.resolve();
      });
      runtime.pauseInvalidation=false;
      await React.act(async()=>{for(const effect of runtime.deferredEffects.splice(0))effect();});
    },
    async connection(credentialId,value){enabled=value;await React.act(async()=>{runtime.connection.update({cloudAccount:credentialId?{credentialId,environment:'production'}:null});render();});},
    async auth(accountCreated=false){await React.act(async()=>runtime.connection.update({setupRevision:(runtime.connection.snapshot.setupRevision||0)+1,accountCreated}));},
    async enabled(value){enabled=value;await React.act(async()=>render());},
    async remount(){await React.act(async()=>mounted.unmount());instance++;runtime.captured=null;runtime.flows.clear();mounted=createRoot(document.getElementById('root'));await React.act(async()=>render());},
    async overlays(open,google){await React.act(async()=>{runtime.connection.update({open});runtime.google.update(google);});},
    async expireSkip(){await React.act(async()=>{assert.equal(skipTimers.size,1,'Expected one live skip timer');const callbacks=[...skipTimers.values()];skipTimers.clear();for(const callback of callbacks)callback();});},
    async reopen(){await React.act(async()=>dom.window.dispatchEvent(new dom.window.Event('alpha:startup-permissions-reopen')));},
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
  const progress=value.component.progress;
  const saved=value.durable.effectiveProgress;
  const capture=value.captured;
  return {
    visible:value.ui.visible,
    busy:value.component.busy,
    shownPermission:permissionKeys.findIndex(key=>value.ui.heading===key[0].toUpperCase()+key.slice(1)),
    buttonDisabled:value.ui.disabled,
    's.native':value.controller.native,
    's.signedIn':value.controller.credentialId!==null,
    's.enabled':value.controller.enabled,
    's.connectionOpen':!!value.controller.open,
    's.googleOpen':!!value.controller.googleOpen,
    's.setupReady':!!value.controller.setupRevision,
    's.accountCreated':!!value.controller.accountCreated,
    's.active':value.component.active,
    's.ready':value.component.ready,
    's.reopened':value.component.reopened,
    's.review':value.component.review,
    's.progress':progress?.step??-1,
    's.choices':progress?.choices??[],
    's.savedProgress':saved.step,
    's.savedChoices':saved.choices??[],
    's.savedHasChoices':saved.choices!==undefined,
    's.completed':saved.status==='completed',
    's.legacyCompleted':saved.status==='completed'&&saved.version<(value.controller.native?4:1),
    's.states':qmap(permissionKeys.map((key,index)=>[index,value.component.states[key]])),
    's.attempted':qset(permissionKeys.map((key,index)=>value.durable.memory?.attempted?.[value.controller.native?key:'browser'+key]?index:null).filter(value=>value!==null)),
    's.requests':qmap(permissionKeys.map((key,index)=>[index,value.calls.filter(call=>call.kind==='request'&&call.key===key).length])),
    's.pending':value.refs.actionPending?permissionKeys.indexOf(value.component.target??permissionKeys[progress?.step??0]):-1,
    's.generation':value.refs.sequence,
    's.ticket':value.ticket,
    's.target':value.component.target===null?-1:permissionKeys.indexOf(value.component.target),
    's.writeWorks':value.durable.writeWorks,
    's.operations':qmap(permissionKeys.map((key,index)=>[index,value.operations.find(operation=>operation.key===key)?.epoch??-1])),
    's.flowTickets':qmap(value.flowTickets.map((ticket,index)=>[index,ticket])),
    's.progressError':value.component.progressError,
    's.canSkip':value.component.canSkip,
    's.checkNotice':!value.component.checkNotice?'':value.component.checkNotice.startsWith('Still off')?'off':'unconfirmed',
    's.pendingChoice':capture?(capture.state==='ready'?'continued':'allowed'):'',
    's.dismissed':!!value.durable.memory?.dismissed,
    's.homeRequests':value.homes,
    's.locationDescription':value.refs.locationDescription,
    's.photoDescription':value.refs.photoDescription,
  };
}

const action = (name,...args) => ({name,args});
const statuses = observation => [
  ...permissionKeys.slice(0,observation.controller.native?7:4).map((key,index)=>action('platformState',index,observation.component.states[key])),
  ...(observation.controller.native?[action('platformDetails',observation.refs.locationDescription,observation.refs.photoDescription)]:[]),
];
const advance = [action('begin'),action('result',true)];
const restart = observation => [action('restart'),...statuses(observation)];

export async function runPermissionChoicesRefinement({scenarioFilter,checkModel=true}={}) {
  const component=await compileComponent(),scenarios=[],traces=[];
  async function scenario(name,options,work) {
    if(scenarioFilter && !scenarioFilter.test(name))return;
    const f=await fixture(component,options),checkpoints=[];
    const initial=f.snapshot();
    const trace={name,init:action(options.native===false?'browserInit':'init'),expect:{'s.pending':-1},steps:[]};
    const record=(label,actions=null)=>{
      const observation=f.snapshot(),expected=modelObservation(observation);
      const mapped=typeof actions==='function'?actions(observation):actions;
      checkpoints.push({label,observation,modelObservation:expected});
      trace.steps.push({label,action:mapped,expect:expected});
      return observation;
    };
    const saved=options.progress;
    record('mounted coordinator',[
      ...(saved?.status==='completed'?[action('restoreCompleted',saved.step)]:saved?.step?[action('restorePending',saved.step)]:[]),
      ...(options.writeFailure||options.dropWrite?[action('storageFails')]:[]),
      action(options.signedOut?'mountSignedOut':'signIn'),...statuses(initial),
    ]);
    try {await work(f,record);scenarios.push({name,checkpoints});traces.push(trace);} finally {await f.dispose();}
  }
  await scenario('mounted-before-sign-in',{signedOut:true},async(f,record)=>{
    assert.equal(f.snapshot().ui.visible,false);
    await f.connection('owner-a',true);record('caller enables setup',action('signIn'));
    await f.click('Continue');record('first permission continued',advance);
  });
  await scenario('all-seven-ready-normal-completion-and-remount',{},async(f,record)=>{
    for(const key of permissionKeys){assert.equal(f.snapshot().ui.heading,key[0].toUpperCase()+key.slice(1));
      await f.click('Continue');record(`continued ${key}`,advance);}
    assert.equal(f.snapshot().durable.effectiveProgress.status,'completed');
    await f.click('Done');record('completed session',action('finish'));
    await f.remount();record('completed installation remount',restart);
  });
  await scenario('partial-remount-does-not-reopen-earlier-reviewed-steps',{},async(f,record)=>{
    await f.click('Continue');record('microphone step',advance);
    await f.click('Continue');record('camera step',advance);
    await f.remount();record('partial remount',restart);
    f.state.notifications=false;await f.remount();record('earlier permission revoked',restart);
    assert.equal(f.snapshot().component.progress.step,2);
  });
  await scenario('held-request-duplicate-resume-and-completion',{permissions:{notifications:false}},async(f,record)=>{
    f.hold('notifications');await f.click('Allow');record('request held',[action('begin'),action('request')]);
    await f.click('Checking');await f.resume();record('duplicate and resume remain inert');
    f.state.notifications=true;await f.release('notifications');record('request completed',action('result',true));
  });
  for(const rejects of [false,true])await scenario(`credential-change-held-${rejects?'rejection':'completion'}`,{permissions:{notifications:false}},async(f,record)=>{
    f.hold('notifications');await f.click('Allow');record('owner A held',[action('begin'),action('request')]);
    await f.owner('owner-b');record('owner B before old callback',action('ownerChange'));
    f.state.notifications=true;await f.release('notifications',rejects);record('old request settled',action('staleResult',0));
    assert.equal(f.snapshot().component.progress.step,0);
    await f.click('Allow');record('new owner explicit check',advance);
  });
  for(const deferred of [false,true])for(const rejects of [false,true])await scenario(`${deferred?'deferred-effect':'same-turn'}-owner-${rejects?'rejection':'completion'}`,{permissions:{notifications:false}},async(f,record)=>{
    f.hold('notifications');await f.click('Allow');record('old request held',[action('begin'),action('request')]);
    f.state.notifications=true;await f.ownerAndSettle('owner-b','notifications',rejects,deferred);
    record('owner and callback same turn',[action('ownerChange'),action('staleResult',0)]);
    assert.equal(f.snapshot().component.progress.step,0);
    assert.equal(f.snapshot().component.states.notifications,'request');
  });
  for(const rejects of [false,true])await scenario(`stale-${rejects?'rejection':'completion'}-keeps-newer-busy`,{permissions:{notifications:false,microphone:'prompt'}},async(f,record)=>{
    f.hold('notifications');await f.click('Allow');record('old request held',[action('begin'),action('request')]);
    await f.owner('owner-b');record('owner changed',action('ownerChange'));
    await f.target('microphone');record('new target',action('openTarget',1));
    f.hold('microphone');await f.click('Allow');record('new request held',[action('begin'),action('request')]);
    await f.release('notifications',rejects);record('old request settled',action('staleResult',0));
    assert.equal(f.snapshot().ui.disabled,true);
    f.state.microphone='granted';await f.release('microphone');record('new request completed',action('result',true));
    await f.click('Done');record('target closed',action('closeTarget'));
  });
  await scenario('null-result-while-old-platform-call-is-pending',{permissions:{notifications:false}},async(f,record)=>{
    f.hold('notifications');await f.click('Allow');record('held',[action('begin'),action('request')]);
    await f.owner('owner-b');record('owner changed',action('ownerChange'));
    await f.click('Allow');record('existing flow returns null',action('skipPending'));
    f.state.notifications=true;await f.release('notifications');record('old call settles',action('staleResult',0));
    await f.click('Allow');record('fresh explicit check',advance);
  });
  await scenario('sign-out-and-sign-in-retire-held-completion',{permissions:{notifications:false}},async(f,record)=>{
    f.hold('notifications');await f.click('Allow');record('held',[action('begin'),action('request')]);
    await f.connection(null,false);record('signed out',action('signOut'));
    f.state.notifications=true;await f.release('notifications');record('old callback',action('staleResult',0));
    await f.connection('owner-b',true);record('signed in with fresh permission readback',observation=>[action('signIn'),...statuses(observation)]);
    await f.click('Continue');record('new owner check',advance);
  });
  for(const rejects of [false,true])await scenario(`deferred-effect-disabled-${rejects?'rejection':'completion'}`,{permissions:{notifications:false}},async(f,record)=>{
    f.hold('notifications');await f.click('Allow');record('held',[action('begin'),action('request')]);
    f.state.notifications=true;await f.disableAndSettle('notifications',rejects);
    record('disabled before passive effect',[action('suspend'),action('staleResult',0)]);
    assert.equal(f.snapshot().component.progress.step,0);
    assert.equal(f.snapshot().component.states.notifications,'request');
  });
  await scenario('disabled-coordinator-fences-held-completion',{permissions:{notifications:false}},async(f,record)=>{
    f.hold('notifications');await f.click('Allow');record('held',[action('begin'),action('request')]);
    await f.enabled(false);record('disabled',action('suspend'));
    f.state.notifications=true;await f.release('notifications');record('old callback',action('staleResult',0));
    await f.enabled(true);record('enabled again with fresh readback',observation=>[action('resume'),...statuses(observation)]);
  });
  await scenario('remount-retires-held-component',{permissions:{notifications:false}},async(f,record)=>{
    f.hold('notifications');await f.click('Allow');record('old instance held',[action('begin'),action('request')]);
    await f.remount();record('new instance',restart);
    f.state.notifications=true;await f.release('notifications');record('old instance completion',action('retiredResult'));
  });
  for(const mode of ['writeFailure','dropWrite'])await scenario(`progress-${mode}`,{[mode]:true},async(f,record)=>{
    await f.click('Continue');record('session advances despite failed persistence',advance);
    assert.equal(f.snapshot().component.progress.step,1);
    assert.equal(f.snapshot().durable.effectiveProgress.step,0);
    await f.remount();record('remount resumes durable position',restart);
    f.recoverStorage();record('storage recovers',action('storageRecovers'));
    await f.click('Continue');record('fresh step is persisted',advance);
  });
  await scenario('denied-request-remount-settings-and-grant',{permissions:{notifications:false}},async(f,record)=>{
    await f.click('Allow');record('denied',[action('begin'),action('request'),action('result',false)]);
    await f.remount();record('denied remount',restart);
    await f.click('Settings');record('settings readback',[action('begin'),action('result',false)]);
    f.state.notifications=true;await f.click('Settings');record('granted readback',advance);
  });
  await scenario('required-flow-dismissal-is-blocked',{},async(f,record)=>{
    await f.dismiss();record('cancel and back',action('blockedDismiss'));
    assert.equal(f.snapshot().ui.heading,'Notifications');
    assert.deepEqual(f.snapshot().dismissal,{cancelPrevented:true,backPrevented:true});
  });
  for(const count of [4,5,6,7])await scenario(`returning-auth-preserves-completed-${count}`,{progress:{version:count-3,status:'completed',step:count}},async(f,record)=>{
    assert.equal(f.snapshot().ui.visible,false);
    await f.auth();record('returning authentication',action('authSetup',false));
    assert.equal(f.snapshot().ui.visible,false);
    await f.reopen();record('explicit completed review',action('reopen'));
    await f.click('Close');record('review closes without rewriting completion',action('closeReview'));
  });
  await scenario('new-account-completion-and-remount', {progress:{version:4,status:'completed',step:7}},async(f,record)=>{
    await f.auth(true);record('new account ready',action('authSetup',true));
    await f.click('Done');record('new account acknowledged',action('finish'));
    await f.remount();record('account-created status on remount',restart);
  });
  await scenario('last-step-write-failure-remains-usable',{},async(f,record)=>{
    for(const key of permissionKeys.slice(0,-1)){await f.click('Continue');record(`continued ${key}`,advance);}
    f.failStorage();record('storage fails before final step',action('storageFails'));
    await f.click('Continue');record('ready with failed completion write',advance);
    await f.click('Done');record('session finishes',action('finish'));
    await f.remount();record('durable last step is resumed',restart);
  });
  await scenario('skip-retires-held-request',{permissions:{notifications:false}},async(f,record)=>{
    f.hold('notifications');await f.click('Allow');record('held request',[action('begin'),action('request')]);
    await f.expireSkip();record('twenty-second skip available',action('skipAvailable'));
    await f.click('Skip');record('skip advances session',action('skip'));
    f.state.notifications=true;await f.release('notifications');record('late permission answer',action('staleResult',0));
  });
  await scenario('completed-review-skip-preserves-marker',{progress:{version:4,status:'completed',step:7}},async(f,record)=>{
    await f.reopen();record('review opened',action('reopen'));
    await f.expireSkip();record('skip available',action('skipAvailable'));
    await f.click('Skip');record('review step skipped',action('skip'));
    await f.click('Close');record('review closed',action('closeReview'));
  });
  await scenario('completed-targeted-review',{progress:{version:4,status:'completed',step:7}},async(f,record)=>{
    await f.target('files');record('files target opened',action('openTarget',6));
    await f.click('Settings');record('files settings readback',[action('begin'),action('result',true)]);
    await f.click('Done');record('target closed',action('closeTarget'));
  });
  await scenario('connection-panel-hides-without-fabricating-permission-change',{},async(f,record)=>{
    await f.overlays(true,false);record('connection panel visible',action('overlays',true,false));
    await f.overlays(false,true);record('Google panel visible',action('overlays',false,true));
    await f.overlays(false,false);record('permission panel visible again',action('overlays',false,false));
  });
  await scenario('cancelled-flow-can-recheck-before-old-native-return',{permissions:{notifications:false}},async(f,record)=>{
    f.hold('notifications');await f.click('Allow');record('original native request',[action('begin'),action('request')]);
    await f.expireSkip();record('skip available',action('skipAvailable'));
    await f.click('Skip');record('flow cancelled',action('skip'));
    await f.target('notifications');record('same permission reopened',observation=>[action('openTarget',0),...statuses(observation)]);
    await f.click('Settings');record('new flow checks while old native request remains',[action('begin'),action('result',false)]);
    f.state.notifications=true;await f.release('notifications');record('old native return',action('staleResult',0));
    await f.click('Settings');record('current flow sees grant',[action('begin'),action('result',true)]);
    await f.click('Done');record('target done',action('closeTarget'));
  });
  await scenario('closing-review-retires-held-request',{progress:{version:4,status:'completed',step:7},permissions:{notifications:false}},async(f,record)=>{
    await f.reopen();record('completed review opened',action('reopen'));
    f.hold('notifications');await f.click('Allow');record('review request held',[action('begin'),action('request')]);
    await f.click('Close');record('review closed',action('closeReview'));
    f.state.notifications=true;await f.release('notifications');record('late closed-review return',action('staleResult',0));
  });
  await scenario('same-turn-setup-revision-fences-completion',{permissions:{notifications:false}},async(f,record)=>{
    f.hold('notifications');await f.click('Allow');record('request held',[action('begin'),action('request')]);
    f.state.notifications=true;await f.setupAndSettle('notifications');
    record('new setup revision before passive effects',[action('authSetup',false),action('staleResult',0)]);
    assert.equal(f.snapshot().component.progress.step,0);
  });
  await scenario('native-location-and-photo-disclosures',{},async(f,record)=>{
    await f.target('location');record('location review',observation=>[action('openTarget',3),...statuses(observation)]);
    assert(f.snapshot().ui.status.includes('Approximate'));
    f.state.locationAccuracy='precise';await f.resume();record('precise readback',statuses);
    assert(f.snapshot().ui.status.includes('Precise'));
    await f.target('photos');record('photo review',observation=>[action('openTarget',5),...statuses(observation)]);
    for(const scope of ['partial','full','denied']){f.state.photos=scope;await f.resume();record(`photo scope ${scope}`,statuses);}
  });
  await scenario('signed-out-explicit-reopen',{signedOut:true},async(f,record)=>{
    await f.reopen();record('owner explicitly reopens permission setup',action('reopen'));
    await f.click('Continue');record('explicit review proceeds without a Cloud account',advance);
  });
  await scenario('direct-provider-setup-without-cloud-account',{signedOut:true},async(f,record)=>{
    await f.auth();record('direct provider setup revision',action('authSetup',false));
    await f.connection(null,true);record('caller enables direct provider',action('directEnabled'));
    await f.click('Continue');record('local permission step proceeds',advance);
  });
  await scenario('same-credential-environment-change-fences-callback',{permissions:{notifications:false}},async(f,record)=>{
    f.hold('notifications');await f.click('Allow');record('production request held',[action('begin'),action('request')]);
    f.state.notifications=true;await f.ownerAndSettle('owner-a','notifications',false,true,'staging');
    record('staging context before passive effects',[action('ownerChange'),action('staleResult',0)]);
    assert.equal(f.snapshot().component.progress.step,0);
  });
  await scenario('browser-four-ready-completion-and-remount',{native:false},async(f,record)=>{
    for(const key of permissionKeys.slice(0,4)){assert.equal(f.snapshot().ui.heading,key[0].toUpperCase()+key.slice(1));
      await f.click('Continue');record(`continued ${key}`,advance);}
    await f.click('Done');record('browser setup complete',action('finish'));
    await f.remount();record('browser completed remount',restart);
  });
  await scenario('browser-denial-check-and-grant',{native:false,permissions:{notifications:false}},async(f,record)=>{
    await f.click('Allow');record('browser denied',[action('begin'),action('request'),action('result',false)]);
    await f.click('Check');record('browser still denied',[action('begin'),action('result',false)]);
    f.state.notifications=true;await f.click('Check');record('browser granted on readback',advance);
  });
  await scenario('browser-skipped-media-callback-stops-tracks',{native:false,permissions:{microphone:'prompt'}},async(f,record)=>{
    await f.click('Continue');record('microphone step',advance);
    f.hold('microphone');await f.click('Allow');record('media request held',[action('begin'),action('request')]);
    await f.expireSkip();record('skip timer',action('skipAvailable'));
    await f.click('Skip');record('media request skipped',action('skip'));
    f.state.microphone='granted';await f.release('microphone');record('late media callback',action('staleResult',1));
    assert.equal(f.calls.filter(call=>call.kind==='stop'&&call.key==='microphone').length,1);
  });
  await scenario('browser-unavailable-provider',{native:false,unsupportedMedia:true},async(f,record)=>{
    await f.click('Continue');record('unavailable microphone step',advance);
    await f.click('Try again');record('unavailable provider readback',[action('begin'),action('resultState','unavailable')]);
    assert.equal(f.calls.filter(call=>call.kind==='request').length,0);
  });
  await scenario('browser-completed-target-ready-is-read-only',{native:false,progress:{version:1,status:'completed',step:4}},async(f,record)=>{
    await f.target('camera');record('camera review',action('openTarget',2));
    await f.click('Done');record('browser target done',action('closeTarget'));
    assert.equal(f.calls.filter(call=>call.kind==='request').length,0);
  });
  if(!checkModel)return {scenarios,traces,sourceHashes:component.driverHashes};
  const receipt=await checkTraces({model:'PermissionChoices',id:'PermissionChoicesCoordinator',batchSize:8,sources:component.sources,
    driverHashes:component.driverHashes,traces,scope:'bounded-orchestration',assumptions:[
      'Actual React component, staged shared permission-flow implementation and progress helpers execute in JSDOM.',
      'Seven native bridges and four browser permission APIs are controlled ports. No device permission or real provider action occurs.',
      'Hook observers forward every call to React. Read-only compile-time observers capture the component local ticket/key/state and the shared flow pending ownership, without changing guards or return values.',
      'The model bounds generations to twelve, with seven native or four browser permission identities. These traces exercise finite owner, callback, lifecycle and storage schedules.',
      'Progress writes may fail or silently drop. Permission-attempt marker writes succeed in these traces. Native OS ownership, browser provider implementation and arbitrary callback schedules are separate obligations.',
    ]});
  assert.deepEqual(captureInputs(component.sources),component.driverHashes,'Source or driver changed while the coordinator executed');
  return {receipt,scenarios,sourceHashes:component.driverHashes,obligations:[
    {model:'PermissionChoices',obligation:'Every browser timeout, query-failure and native callback outcome',reason:'The coordinator runs both profiles with a finite selection of provider outcomes.'},
    {model:'PermissionChoices',obligation:'Platform callback behavior and arbitrary external-panel interleavings',reason:'Ports and schedules are controlled. Passing traces are bounded evidence.'},
  ]};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runPermissionChoicesRefinement(),null,2));
}
