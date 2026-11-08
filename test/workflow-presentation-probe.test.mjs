import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {build} from 'esbuild';
// The workflow presentation probe tells a stalled bridge from one that lacks the method, and keeps a
// protocol 2 answer for the process. The native bridge is a synthetic stand-in.
const output=await build({entryPoints:[resolve(import.meta.dirname,'../apps/app/src/runtime/workflow-presentation.ts')],bundle:true,format:'esm',platform:'node',write:false,
 plugins:[{name:'bridge',setup(b){b.onResolve({filter:/^@capacitor\/core$/},()=>({path:'bridge',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const Capacitor={isNativePlatform:()=>true};export function registerPlugin(name){return {workflowPresentationCapabilities:()=>globalThis.bridge(name)};}',loader:'js'}));}}]});
const code=output.outputFiles[0].text;
let copies=0;
const fresh=()=>import(`data:text/javascript;base64,${Buffer.from(`${code}\n// ${copies++}`).toString('base64')}`);
const signal=()=>new AbortController().signal;
test('a bridge that stalls once and then answers 2 is protocol 2',async()=>{
 const P=await fresh();let calls=0;
 globalThis.bridge=()=>++calls<=2?new Promise(()=>{}):Promise.resolve({protocol:2});
 assert.equal(await P.workflowPresentationProtocol(signal()),2);
 assert.equal(calls,4);
});
test('a bridge without the method is protocol 1 and is asked again next time',async()=>{
 const P=await fresh();let calls=0;
 globalThis.bridge=()=>{calls++;return Promise.reject(Object.assign(new Error('not implemented'),{code:'UNIMPLEMENTED'}));};
 assert.equal(await P.workflowPresentationProtocol(signal()),1);
 assert.equal(calls,2);
 globalThis.bridge=()=>Promise.resolve({protocol:2});
 assert.equal(await P.workflowPresentationProtocol(signal()),2);
});
test('a protocol 2 answer is kept for the process',async()=>{
 const P=await fresh();let calls=0;
 globalThis.bridge=()=>{calls++;return Promise.resolve({protocol:2});};
 assert.equal(await P.workflowPresentationProtocol(signal()),2);
 globalThis.bridge=()=>Promise.reject(new Error('not implemented'));
 assert.equal(await P.workflowPresentationProtocol(signal()),2);
 assert.equal(calls,2);
});
test('a bridge that stalls twice is protocol 1 for this call only',async()=>{
 const P=await fresh();
 globalThis.bridge=()=>new Promise(()=>{});
 assert.equal(await P.workflowPresentationProtocol(signal()),1);
 globalThis.bridge=()=>Promise.resolve({protocol:2});
 assert.equal(await P.workflowPresentationProtocol(signal()),2);
});
