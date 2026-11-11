import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';

let loads=0;
async function load(entry,stubs){
 const filter=new RegExp('^('+Object.keys(stubs).map(key=>key.replace(/[.*+?^${}()|[\]\\/]/g,'\\$&')).join('|')+')$');
 const bundle=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'neutral',logLevel:'silent',plugins:[{name:'stubs',setup(builder){builder.onResolve({filter},args=>({path:args.path,namespace:'stub'}));builder.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js'}));}}]});
 // Each load evaluates a fresh module so its subscription binds to this test's state.
 return import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text+`\n//${++loads}`).toString('base64'));
}

async function cloudMaps(){
 const state=globalThis.cloudMapsTest={client:{sessionId:'s1',credentialId:'c1',client:{}},listeners:[],retired:0};
 await load('apps/app/src/maps/cloud-maps.ts',{
  './cloud-provider':'export const createCloudMaps=()=>({initializeCloudMaps(){},cloudMapsCoverage(){},cloudMapsDiagnostics:()=>({configured:true}),retireCloudMaps:()=>globalThis.cloudMapsTest.retired++});',
  './cloud-session':'export const captureMapsSession=read=>read();',
  './runtime':'export const configureMapsProvider=()=>{};',
  '../runtime/connection-ui':'export const connectionController={getCloudClient:()=>globalThis.cloudMapsTest.client,subscribe:listener=>globalThis.cloudMapsTest.listeners.push(listener)};',
  '../runtime/subscription-entitlement.ts':'export const readServiceLimit=()=>undefined;',
 });
 const update=client=>{state.client=client;for(const listener of state.listeners)listener();};
 return {state,update};
}

test('a rebuilt client for the same session and credential keeps Cloud Maps guidance',async()=>{
 const {state,update}=await cloudMaps();
 update({sessionId:'s1',credentialId:'c1',client:{}});
 update({...state.client});
 assert.equal(state.retired,0);
});

test('a new session or credential retires Cloud Maps',async()=>{
 const {state,update}=await cloudMaps();
 update({sessionId:'s2',credentialId:'c1',client:{}});assert.equal(state.retired,1);
 update({sessionId:'s2',credentialId:'c2',client:{}});assert.equal(state.retired,2);
 update(undefined);assert.equal(state.retired,3);
});

async function share(run){
 globalThis.mapShareTest={run};
 const {shareMap}=await load('apps/app/src/maps/share.ts',{
  '../runtime/text-share':'export const shareSelectedText=(text,signal)=>globalThis.mapShareTest.run(text,signal);',
 });
 return shareMap;
}

test('Maps share waits for the platform chooser and passes its exact selected content',async()=>{
 let finish;const shared=[];
 const shareMap=await share(text=>{shared.push(text);return new Promise(resolve=>finish=resolve);});
 const result=shareMap({title:'Cafe',text:'Cafe',url:'https://example.com/place'},new AbortController().signal);
 let settled=false;void result.then(()=>settled=true);
 await new Promise(resolve=>setTimeout(resolve,0));assert.equal(settled,false);
 finish('opened');assert.equal(await result,'shared');
 assert.deepEqual(shared,[{title:'Cafe',text:'Cafe\nhttps://example.com/place'}]);
});

test('Maps share cancellation returns closed without another destination',async()=>{
 const shareMap=await share(()=>Promise.resolve('closed'));
 assert.equal(await shareMap({title:'Cafe',text:'Cafe'},new AbortController().signal),'closed');
});
