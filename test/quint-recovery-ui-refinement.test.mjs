import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {captureInputs, checkTraces, qset} from '../specs/quint/refinement/check-traces.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(import.meta.url);
const boundary='apps/app/src/runtime/error-boundary.tsx';
const privateMarker='Synthetic private note and account@example.test';
const ports={
  '../build-flags':'export const testMocksEnabled=true;',
  '../platform-plugins':'export const registerPlugin=()=>({});',
  '../platform-plugins.ts':'export const registerPlugin=()=>({});',
  '@capacitor/core':'export const Capacitor={isNativePlatform:()=>false};',
};

async function compile(extraSources){
  const buildOptions={absWorkingDir:root,entryPoints:[boundary],bundle:true,write:false,
    format:'cjs',platform:'node',external:['react','react/jsx-runtime'],jsx:'automatic',metafile:true,
    define:{__APP_VERSION__:'"refinement"'},plugins:[{name:'recovery-test-boundaries',setup(builder){
      builder.onResolve({filter:/^(\.\.\/build-flags|\.\.\/platform-plugins(?:\.ts)?|@capacitor\/core)$/},args=>({path:args.path,namespace:'ports'}));
      builder.onLoad({filter:/.*/,namespace:'ports'},args=>({contents:ports[args.path],loader:'js'}));
      builder.onLoad({filter:/\/error-boundary\.tsx$/},args=>({loader:'tsx',contents:readFileSync(args.path,'utf8')+'\nexport const inspectRecoveryModule=()=>({shown,installed,forced});'}));
    }}]};
  const inputs=output=>Object.keys(output.metafile.inputs).filter(path=>!path.startsWith('ports:'));
  const discovered=inputs(await build(buildOptions));
  const sources=[...new Set([...discovered, 'apps/app/src/build-flags.ts',
    'apps/app/src/platform-plugins.ts','bun.lock','upstream.lock.json',
    'scripts/prepare-client-features.ts',fileURLToPath(import.meta.url),...extraSources,
    '.eliza/client-features/.source.json'])];
  const driverHashes=captureInputs(sources);
  const output=await build(buildOptions);
  assert.deepEqual(inputs(output),discovered,'the captured application module graph remains unchanged');
  return {code:output.outputFiles[0].text,sources,driverHashes};
}

function fixture(code){
  const dom=new JSDOM('<!doctype html><body><div id="root"></div></body>',{
    pretendToBeVisual:true,url:'https://recovery.example.test'});
  const keys=['window','document','HTMLElement','ErrorEvent','Event','localStorage','location'];
  const previous=keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]);
  let reloads=0,renderer=null,instance=null;
  for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,value:key==='location'?{reload(){reloads++;}}:dom.window[key]});
  const originalError=console.error;
  console.error=()=>{};
  dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  const module={exports:{}};
  new Function('require','module','exports',code)(require,module,module.exports);
  const api=module.exports;
  const makeError=(kind,hostile=false)=>{
    if(kind==='string')return privateMarker;
    if(kind==='null')return null;
    const error=kind==='TypeError'?new TypeError(privateMarker):new Error(privateMarker);
    if(hostile)Object.defineProperty(error,'name',{get(){throw Error(privateMarker);}});
    return error;
  };
  function values(){
    const state=api.inspectRecoveryModule(),element=document.getElementById('root');
    const panels=[...document.querySelectorAll('.alpha-recovery')];
    const plain=panels.find(panel=>!element.contains(panel)),reactPanel=panels.find(panel=>element.contains(panel));
    const diagnostics=panel=>panel?.querySelector('pre')?.textContent??'';
    for(const panel of panels){assert.equal(panel.getAttribute('role'),'alertdialog');assert.ok(panel.querySelector('button'));}
    for(const text of panels.map(diagnostics)){
      assert.equal(text.includes(privateMarker),false,'recovery diagnostics exclude private error content');
      assert.equal(text.includes('account@example.test'),false);
    }
    const entries=JSON.parse(localStorage.getItem('alpha.crash-log.v1')||'{"entries":[]}').entries;
    assert.equal(JSON.stringify(entries).includes(privateMarker),false,'problem log excludes private error content');
    const errorClass=panel=>diagnostics(panel).split('\n').find(line=>line.startsWith('error: '))?.slice(7)||'';
    return {'s.installed':state.installed,'s.plain':state.shown,'s.mounted':renderer!==null,
      's.failed':instance?.state.failed??false,'s.healthy':!!element.querySelector('[data-healthy]'),
      's.reactPanel':!!reactPanel,'s.forced':state.forced,'s.dialogs':document.querySelectorAll('dialog[open]').length,
      's.rootInert':element.inert===true,'s.focus':document.activeElement?.closest('.alpha-recovery')?'reload':document.activeElement===document.body?'none':'other',
      's.plainClass':errorClass(plain),'s.reactClass':errorClass(reactPanel),
      's.logged':qset(entries.map(entry=>({kind:entry.kind,errorClass:entry.errorClass}))),'s.reloads':reloads};
  }
  function render(fails,name){
    if(!renderer)renderer=createRoot(document.getElementById('root'));
    function Child(){if(fails)throw makeError(name);return React.createElement('button',{'data-healthy':true},'Working');}
    flushSync(()=>renderer.render(React.createElement(api.RootErrorBoundary,{ref:value=>{instance=value;}},React.createElement(Child))));
  }
  return {values,
    install:()=>api.installGlobalErrorRecovery(),
    openDialog(throws=false){const dialog=document.createElement('dialog');dialog.open=true;if(throws)dialog.close=()=>{throw Error('Fixture close failure');};document.body.append(dialog);},
    focusContent:()=>document.querySelector('[data-healthy]').focus(),
    show:(kind,name,hostile=false)=>api.showRecoveryScreen(kind,makeError(name,hostile)),
    globalError(valid,name,hostile=false){window.dispatchEvent(valid?new ErrorEvent('error',{error:makeError(name,hostile),message:privateMarker}):new Event('error'));},
    rejection(name){const event=new Event('unhandledrejection');Object.defineProperty(event,'reason',{value:makeError(name)});window.dispatchEvent(event);},
    render,
    force:()=>flushSync(()=>window.dispatchEvent(new Event('alpha:force-render-error'))),
    unmount(){flushSync(()=>renderer.unmount());renderer=null;instance=null;},
    reload:()=>document.querySelector('.alpha-recovery button').click(),
    async close(){if(renderer)flushSync(()=>renderer.unmount());await new Promise(resolve=>setTimeout(resolve,0));await new Promise(resolve=>setTimeout(resolve,0));dom.window.close();console.error=originalError;
      for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
  };
}

