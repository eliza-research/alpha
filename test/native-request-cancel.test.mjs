// Both ends of withdrawing a plain local-agent request. The renderer half bundles the actual
// local-agent.ts bridge over a synthetic native plugin; the native half compiles the actual
// request worker and cancelRequest from AlphaLocalAgentPlugin.java on the host JVM with finite
// Capacitor and transport fixtures. No device or runtime: neither half is Android evidence.
import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
import path from 'node:path';
const stub=`export const Capacitor={isNativePlatform:()=>true,isPluginAvailable:()=>true,getPlatform:()=>'android',convertFileSrc:value=>value};
export function registerPlugin(name){const plugins=globalThis.__alphaNativePlugins??={};return plugins[name]??={};}
export class WebPlugin {}`;
const output=await build({entryPoints:['apps/app/src/runtime/local-agent.ts'],bundle:true,platform:'node',format:'esm',write:false,define:{'import.meta.env':'{}'},logLevel:'silent',
 plugins:[{name:'native-stub',setup(b){b.onResolve({filter:/^(@capacitor\/core|\.\.\/platform-plugins)$/},a=>({path:a.path,namespace:'native-stub'}));b.onLoad({filter:/.*/,namespace:'native-stub'},()=>({contents:stub,loader:'js'}));}}]});
const {LocalAgentProtocol}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
const agent=globalThis.__alphaNativePlugins.Agent;

test('aborting a plain native request withdraws it by the id sent with it',async()=>{
 const requests=[],cancels=[];let settle;
 agent.request=input=>{requests.push(input);return new Promise(resolve=>{settle=resolve;});};
 agent.cancelRequest=async input=>{cancels.push(input);return {withdrawn:true};};
 const controller=new AbortController();
 const reading=new LocalAgentProtocol().request('/api/agents',undefined,controller.signal);
 assert.equal(requests.length,1);assert.match(requests[0].cancelId,/^[0-9a-f-]{36}$/);
 assert.deepEqual(cancels,[]);
 controller.abort();
 await assert.rejects(reading,{name:'AbortError'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(cancels,[{cancelId:requests[0].cancelId}]);
 settle({status:200,body:'{}'});
});

test('a request that completes sends no withdrawal, and each request has its own id',async()=>{
 const requests=[],cancels=[];
 agent.request=async input=>{requests.push(input);return {status:200,body:'{"ok":true}'};};
 agent.cancelRequest=async input=>{cancels.push(input);};
 const controller=new AbortController(),protocol=new LocalAgentProtocol();
 assert.deepEqual(await protocol.request('/api/agents',undefined,controller.signal),{ok:true});
 assert.deepEqual(await protocol.request('/api/status',undefined,controller.signal),{ok:true});
 controller.abort();
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(cancels,[]);
 assert.equal(requests.length,2);assert.notEqual(requests[0].cancelId,requests[1].cancelId);
});

test('a native build without cancelRequest still reports the abort',async()=>{
 agent.request=()=>new Promise(()=>{});delete agent.cancelRequest;
 const controller=new AbortController();
 const reading=new LocalAgentProtocol().request('/api/agents',undefined,controller.signal);
 controller.abort();
 await assert.rejects(reading,{name:'AbortError'});
 await new Promise(resolve=>setImmediate(resolve));
});
