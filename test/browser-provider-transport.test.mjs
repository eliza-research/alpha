import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundled=await build({entryPoints:['apps/app/src/runtime/browser-cloud-resident.ts'],bundle:true,platform:'node',format:'esm',write:false,define:{'import.meta.env':JSON.stringify({DEV:true,VITE_ALPHA_CLOUD_RESIDENT:'1'})},logLevel:'silent'});
const {browserProviderCall}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const status={mode:'cloud',revision:'next',persistence:'host-session',keys:{text:{configured:true},voice:{configured:true}},provider:'elizacloud',configured:true,selected:true,voiceConfigured:false,model:'cerebras/qwen-3.8-27b',attachable:true};

for(const [field,value] of [['mode',['cloud']],['mode',['own']],['provider',['cerebras']],['provider',['elizacloud']],['persistence',['host-session']],['revision',['next']],['model',['cerebras/qwen-3.8-27b']],['configured',[true]],['voiceConfigured',[true]],['keys',{text:{configured:[true]},voice:{configured:true}}]]){
 test(`provider transport rejects array values in ${field}: ${JSON.stringify(value)}`,async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({...status,[field]:value});
  try{
   await assert.rejects(browserProviderCall('residentProviderSelect',{mode:'cloud',expectedRevision:'previous'}),{message:'Unavailable'});
  }finally{globalThis.fetch=original;}
 });
}

test('provider transport returns exact primitive status fields',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json(status);
 try{assert.deepEqual(await browserProviderCall('residentProviderSelect',{mode:'cloud',expectedRevision:'previous'}),status);}
 finally{globalThis.fetch=original;}
});
