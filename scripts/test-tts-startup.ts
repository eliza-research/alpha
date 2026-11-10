import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../test/support/strip-types.mjs';

// Exercise upstream host ownership without native assets or provider credentials.
interface SpeechRoutes {warmStandaloneSpeech(state:object):void;closeStandaloneSpeech(state:object):void;handleStandaloneSpeechRoute(request:Record<string,unknown>,response:Record<string,unknown>,state:object):Promise<unknown>}
const source=fs.readFileSync(process.argv[2] || new URL('../vendor/eliza/packages/app/src/api/standalone-speech-routes.ts',import.meta.url),'utf8');
for(const enabled of [false,true])for(const failure of [false,true]){
 let calls=0,warnings=0,release!:()=>void;
 const services: any[]=[];
 const boot=new Promise((resolve: any,reject: any)=>{release=()=>failure?reject(Error('synthetic cold failure')):resolve();});
 class Service{
  ready=false;
  constructor(){services.push(this);}
  get initialized(){return this.ready;}
  initialize(){calls++;return calls===1?boot.then(()=>{this.ready=true;}):Promise.resolve().then(()=>{this.ready=true;});}
  stop(){this.ready=false;}
 }
 const context=vm.createContext({URL,Map,WeakMap,WeakSet,Date,process:{env:{ELIZA_PARADEE_ENABLED:enabled?'1':'0',ELIZA_ASR_ENABLED:'0'},versions:{bun:'fixture'}},console:{warn:()=>warnings++}});
 const dependencies=new Map([
  ['./standalone-speech-service',{StandaloneTtsService:Service}],
  ['./standalone-asr-service',{AsrAudioError:class extends Error{},readMonoPcm16Wav:()=>{throw Error('Unexpected ASR audio');},StandaloneAsrService:class{initialize(){throw Error('Disabled ASR must not initialize');}stop(){}}}],
  ['./auth',{resolveAuthorizedRouteRole:async()=>({ok:true,role:'OWNER',identityId:'synthetic-owner'})}],
  ['./response',{sendJson:(res: any,status: any,body: any)=>Object.assign(res,{status,body})}],
 ]);
 let sanitizerImports=0;
 const module=new vm.SourceTextModule(stripTypeScriptTypes(source),{context,importModuleDynamically:async (name: any)=>{
  assert.equal(name,'@elizaos/plugin-local-inference/routes');sanitizerImports++;
  const helper=new vm.SyntheticModule(['sanitizeLocalInferenceSpeechText'],function(){this.setExport('sanitizeLocalInferenceSpeechText',(value: any)=>value);},{context});
  await helper.link(()=>{throw Error('Unexpected sanitizer helper import');});await helper.evaluate();return helper;
 }});
 await module.link((name: any)=>{const exports=dependencies.get(name);assert.ok(exports,`Unexpected dependency ${name}`);return new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value);},{context});});
 await module.evaluate();
 assert.equal(calls,0,'Importing routes cannot create a process-global worker');
 const state={current:{}};
 (module.namespace as unknown as SpeechRoutes).warmStandaloneSpeech(state);
 assert.equal(calls,enabled?1:0,'Only configured hosts warm before any request');
 assert.equal(sanitizerImports,enabled?1:0);
 if(enabled){assert.equal(services[0].initialized,false);release();await new Promise((resolve: any)=>setImmediate(resolve));assert.equal(services[0].initialized,!failure);assert.equal(warnings,failure?1:0);}
 const res: Record<string, any>={};
 await (module.namespace as unknown as SpeechRoutes).handleStandaloneSpeechRoute({method:'GET',url:'/api/tts/paradee/status'},res,state);
 assert.equal(res.status,200);assert.equal(res.body.ready,enabled);
 assert.equal(calls,enabled?2:0,'Failed startup remains retryable; disabled speech stays unloaded');
 const other={current:{}};
 (module.namespace as unknown as SpeechRoutes).warmStandaloneSpeech(other);
 await new Promise((resolve: any)=>setImmediate(resolve));
 (module.namespace as unknown as SpeechRoutes).closeStandaloneSpeech(state);
 const before=calls;(module.namespace as unknown as SpeechRoutes).warmStandaloneSpeech(state);
 assert.equal(calls,before,'Closing a host prevents resurrection');
 if(enabled){assert.equal(services[0].initialized,false);assert.equal(services[1].initialized,true,'Closing one host leaves another host alive');}
 const closed: Record<string, any>={};await (module.namespace as unknown as SpeechRoutes).handleStandaloneSpeechRoute({method:'GET',url:'/api/tts/paradee/status'},closed,state);
 assert.equal(closed.status,503);
 (module.namespace as unknown as SpeechRoutes).closeStandaloneSpeech(other);
}
console.log('Paradee startup warming preserves real readiness, retries, host isolation and close ownership.');
