import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import http from 'node:http';
import {createLocalAgentDevHandler} from './local-agent-dev-bridge.ts';
const directory=mkdtempSync(join(tmpdir(),'alpha-speech-bridge-'));
const tokenFile=join(directory,'token'),root='a'.repeat(64),token='synthetic-owner-token';
writeFileSync(tokenFile,root,{mode:0o600});
let calls=0,received,waiting=false,closed!:(...args:any[])=>void;
const disconnected=new Promise((resolve: any)=>{closed=resolve;});
const host=http.createServer(async(req: any,res: any)=>{
 const chunks: any[]=[];for await(const chunk of req)chunks.push(chunk);
 const bytes=Buffer.concat(chunks);let body;
 if(req.url==='/api/auth/status')body={instanceId:'instance'};
 else if(req.url==='/api/auth/pair-code')body={code:'fixture'};
 else if(req.url==='/api/auth/pair')body={token,instanceId:'instance',identityId:'owner',access:'owner'};
 else if(req.url==='/api/auth/me')body={identity:{id:'owner'},access:{role:'OWNER'},session:{id:token,expiresAt:Date.now()+60000}};
 else{
  calls++;assert.equal(req.headers.authorization,`Bearer ${token}`);
  if(waiting){res.on('close',closed);return;}
  if(req.url.endsWith('/status')){assert.equal(req.method,'GET');body={ready:true};}
  else{assert.equal(req.method,'POST');assert.equal(req.headers['content-type'],'audio/wav');received=bytes;body={text:'fixture',requestId:req.headers['x-request-id'],local:true};}
 }
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(body));
});
const listen=(server: any)=>new Promise((resolve: any)=>server.listen(0,'127.0.0.1',resolve));
await listen(host);
const proxy=http.createServer(createLocalAgentDevHandler({origin:`http://127.0.0.1:${(host.address() as import('node:net').AddressInfo).port}`,tokenFile}));await listen(proxy);
const origin=`http://127.0.0.1:${(proxy.address() as import('node:net').AddressInfo).port}`;
const invoke=(input: any,signal:AbortSignal|undefined=undefined,source: any=origin)=>fetch(origin,{method:'POST',headers:{Origin:source,'Content-Type':'application/json','X-Alpha-Local-Agent':'1'},body:JSON.stringify(input),signal});
const bytes=Buffer.from([0,255,128,0,1,2,3]),requestId=randomUUID();
const input={path:'/api/asr/libelizainference',method:'POST',ownerId:'owner',requestId,audioBase64:bytes.toString('base64')};
try{
 const response=await invoke(input);assert.equal(response.status,200);const envelope=await response.json();assert.equal(envelope.status,200);assert.equal(JSON.parse(envelope.body).requestId,requestId);assert.deepEqual(received,bytes);assert.ok(!JSON.stringify(envelope).includes(token));
 assert.equal((await invoke({path:'/api/asr/libelizainference/status',method:'GET',ownerId:'owner'})).status,200);
 const before=calls;
 for(const patch of [{ownerId:undefined},{method:'GET'},{audioBase64:'a==='},{audioBase64:'Zh=='},{audioBase64:''},{requestId:'invalid'},{body:'{}'},{stream:true},{path:'/api/asr/libelizainference/other'},{path:'/api/asr/whisper'},{path:'/api/conversations'}])assert.equal((await invoke({...input,...patch})).status,400);
 assert.equal((await invoke({...input,ownerId:'another'})).status,409);
 assert.equal((await invoke(input,undefined,'https://other.test')).status,403);
 assert.equal((await invoke({...input,path:'/api/asr/libelizainference/status',method:'GET'})).status,400);
 assert.equal((await invoke({...input,audioBase64:Buffer.alloc(2*1024*1024+1).toString('base64')})).status,400);
 assert.equal(calls,before,'Invalid requests must not dispatch audio');
 // A maximal legal payload retains its bytes through the JSON envelope.
 const maximum=Buffer.alloc(2*1024*1024,128);assert.equal((await invoke({...input,audioBase64:maximum.toString('base64')})).status,200);assert.deepEqual(received,maximum);
 waiting=true;const controller=new AbortController();const pending=invoke(input,controller.signal);
 const deadline=Date.now()+3000;while(calls===before+1&&Date.now()<deadline)await new Promise((resolve: any)=>setTimeout(resolve,10));
 assert.equal(calls,before+2);controller.abort();await assert.rejects(pending,(error: any)=>error.name==='AbortError');
 await Promise.race([disconnected,new Promise((_: any,reject: any)=>setTimeout(()=>reject(Error('Upstream audio request not cancelled')),3000).unref())]);
 console.log('Speech bridge: exact bytes, owner binding, request validation, limits and cancellation passed');
}finally{proxy.closeAllConnections();host.closeAllConnections();await Promise.all([new Promise((resolve: any)=>proxy.close(resolve)),new Promise((resolve: any)=>host.close(resolve))]);rmSync(directory,{recursive:true,force:true});}
