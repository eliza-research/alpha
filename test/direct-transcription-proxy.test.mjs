import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {createServer,request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {createHash,randomUUID} from 'node:crypto';
async function fixture(){
 const directory=await mkdtemp(path.join(os.tmpdir(),'alpha-direct-transcribe-')),tokenFile=path.join(directory,'token'),root='1'.repeat(64),owner=randomUUID(),calls=[];
 await writeFile(tokenFile,root,{mode:0o600});let mode='ok',activeSignal;
 const request=async(url,input)=>{const route=new URL(url).pathname;calls.push(route);
  if(route==='/api/auth/status')return Response.json({instanceId:'fixture'});
  if(route==='/api/auth/pair-code')return Response.json({code:'fixture'});
  if(route==='/api/auth/pair')return Response.json({access:'owner',token:'synthetic-private-owner',instanceId:'fixture',identityId:owner});
  if(route==='/api/auth/me')return Response.json({identity:{id:owner},access:{role:'OWNER'},session:{id:'synthetic-private-owner',expiresAt:Date.now()+60000}});
  assert.equal(route,'/api/v1/voice/session/transcribe');assert.equal(input.headers.Authorization,'Bearer synthetic-private-owner');assert.equal(input.headers['Content-Type'],'audio/wav');assert.equal(input.method,'POST');assert.ok(Buffer.isBuffer(input.body));
  if(mode==='wait'){activeSignal=input.signal;await new Promise((_r,reject)=>input.signal.addEventListener('abort',()=>reject(input.signal.reason),{once:true}));}
  if(mode==='rotate')await writeFile(tokenFile,'2'.repeat(64),{mode:0o600});
  return Response.json({text:'dictation',apiKey:'must-not-leak'},{headers:{'X-Eliza-STT-Provider':'cartesia','X-Eliza-Speech-Route':mode==='wrong-route'?'cloud':'direct','X-Request-Id':input.headers['X-Request-Id']}});
 };
 const source=fs.readFileSync('scripts/local-agent-dev-bridge.ts','utf8').replace(/^import\b[\s\S]*?;\s*$/gm,'').replace(/^export /gm,'');
 const box={URL,Buffer,Response,AbortSignal,AbortController,DOMException,Date,Map,Set,JSON,Number,Error,process,console,once,readFileSync:fs.readFileSync,statSync:fs.statSync,randomUUID,createHash,httpRequest,dirname:path.dirname,join:path.join,homedir:os.homedir,isPreparedViewNavigationRequest:()=>false,parseViewInteractionClientId:()=>undefined,ownerRouteGroup:()=>undefined,ownerRouteAllowed:()=>false};
 vm.runInNewContext(stripTypeScriptTypes(source,{mode:'transform'})+';globalThis.make=createLocalAgentDevHandler;',box);
 const handler=box.make({origin:'http://127.0.0.1:47839',tokenFile,request,selectableProvider:true}),server=createServer(handler);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const call=(signal,overrides={})=>fetch(origin,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Alpha-Local-Agent':'1'},body:JSON.stringify({path:'/api/v1/voice/session/transcribe',method:'POST',ownerId:owner,headers:{},audioBase64:Buffer.from('synthetic PCM fixture').toString('base64'),requestId:randomUUID(),...overrides}),signal});
 return {call,calls,mode:value=>mode=value,signal:()=>activeSignal,async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}};
}
test('direct transcription proxy preserves owner and provider attestation without leaking upstream extras',async()=>{
 const f=await fixture();try{const response=await f.call();assert.equal(response.status,200);const result=await response.json();assert.equal(result.status,200);assert.deepEqual(Object.keys(JSON.parse(result.body)).sort(),['provider','requestId','route','text']);assert.equal(JSON.parse(result.body).route,'direct');assert.ok(!JSON.stringify(result).includes('must-not-leak'));assert.equal(f.calls.filter(p=>p==='/api/v1/voice/session/transcribe').length,1);assert.ok(!f.calls.includes('/api/asr/cloud'));}finally{await f.close();}
});
test('wrong owner, changed root and wrong provider route cannot return a transcript',async()=>{
 for(const mode of ['wrong-owner','rotate','wrong-route']){const f=await fixture();try{f.mode(mode);const response=await f.call(undefined,mode==='wrong-owner'?{ownerId:randomUUID()}:{});assert.equal(response.status,mode==='wrong-route'?503:409);assert.ok(!(await response.text()).includes('dictation'));}finally{await f.close();}}
});
test('cancelled browser proxy aborts its resident transcription without retry',async()=>{
 const f=await fixture();try{f.mode('wait');const controller=new AbortController(),pending=f.call(controller.signal);while(!f.signal())await new Promise(resolve=>setTimeout(resolve,2));controller.abort();await assert.rejects(pending);for(let i=0;i<100&&!f.signal().aborted;i++)await new Promise(resolve=>setTimeout(resolve,2));assert.equal(f.signal().aborted,true);assert.equal(f.calls.filter(p=>p==='/api/v1/voice/session/transcribe').length,1);}finally{await f.close();}
});
