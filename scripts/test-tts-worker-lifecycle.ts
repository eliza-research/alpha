// Exercise the pinned upstream service with synthetic pipes, without loading native
// assets, starting a provider, or importing the host's credential-bearing entrypoint.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../test/support/strip-types.mjs';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {fileURLToPath} from 'node:url';
import type {SpawnOptions} from 'node:child_process';

interface WorkerService {
 readonly busy:boolean;
 readonly initialized:boolean;
 initialize():Promise<void>;
 stop():void;
}
type TtsConstructor=new()=>WorkerService&{synthesize(id:string,text:string,signal:AbortSignal):Promise<Buffer>};
type AsrConstructor=new()=>WorkerService&{transcribe(id:string,samples:Buffer,rate:number,signal:AbortSignal):Promise<string>};

function fixtureChild() {
 const stdin=new PassThrough(),output=new PassThrough();
 return Object.assign(new EventEmitter(),{
  stdin,
  stdio:[stdin,null,null,output] as const,
  killed:false,
  kill(signal:NodeJS.Signals){assert.equal(signal,'SIGKILL');this.killed=true;return true;},
 });
}

const source=fs.readFileSync(new URL('../vendor/eliza/packages/app/src/api/standalone-speech-service.ts',import.meta.url),'utf8');
const children:ReturnType<typeof fixtureChild>[]=[];
const latestChild=()=>{const child=children.at(-1);assert.ok(child);return child;};
Object.assign(process.env,{ELIZA_INFERENCE_LIBRARY:'/synthetic/lib',ELIZA_INFERENCE_LIBRARY_SHA256:'a'.repeat(64),ELIZA_PARADEE_MODEL_DIR:'/synthetic/tts',ELIZA_ASR_MODEL_DIR:'/synthetic/asr',CEREBRAS_API_KEY:'synthetic-not-forwarded',ELIZA_WHISPER_BINARY:'/retired'});
const imports=new Map([
 ['node:child_process',new vm.SyntheticModule(['spawn'],function(){this.setExport('spawn',(_command:string,_args:string[],options:SpawnOptions)=>{
  assert.equal(options.env?.ELIZA_INFERENCE_LIBRARY,'/synthetic/lib');
  assert.equal(options.env?.ELIZA_INFERENCE_LIBRARY_SHA256,'a'.repeat(64));
  assert.equal(options.env?.CEREBRAS_API_KEY,undefined);assert.equal(options.env?.ELIZA_WHISPER_BINARY,undefined);
  const child=fixtureChild();children.push(child);return child;
 });})],
 ['node:url',new vm.SyntheticModule(['fileURLToPath'],function(){this.setExport('fileURLToPath',fileURLToPath);})],
]);
const module=new vm.SourceTextModule(stripTypeScriptTypes(source),{initializeImportMeta:meta=>{meta.resolve=()=> 'file:///synthetic-worker.ts';}});
const link=(name:string)=>{const dependency=imports.get(name);assert.ok(dependency,`Unexpected service import: ${name}`);return dependency;};
await module.link(link);await module.evaluate();
const asrModule=new vm.SourceTextModule(stripTypeScriptTypes(fs.readFileSync(new URL('../vendor/eliza/packages/app/src/api/standalone-asr-service.ts',import.meta.url),'utf8'),{mode:'strip'}),{initializeImportMeta:meta=>{meta.resolve=()=> 'file:///synthetic-asr-worker.ts';}});
await asrModule.link(name=>name==='./standalone-speech-service'?module:link(name));await asrModule.evaluate();
const {StandaloneTtsService}=module.namespace as {StandaloneTtsService:TtsConstructor};
const {StandaloneAsrService}=asrModule.namespace as {StandaloneAsrService:AsrConstructor};
class TestAsrService extends StandaloneAsrService {
 synthesize(id:string,_text:string,signal:AbortSignal){return this.transcribe(id,Buffer.from([1,0]),16000,signal);}
}
for(const Service of [StandaloneTtsService,TestAsrService]) {
const ready=(child:ReturnType<typeof fixtureChild>)=>child.stdio[3].emit('data',Buffer.from('{"ready":true}\n'));
const id='00000000-0000-0000-0000-000000000001';

for(const phase of ['boot','synthesis'])for(const stream of ['input','output']){
 const service=new Service();
 try{
  let pending:Promise<unknown>=service.initialize();const child=latestChild();
  if(phase==='synthesis'){
   ready(child);await pending;pending=service.synthesize(id,'Synthetic speech',new AbortController().signal);await Promise.resolve();
   assert.equal(service.busy,true);
  }
  const rejected=assert.rejects(pending,/stopped/);
  assert.doesNotThrow(()=>(stream==='input'?child.stdin:child.stdio[3]).emit('error',Error('EPIPE')));
  await rejected;assert.equal(service.initialized,false);assert.equal(service.busy,false);assert.equal(child.killed,true);
  // A late error from the old generation must not retire a newly initialized worker.
  const reboot=service.initialize(),replacement=latestChild();assert.notEqual(replacement,child);ready(replacement);await reboot;
  child.stdin.emit('error',Error('late EPIPE'));assert.equal(service.initialized,true);assert.equal(replacement.killed,false);
 }finally{service.stop();}
}
{
 const service=new Service();
 try{
  const boot=service.initialize(),child=latestChild();ready(child);await boot;
  const controller=new AbortController(),pending=service.synthesize(id,'Synthetic speech',controller.signal);await Promise.resolve();
  const rejected=assert.rejects(pending,/cancelled/);controller.abort();await rejected;
  assert.equal(child.killed,false);assert.equal(service.busy,true);
  child.stdio[3].emit('data',Buffer.from(JSON.stringify({id,error:'cancelled'})+'\n'));
  assert.equal(service.initialized,true);assert.equal(service.busy,false);
 }finally{service.stop();}
}
{
 const service=new Service();
 try{
  const before=children.length,boot=service.initialize(),child=latestChild();
  const controller=new AbortController();
  const speech=service.synthesize(id,'First phrase while startup is warming',controller.signal);
  const rejected=assert.rejects(speech,/cancelled/);
  await Promise.resolve();assert.equal(children.length,before+1,'First request shares the cold startup worker');
  assert.equal(service.initialized,false);assert.equal(service.busy,false);
  ready(child);await boot;await Promise.resolve();
  assert.equal(service.initialized,true);assert.equal(service.busy,true);
  controller.abort();await rejected;assert.equal(child.killed,false);assert.equal(service.busy,true);
  child.stdio[3].emit('data',Buffer.from(JSON.stringify({id,error:'cancelled'})+'\n'));assert.equal(service.busy,false);
 }finally{service.stop();}
}
}
console.log('Shared TTS/ASR worker pipe failures, generation fencing and cancellation drain passed.');
