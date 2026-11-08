/** Opt-in integration: exact production client against the isolated real app host. */
import fs from 'node:fs';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
if(process.env.ALPHA_LOCAL_REMOTE_TEST!=='1')throw Error('Set ALPHA_LOCAL_REMOTE_TEST=1 for the isolated localhost:47839 service.');
if(!process.execArgv.includes('--experimental-transform-types')){
 const child=spawnSync(process.execPath,['--experimental-transform-types',process.argv[1]],{stdio:'inherit'});process.exit(child.status??1);
}
const {RemoteProtocol}=await import('../apps/app/src/runtime/remote-protocol.ts');
const origin='http://127.0.0.1:47839';let saved=null;
const requester=input=>new Promise((resolve,reject)=>{
 const req=http.request(input.url,{method:input.method,headers:{...input.headers,Host:'10.0.2.2:47839'},signal:input.signal},response=>{
  let raw='';response.on('data',chunk=>{raw+=chunk;if(raw.length>2*1024*1024)req.destroy(Error('Response too large'));});
  response.on('end',()=>{try{resolve({status:response.statusCode,body:JSON.parse(raw)})}catch{reject(Error('Invalid response'))}});
 });req.on('error',reject);req.end(input.body);
});
const client=new RemoteProtocol(origin,requester,{read:async()=>saved,write:async value=>{saved=value;},remove:async()=>{saved=null;}},{developmentOrigins:[origin]});
try{
 const pairing=await(await fetch(origin+'/api/auth/pair-code',{signal:AbortSignal.timeout(15000)})).json();
 const identity=await client.pair(pairing.code,AbortSignal.timeout(30000));
 const conversation=await client.createConversation('Alpha Phone client integration',AbortSignal.timeout(30000));
 const reply=await client.send(conversation.id,'What is 6 multiplied by 7? Reply with only the integer.',{clientMessageId:crypto.randomUUID(),signal:AbortSignal.timeout(120000)});
 const restored=await client.restore(AbortSignal.timeout(30000));
 const history=await client.messages(conversation.id,AbortSignal.timeout(30000));
 const unauthorized=await requester({url:origin+'/api/conversations',method:'GET',headers:{},signal:AbortSignal.timeout(15000)});
 const result={checkedAt:new Date().toISOString(),scope:'Production RemoteProtocol against isolated real local Eliza app-host with Android Host header; not Android or enclave',ownerVerified:identity.role==='OWNER',reply:reply.text,restored:restored?.identityId===identity.identityId,historyCount:history.messages.length,unauthenticatedStatus:unauthorized.status,passed:reply.text.trim()==='42'&&restored?.identityId===identity.identityId&&history.messages.length>=2&&unauthorized.status===401};
 fs.mkdirSync('test-results/cloud-connection',{recursive:true});fs.writeFileSync('test-results/cloud-connection/real-client-protocol.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
}catch(error){console.log(JSON.stringify({passed:false,error:error?.code||'protocol_failed',status:error?.status}));process.exitCode=1;}
