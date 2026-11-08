// Where an "agent unavailable" tap goes: the real module, with the platform, build flag and connection controller replaced.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';

async function load(native,mocks){
 const stubs={'@capacitor/core':`export const Capacitor={isNativePlatform:()=>${native}};`,'../build-flags':`export const testMocksEnabled=${mocks};`,'./connection-ui':'export const connectionController={open:()=>globalThis.chooserOpened++};'};
 const source=readFileSync('apps/app/src/prototype/workflow-authoring.ts','utf8');
 const contents="import {Capacitor} from '@capacitor/core';import {testMocksEnabled} from '../build-flags';import {connectionController} from './connection-ui';\n"+source.slice(source.indexOf('type AgentStatusShell ='));
 const bundle=await build({stdin:{contents,loader:'ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',logLevel:'silent',plugins:[{name:'stubs',setup(builder){builder.onResolve({filter:/^(@capacitor\/core|\.\.\/build-flags|\.\/connection-ui)$/},args=>({path:args.path,namespace:'stub'}));builder.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js'}));}}]});
 return import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
}
function shell(view){const opened=[];return {opened,S:()=>({view}),openView:(...args)=>opened.push(args)};}

test('product Android opens Settings > Agent connection and Back returns to the calling view',async()=>{
 const {showAgentStatus}=await load(true,false);globalThis.chooserOpened=0;
 const fromWorkflows=shell('workflows');showAgentStatus(fromWorkflows);
 assert.deepEqual(fromWorkflows.opened,[['settings',{page:'agent-connection'},undefined,{push:true}]]);
 const fromHome=shell(null);showAgentStatus(fromHome);
 assert.deepEqual(fromHome.opened,[['settings',{page:'agent-connection'},undefined,{push:false}]]);
 assert.equal(globalThis.chooserOpened,0);
});
test('development and browser builds keep the connection chooser',async()=>{
 for(const [native,mocks] of [[true,true],[false,false],[false,true]]){
  const {showAgentStatus}=await load(native,mocks);globalThis.chooserOpened=0;const target=shell('workflows');
  showAgentStatus(target);assert.deepEqual(target.opened,[]);assert.equal(globalThis.chooserOpened,1);
 }
 const {showAgentStatus}=await load(true,false);globalThis.chooserOpened=0;showAgentStatus(null);assert.equal(globalThis.chooserOpened,1);
});
