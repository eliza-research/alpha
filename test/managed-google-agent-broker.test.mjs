// The private Google broker returns a closed refusal reason, never the host's error text, and bounds
// requests and results by kind. A synthetic host stands in for Cloud; nothing leaves loopback.
import test from 'node:test';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
if(!process.versions.bun&&!process.execArgv.includes('tsx')){const child=spawnSync(process.execPath,['--conditions=eliza-source','--import','tsx',process.argv[1]],{stdio:'inherit',timeout:60000});if(child.error)throw child.error;process.exit(child.status??1);}
const {createManagedGoogleAgentBroker}=await import('../.eliza/client-features/packages/app/src/runtime/managed-google-agent/managed-google-agent-broker.ts');
const {GoogleAgentRefusal}=await import('../.eliza/client-features/packages/app/src/runtime/managed-google-agent/managed-google-agent-host.ts');
const secret='NEVER_EXPOSE_SYNTHETIC_HOST_TEXT';
async function call(input,run,raw=false){
 const calls=[];
 const host=new Proxy({},{get(_target,name){return async(...args)=>{calls.push(String(name));return run(String(name),...args);};}});
 const broker=createManagedGoogleAgentBroker({host,authorized:async()=>true,diagnostic:()=>{}});
 const server=createServer((req,res)=>void broker(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const response=await fetch(`http://127.0.0.1:${server.address().port}/__alpha-owner-gmail`,{method:'POST',headers:{authorization:'Bearer synthetic','content-type':'application/json'},body:raw?input:JSON.stringify(input)});
  const text=await response.text();
  return {status:response.status,text,body:JSON.parse(text),calls};
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
for(const reason of ['signed-out','no-account','multiple-accounts','permission-needed','changes-off','mailbox-changed','invalid-request','request-too-large','result-too-large','outcome-unconfirmed'])test(`a ${reason} refusal reaches the agent as its reason only`,async()=>{
 const r=await call({limit:5},()=>{throw new GoogleAgentRefusal(reason,secret);});
 assert.equal(r.status,409);assert.deepEqual(r.body,{reason});assert.equal(r.text.includes(secret),false);
});
test('any other failure keeps the generic refusal and never its text',async()=>{
 const r=await call({limit:5},()=>{throw Error(secret);});
 assert.equal(r.status,409);assert.deepEqual(Object.keys(r.body),['error']);assert.equal(r.text.includes(secret),false);
});
test('a Calendar event write over 8 KiB passes the broker; a read that size is refused unread',async()=>{
 const description='d'.repeat(9*1024);
 const write=await call({calendar:{operation:'write-execute',grantId:'alpha-google:'+'a'.repeat(64),calendarId:'primary',accountId:'owner',payload:{action:'schedule_event',description},preflight:{idempotencyKey:'synthetic'}}},()=>({event:{id:'evt1'}}));
 assert.equal(write.status,200);assert.deepEqual(write.calls,['calendarWrite']);
 const read=await call({calendar:{operation:'write-target',grantId:'alpha-google:'+'a'.repeat(64),calendarId:description}},()=>({}));
 assert.equal(read.status,409);assert.deepEqual(read.body,{reason:'request-too-large'});assert.deepEqual(read.calls,[]);
});
test('a result over 256 KiB is refused as result-too-large',async()=>{
 const r=await call({messageId:'alpha-gmail:'+'a'.repeat(64)+':mail1'},()=>({bodyText:'x'.repeat(300*1024)}));
 assert.equal(r.status,409);assert.deepEqual(r.body,{reason:'result-too-large'});
});
test('a Gmail search longer than Cloud admits is refused before the host',async()=>{
 const r=await call({query:'q'.repeat(2049)},()=>[]);
 assert.deepEqual(r.body,{reason:'invalid-request'});assert.deepEqual(r.calls,[]);
});
test('a request that is not JSON is refused as invalid-request before the host',async()=>{
 const r=await call('{"limit":',()=>[],true);
 assert.equal(r.status,409);assert.deepEqual(r.body,{reason:'invalid-request'});assert.deepEqual(r.calls,[]);
});
