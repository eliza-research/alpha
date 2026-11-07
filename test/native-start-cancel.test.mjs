// The actual Android bridge in local-agent.ts, with Capacitor replaced by a synthetic native
// plugin. No device or runtime: this proves only what the renderer sends across the bridge.
import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const stub=`export const Capacitor={isNativePlatform:()=>true,isPluginAvailable:()=>true,getPlatform:()=>'android',convertFileSrc:value=>value};
export function registerPlugin(name){const plugins=globalThis.__alphaNativePlugins??={};return plugins[name]??={};}
export class WebPlugin {}`;
const output=await build({entryPoints:['apps/app/src/runtime/local-agent.ts'],bundle:true,platform:'node',format:'esm',write:false,define:{'import.meta.env':'{}'},logLevel:'silent',
 plugins:[{name:'native-stub',setup(b){b.onResolve({filter:/^(@capacitor\/core|\.\.\/platform-plugins)$/},a=>({path:a.path,namespace:'native-stub'}));b.onLoad({filter:/.*/,namespace:'native-stub'},()=>({contents:stub,loader:'js'}));}}]});
const {LocalAgentProtocol}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
const agent=globalThis.__alphaNativePlugins.Agent;

test('cancelling a native start reaches cancelStart with the same requestId',async()=>{
 const starts=[],cancels=[];let settle;
 agent.start=input=>{starts.push(input);return new Promise(resolve=>{settle=resolve;});};
 agent.cancelStart=async input=>{cancels.push(input);};
 const controller=new AbortController();
 const connecting=new LocalAgentProtocol().connect(controller.signal);
 assert.equal(starts.length,1);assert.match(starts[0].requestId,/^[0-9a-f-]{36}$/);
 controller.abort();
 await assert.rejects(connecting,{name:'AbortError'});
 assert.deepEqual(cancels,[{requestId:starts[0].requestId}]);
 settle({state:'ready'});
});

test('a start that completes sends no cancellation',async()=>{
 const cancels=[];
 agent.start=async()=>({state:'ready'});
 agent.cancelStart=async input=>{cancels.push(input);};
 agent.request=async({path})=>({status:200,body:JSON.stringify(path==='/api/auth/me'?{identity:{id:'00000000-0000-4000-8000-000000000001',kind:'owner'},access:{role:'OWNER',mode:'local'}}:{agents:[{id:'00000000-0000-4000-8000-000000000002',name:'Agent',status:'running'}]})});
 const result=await new LocalAgentProtocol().connect(new AbortController().signal);
 assert.equal(result.name,'Agent');assert.deepEqual(cancels,[]);
});