async function checkRecoveryUI(extraSources=[]){
  const compiled=await compile(extraSources),traces=[];
  const schedules=[
    ['install-resource',[['install'],['install'],['globalError',false,'Error']]],
    ['startup-dialogs',[['install'],['openDialog'],['openDialog',true],['globalError',true,'TypeError'],['reload']]],
    ['before-install',[['globalError',true,'Error'],['rejection','string'],['install'],['rejection','string']]],
    ['mounted-global-events',[['install'],['render',false,'Error'],['focusContent'],['globalError',true,'Error'],['rejection','null']]],
    ['render-dialogs',[['openDialog'],['openDialog',true],['render',true,'TypeError'],['reload']]],
    ['startup-then-render',[['show','startup','Error'],['render',true,'TypeError'],['render',false,'Error'],['reload']]],
    ['render-then-startup',[['render',true,'TypeError'],['show','startup','Error'],['install'],['globalError',true,'Error']]],
    ['sticky-boundary',[['render',true,'Error'],['render',false,'TypeError'],['unmount'],['render',false,'Error']]],
    ['forced-before-mount',[['install'],['force'],['render',false,'Error']]],
    ['forced-after-mount',[['install'],['render',false,'Error'],['force'],['force'],['unmount'],['render',false,'Error']]],
    ['forced-without-install',[['force'],['render',false,'Error']]],
    ['repeated-plain',[['show','startup','Error'],['show','uncaught','TypeError'],['reload'],['reload']]],
    ['plain-survives-unmount',[['show','startup','Error'],['render',false,'Error'],['unmount'],['rejection','null']]],
    ['hostile-startup',[['install'],['globalError',true,'Error',true]]],
  ];
  for(const [name,steps]of schedules){
    const f=fixture(compiled.code),trace={name,init:{name:'init'},expect:f.values(),steps:[]};
    try{for(const [action,...args]of steps){f[action](...args);trace.steps.push({label:'actual '+action,
      action:{name:action,args:action==='openDialog'?[]:args.slice(0,action==='globalError'?2:action==='show'?2:args.length)},expect:f.values()});}}
    finally{await f.close();}
    traces.push(trace);
  }
  return checkTraces({model:'RendererFailureUI',sources:compiled.sources,driverHashes:compiled.driverHashes,traces,
    scope:'bounded-orchestration',assumptions:[
      'Actual RootErrorBoundary, startup listeners, recovery DOM and crash-log source execute in JSDOM with the installed React renderer. A read-only export observes module flags.',
      'Native registration, build flags, navigation reload and dialog close are controlled ports. Reload requests are counted without navigating or asserting a fresh process.',
      'Four failure-class representatives, two dialogs and two reload requests bound these schedules. Logging executes in one throttle window. The test-only forced-error listener is explicitly enabled.',
      'JSDOM does not establish browser top-layer rendering, inert enforcement, assistive technology, installed WebView behavior or Android renderer-process recovery.',
    ]});
}

test('actual startup and React failures share one private-content-free recovery surface',{timeout:60000},async()=>{
  const receipt=await checkRecoveryUI([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,14);
  assert.equal(receipt.driverInputsBound,true);
  assert.equal(receipt.inputsUnchanged,true);
});
