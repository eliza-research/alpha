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

// The real session capture over a provider stub that hands back what cloud-maps.ts gave it.
async function boundCloudMaps(){
 const served=[];
 const client=name=>({mapsRequest:async route=>{served.push(name+':'+route);return {from:name};},mapsTile:async()=>{served.push(name+':tile');return new ArrayBuffer(1);}});
 const state=globalThis.cloudMapsTest={client:{sessionId:'s1',credentialId:'c1',client:client('first')},listeners:[],retired:0};
 await load('apps/app/src/maps/cloud-maps.ts',{
  './cloud-provider':'export const createCloudMaps=(capture,configure,options)=>{Object.assign(globalThis.cloudMapsTest,{capture,options});return {initializeCloudMaps(){},cloudMapsCoverage(){},cloudMapsDiagnostics:()=>({configured:true}),retireCloudMaps:()=>globalThis.cloudMapsTest.retired++};};',
  './runtime':'export const configureMapsProvider=()=>{};',
  '../runtime/connection-ui':'export const connectionController={getCloudClient:()=>globalThis.cloudMapsTest.client&&{...globalThis.cloudMapsTest.client},subscribe:listener=>globalThis.cloudMapsTest.listeners.push(listener)};',
  '../runtime/subscription-entitlement.ts':'export const readServiceLimit=()=>undefined;',
 });
 const update=next=>{state.client=next;for(const listener of state.listeners)listener();};
 return {state,update,served,client};
}

test('an installed provider keeps serving requests and tiles through a rebuilt client of the same account',async()=>{
 const {state,update,served,client}=await boundCloudMaps(),signal=new AbortController().signal;
 const request=state.capture(),tile=state.options.tileRequest();
 assert.deepEqual(await request('search',signal,{}),{from:'first'});await tile(1,2,3,signal);
 update({sessionId:'s1',credentialId:'c1',client:client('rebuilt')});
 assert.deepEqual(await request('search',signal,{}),{from:'rebuilt'});await tile(1,2,3,signal);
 assert.deepEqual(served,['first:search','first:tile','rebuilt:search','rebuilt:tile']);
 assert.equal(state.retired,0);
});

test('a provider captured for one account refuses requests and tiles under another session, credential or sign-out',async()=>{
 for(const next of [{sessionId:'s2',credentialId:'c1'},{sessionId:'s1',credentialId:'c2'},undefined]){
  const {state,update,served,client}=await boundCloudMaps(),signal=new AbortController().signal;
  const request=state.capture(),tile=state.options.tileRequest();
  update(next&&{...next,client:client('other')});
  await assert.rejects(request('search',signal,{}),/The Maps account changed/);
  await assert.rejects(tile(1,2,3,signal),/The Maps account changed/);
  assert.deepEqual(served,[]);
 }
});

test('a reply that lands after the account changed is not delivered',async()=>{
 const {state,update,client}=await boundCloudMaps(),signal=new AbortController().signal;
 let finish;state.client={...state.client,client:{mapsRequest:()=>new Promise(resolve=>finish=resolve),mapsTile:()=>new Promise(resolve=>finish=resolve)}};
 const request=state.capture(),tile=state.options.tileRequest();
 const reply=request('route',signal,{});update({sessionId:'s2',credentialId:'c1',client:client('other')});finish({});
 await assert.rejects(reply,/The Maps account changed/);
 update(state.client={sessionId:'s1',credentialId:'c1',client:{mapsTile:()=>new Promise(resolve=>finish=resolve)}});
 const late=state.options.tileRequest()(1,2,3,signal);update(undefined);finish(new ArrayBuffer(1));
 await assert.rejects(late,/The Maps account changed/);
});

async function share(copy){
 globalThis.mapShareTest={copy};
 const {shareMap}=await load('apps/app/src/maps/share.ts',{
  '../runtime/share-panel':'export const sharedTextEmailAvailable=()=>false,composeSharedText=()=>{};export function openSharePanel(options){globalThis.mapShareTest.options=options;return Promise.resolve();}',
  '../runtime/text-share':'export const shareSelectedText=()=>{};export const copySelectedText=text=>globalThis.mapShareTest.copy(text);',
 });
 return shareMap;
}

test('Copy link resolves copied only after the copy settles',async()=>{
 let finish;const copied=[];
 const shareMap=await share(text=>{copied.push(text);return new Promise(resolve=>finish=resolve);});
 const result=shareMap({title:'Cafe',text:'Cafe',url:'https://example.com/place'},new AbortController().signal);
 const {options}=globalThis.mapShareTest;assert.equal(options.copyLabel,'Copy link');
 void options.copy();
 let settled=false;void result.then(()=>settled=true);
 await new Promise(resolve=>setTimeout(resolve,0));assert.equal(settled,false);
 finish();assert.equal(await result,'copied');assert.deepEqual(copied,['https://example.com/place']);
});

test('a failed copy or a closed panel resolves closed',async()=>{
 const failing=await share(()=>Promise.reject(Error('Clipboard unavailable')));
 const result=failing({title:'Cafe',text:'Cafe',url:'https://example.com/place'},new AbortController().signal);
 void globalThis.mapShareTest.options.copy().catch(()=>{});
 assert.equal(await result,'closed');
 const shareMap=await share(()=>Promise.resolve());
 assert.equal(await shareMap({title:'Cafe',text:'Cafe'},new AbortController().signal),'closed');
});
