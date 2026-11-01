/** Executes only UUID semantics and the first message's pre-provider setup. No model or account is used. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';

const input=process.argv[2];
if(!input||!path.isAbsolute(input))throw Error('Absolute mobile bundle required');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-mobile-turn-'));
try{
 const dest=path.join(temporary,'probe.mjs');
 fs.writeFileSync(dest,fs.readFileSync(input,'utf8')+'\nexport {MessageTurnLifetime as __UUID_TURN_PROBE__,require_dist_node as __UUID_NAMESPACE_PROBE__};\n');
 process.argv=[process.execPath];
 const {__UUID_TURN_PROBE__:Turn,__UUID_NAMESPACE_PROBE__:uuid}=await import(pathToFileURL(dest).href);
 const {v1,v3,v4,v5,v6,v7,parse,stringify,validate,version,NIL,MAX}=uuid();
 const assert=(condition,message)=>{if(!condition)throw Error('UUID semantics: '+message);};
 const random=v4();assert(validate(random)&&version(random)===4,'v4');
 assert(new Set(Array.from({length:64},()=>v4())).size===64,'random UUIDs');
 assert(v4({random:new Uint8Array(16)})==='00000000-0000-4000-8000-000000000000','v4 options');
 const buffer=new Uint8Array(20);assert(v4({random:new Uint8Array(16)},buffer,4)===buffer&&buffer[10]===64&&buffer[12]===128,'v4 buffer offset');
 assert(stringify(parse(random))===random,'parse/stringify');
 assert(v3('hello',NIL)==='a6c0426f-f9a3-3b59-a62f-4807c382b768','v3 known vector');
 assert(v5('hello',NIL)==='b7502f40-1152-59f2-ba10-69aeed522cdf','v5 known vector');
 for(const [fn,expected] of [[v1,1],[v6,6],[v7,7]])assert(version(fn())===expected,'version '+expected);
 assert(validate(NIL)&&validate(MAX)&&!validate('invalid'),'validation');
 let invalid=false;try{parse('invalid');}catch{invalid=true;}assert(invalid,'invalid parse rejects');
 const id='11111111-1111-4111-8111-111111111111';let stage='before-uuid';
 const runtime={agentId:id,logger:{debug(){},warn(){},info(){},error(){}},reportError(){},async getRoom(){return undefined;},getCurrentRunId(){return 'synthetic-run';},getSetting(name){if(name==='CONTINUE_AFTER_ACTIONS'){stage='after-uuid';throw Error('AFTER_UUID_SENTINEL');}return undefined;}};
 const message={id:'22222222-2222-4222-8222-222222222222',agentId:id,entityId:id,roomId:'33333333-3333-4333-8333-333333333333',content:{text:'Synthetic local turn probe'},metadata:{type:'message',trajectoryStepId:'synthetic-step',traceId:'synthetic-trace'}};
 let passed=false;
 try{await new Turn({processMessage(){throw Error('PROVIDER_MUST_NOT_RUN');}}).handleMessage(runtime,message);}
 catch(error){if(stage!=='after-uuid'||error.message!=='AFTER_UUID_SENTINEL')throw error;passed=true;}
 if(!passed)throw Error('Expected pre-provider message sentinel');
 console.log('MOBILE_UUID_AND_TURN_SMOKE_OK');
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
process.exit(0);
