import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {loadBrowserModule} from './fixtures/browser-source.mjs';

const bundled=await build({entryPoints:['apps/app/src/runtime/browser-cloud-resident.ts'],bundle:true,platform:'node',format:'esm',write:false,define:{'import.meta.env':JSON.stringify({DEV:true,VITE_ALPHA_CLOUD_RESIDENT:'1'})},logLevel:'silent'});
const {browserProviderCall,browserResidentCall}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const status={mode:'cloud',revision:'next',persistence:'host-session',keys:{text:{configured:true},voice:{configured:true}},provider:'elizacloud',configured:true,selected:true,voiceConfigured:false,model:'cerebras/qwen-3.8-27b',attachable:true};

for(const [field,value] of [['mode',['cloud']],['mode',['own']],['provider',['cerebras']],['provider',['elizacloud']],['persistence',['host-session']],['revision',['next']],['model',['cerebras/qwen-3.8-27b']],['configured',[true]],['voiceConfigured',[true]],['keys',{text:{configured:[true]},voice:{configured:true}}]]){
 test(`provider transport rejects array values in ${field}: ${JSON.stringify(value)}`,async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({...status,[field]:value});
  try{
   await assert.rejects(browserProviderCall('residentProviderSelect',{mode:'cloud',expectedRevision:'previous'}),{message:'Provider settings unavailable. Refresh and try again.'});
  }finally{globalThis.fetch=original;}
 });
}

test('provider transport returns exact primitive status fields',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json(status);
 try{assert.deepEqual(await browserProviderCall('residentProviderSelect',{mode:'cloud',expectedRevision:'previous'}),status);}
 finally{globalThis.fetch=original;}
});


test('cold resident startup has its own wait budget and keeps cancellation',async()=>{
 const fetch=globalThis.fetch,timeout=AbortSignal.timeout,waits=[];
 AbortSignal.timeout=milliseconds=>{waits.push(milliseconds);return new AbortController().signal;};
 globalThis.fetch=async()=>Response.json({state:'host-managed'});
 try{
  await browserResidentCall('residentStart');
  await browserResidentCall('residentStatus');
  assert.deepEqual(waits,[310000,120000]);
  const controller=new AbortController();controller.abort();
  await assert.rejects(browserResidentCall('residentStart',undefined,undefined,undefined,controller.signal),{name:'AbortError'});
 }finally{globalThis.fetch=fetch;AbortSignal.timeout=timeout;}
});

test('the resident start receives its owning connection cancellation signal',async()=>{
 const [{LocalAgentProtocol}]=await loadBrowserModule(['apps/app/src/runtime/local-agent.ts'],{testMocks:true});
 let seen;
 const client=new LocalAgentProtocol({start(_input,signal){seen=signal;return new Promise(()=>{});},async request(){throw Error('Cancelled start cannot read identity');}});
 const controller=new AbortController(),pending=client.connect(controller.signal);
 controller.abort();
 await assert.rejects(pending,{name:'AbortError'});
 assert.equal(seen,controller.signal);
});
