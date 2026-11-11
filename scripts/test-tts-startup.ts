import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../test/support/strip-types.mjs';

interface FixtureState {current:object}
interface FixtureResponse {status?:number;body?:{ready?:boolean}}
interface SpeechRoutes {
 warmStandaloneSpeech(state:FixtureState):void;
 closeStandaloneSpeech(state:FixtureState):void;
 handleStandaloneSpeechRoute(request:{method:string;url:string},response:FixtureResponse,state:FixtureState):Promise<boolean>;
}

// Exercise upstream host ownership without native assets or provider credentials.
const source=fs.readFileSync(process.argv[2] || new URL('../vendor/eliza/packages/app/src/api/standalone-speech-routes.ts',import.meta.url),'utf8');
for(const enabled of [false,true])for(const failure of [false,true]){
 let calls=0,warnings=0;
 const services:Service[]=[];
 const boot=Promise.withResolvers<void>();
 class Service{
  ready=false;
  constructor(){services.push(this);}
  get initialized(){return this.ready;}
  initialize(){calls++;return (calls===1?boot.promise:Promise.resolve()).then(()=>{this.ready=true;});}
  stop(){this.ready=false;}
 }
 const context=vm.createContext({URL,Map,WeakMap,WeakSet,Date,process:{env:{ELIZA_PARADEE_ENABLED:enabled?'1':'0',ELIZA_ASR_ENABLED:'0'},versions:{bun:'fixture'}},console:{warn:()=>warnings++}});
 const dependencies=new Map<string, Record<string,unknown>>([
  ['./standalone-speech-service',{StandaloneTtsService:Service}],
  ['./standalone-asr-service',{AsrAudioError:class extends Error{},readMonoPcm16Wav:()=>{throw Error('Unexpected ASR audio');},StandaloneAsrService:class{initialize(){throw Error('Disabled ASR must not initialize');}stop(){}}}],
  ['./auth',{resolveAuthorizedRouteRole:async()=>({ok:true,role:'OWNER',identityId:'synthetic-owner'})}],
  ['./response',{sendJson:(res:FixtureResponse,status:number,body:FixtureResponse['body'])=>Object.assign(res,{status,body})}],
 ]);
 let sanitizerImports=0;
 const module=new vm.SourceTextModule(stripTypeScriptTypes(source),{context,importModuleDynamically:async name=>{
  assert.equal(name,'@elizaos/plugin-local-inference/routes');sanitizerImports++;
  const helper=new vm.SyntheticModule(['sanitizeLocalInferenceSpeechText'],function(){this.setExport('sanitizeLocalInferenceSpeechText',(value:string)=>value);},{context});
  await helper.link(name=>{throw Error(`Unexpected sanitizer dependency ${name}`);});await helper.evaluate();return helper;
 }});
 await module.link(name=>{const exports=dependencies.get(name);assert.ok(exports,`Unexpected dependency ${name}`);return new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value);},{context});});
 await module.evaluate();
 const routes=module.namespace as SpeechRoutes;
 assert.equal(calls,0,'Importing routes cannot create a process-global worker');
 const state={current:{}};
 routes.warmStandaloneSpeech(state);
 assert.equal(calls,enabled?1:0,'Only configured hosts warm before any request');
 assert.equal(sanitizerImports,enabled?1:0);
 if(enabled){assert.equal(services[0].initialized,false);if(failure)boot.reject(Error('synthetic cold failure'));else boot.resolve();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(services[0].initialized,!failure);assert.equal(warnings,failure?1:0);}
 const res:FixtureResponse={};
 await routes.handleStandaloneSpeechRoute({method:'GET',url:'/api/tts/paradee/status'},res,state);
 assert.equal(res.status,200);assert.equal(res.body?.ready,enabled);
 assert.equal(calls,enabled?2:0,'Failed startup remains retryable; disabled speech stays unloaded');
 const other={current:{}};
 routes.warmStandaloneSpeech(other);
 await new Promise(resolve=>setImmediate(resolve));
 routes.closeStandaloneSpeech(state);
 const before=calls;routes.warmStandaloneSpeech(state);
 assert.equal(calls,before,'Closing a host prevents resurrection');
 if(enabled){assert.equal(services[0].initialized,false);assert.equal(services[1].initialized,true,'Closing one host leaves another host alive');}
 const closed:FixtureResponse={};await routes.handleStandaloneSpeechRoute({method:'GET',url:'/api/tts/paradee/status'},closed,state);
 assert.equal(closed.status,503);
 routes.closeStandaloneSpeech(other);
}
console.log('Paradee startup warming preserves real readiness, retries, host isolation and close ownership.');
