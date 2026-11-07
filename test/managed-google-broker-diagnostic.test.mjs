import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';import {EventEmitter} from 'node:events';
import {spawnSync} from 'node:child_process';
if(!process.versions.bun&&!process.execArgv.includes('tsx')){const child=spawnSync(process.execPath,['--conditions=eliza-source','--import','tsx',process.argv[1]],{stdio:'inherit',timeout:60000});if(child.error)throw child.error;process.exit(child.status??1);}
const {createManagedGoogleAgentBroker}=await import('../backend/managed-google-agent-broker.ts');
const {createManagedGoogleAgentHost}=await import('../backend/managed-google-agent-host.ts');
const secret='NEVER_LOG_TOKEN_ACCOUNT_QUERY';
const credential={credentialReference:'private-reference',credentialId:'11111111-1111-4111-8111-111111111111',userId:'22222222-2222-4222-8222-222222222222',organizationId:'33333333-3333-4333-8333-333333333333'};
async function run(errorKind,{logThrows=false,input={calendar:{operation:'sources'}}}={}){
 const logs=[],calls=[];
 const request=async request=>{calls.push(new URL(request.url).pathname);if(errorKind==='unknown')throw Object.assign(new Error(secret),{code:secret,status:secret,data:{token:secret},name:secret});if(errorKind==='invalid-status')return {status:900,data:{token:secret}};if(errorKind==='invalid-response')return {status:200,data:{token:secret}};return {status:errorKind,data:{error:errorKind===404?'Not found':secret,token:secret}};};
 const host=createManagedGoogleAgentHost({agentCredential:async()=>credential,agentRead:request,agentGmailOperation:request,agentCalendarOperation:request});
 const broker=createManagedGoogleAgentBroker({host,authorized:async()=>true,diagnostic:value=>{logs.push(value);if(logThrows)throw Error(secret);}});
 const req=Readable.from([Buffer.from(JSON.stringify(input))]);Object.assign(req,{method:'POST',url:'/__alpha-owner-gmail',headers:{host:'127.0.0.1:12345',authorization:'Bearer '+secret}});
 const res=new EventEmitter();Object.assign(res,{writableEnded:false,destroyed:false,status:0,body:'',writeHead(status){this.status=status;},end(body){this.body=body;this.writableEnded=true;}});
 await broker(req,res);return {logs,calls,status:res.status,body:JSON.parse(res.body)};
}
for(const [kind,code,status,errorClass] of [[401,'http',401,'CloudProtocolError'],[403,'http',403,'CloudProtocolError'],['invalid-response','invalid-response',undefined,'CloudProtocolError'],['unknown','unclassified',undefined,'Error'],['invalid-status','http',undefined,'CloudProtocolError']])test(`real broker projects safe ${kind} classification`,async()=>{
 const r=await run(kind);assert.equal(r.status,409);assert.equal(r.logs.length,1);assert.deepEqual(r.logs[0],{operation:'calendar.sources',errorClass,code,...(status===undefined?{}:{status}),stage:'identity',capabilities:{abortAny:true,abortTimeout:true,fetch:true}});assert(!JSON.stringify(r.logs).includes(secret));assert(!JSON.stringify(r.body).includes(secret));
});
test('logger failure cannot change refusal; provider-route-unavailable stays intact',async()=>{for(const logThrows of [false,true]){const r=await run(404,{logThrows});assert.equal(r.status,409);assert.equal(r.body.reason,'provider-route-unavailable');}});
test('unvalidated user operation is never a diagnostic category',async()=>{const r=await run('unknown',{input:{calendar:{operation:secret}}});assert.equal(r.calls.length,0);assert.deepEqual(r.logs,[{operation:'request',errorClass:'Error',code:'unclassified',capabilities:{abortAny:true,abortTimeout:true,fetch:true}}]);assert(!JSON.stringify(r.logs).includes(secret));});

test('Calendar writes select the exact scoped account among multiple owners and recheck its permission',async()=>{
 const {createHash}=await import('node:crypto');
 const grants=['44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555'];
 let revoke=false,afterCaps=false;const selected=[];
 const request=async input=>{const url=new URL(input.url);
  if(url.pathname==='/api/v1/user')return {status:200,data:{success:true,data:{id:credential.userId,organization_id:credential.organizationId}}};
  if(url.pathname.endsWith('/accounts'))return {status:200,data:grants.map(grant=>({configured:true,connected:!(revoke&&afterCaps&&grant===grants[1]),reason:'connected',connectionId:grant,identity:{email:'synthetic@acme.com'},grantedCapabilities:['google.calendar.read','google.calendar.write']}))};
  assert(url.pathname.endsWith('/sync-v1/capabilities'));selected.push(url.searchParams.get('grantId'));afterCaps=true;
  return {status:200,data:{version:1,calendarId:'primary',accountId:'selected-account',read:true,write:true,idempotentCreate:true,conditionalWrites:true,providerExactlyOnce:false}};
 };
 const host=createManagedGoogleAgentHost({agentCredential:async()=>credential,agentRead:request,agentGmailOperation:request,agentCalendarOperation:request});
 const scope=createHash('sha256').update(JSON.stringify(credential)+':'+grants[1]).digest('hex'),input={operation:'write-capabilities',grantId:'alpha-google:'+scope,calendarId:'primary'};
 assert.equal((await host.calendarWrite(input)).accountId,'selected-account');assert.deepEqual(selected,[grants[1]]);
 await assert.rejects(host.calendarWrite({...input,grantId:'alpha-google:'+'b'.repeat(64)}),/current owner connection/);assert.equal(selected.length,1);
 revoke=true;afterCaps=false;await assert.rejects(host.calendarWrite(input),/permission changed/);assert.deepEqual(selected,[grants[1],grants[1]]);
});
test('linked-sync is forwarded only through the existing authenticated private Calendar broker',async()=>{
 const forwarded=[];const broker=createManagedGoogleAgentBroker({host:{calendarWrite:async value=>{forwarded.push(value);return {version:1,calendarId:'primary'};}},authorized:async value=>value==='Bearer synthetic'});
 async function call(authorization,operation){const req=Readable.from([Buffer.from(JSON.stringify({calendar:{operation,grantId:'alpha-google:'+'a'.repeat(64),calendarId:'primary',accountId:'selected',command:{kind:'get',reference:{eventId:'exact'}}}}))]);Object.assign(req,{method:'POST',url:'/__alpha-owner-gmail',headers:{host:'127.0.0.1:12345',authorization}});const res=new EventEmitter();Object.assign(res,{writableEnded:false,destroyed:false,status:0,writeHead(status){this.status=status;},end(body){this.body=body;this.writableEnded=true;}});await broker(req,res);return res.status;}
 assert.equal(await call('Bearer wrong','linked-sync'),401);assert.equal(forwarded.length,0);
 assert.equal(await call('Bearer synthetic','arbitrary-operation'),409);assert.equal(forwarded.length,0);
 assert.equal(await call('Bearer synthetic','linked-sync'),200);assert.equal(forwarded.length,1);assert.equal(forwarded[0].operation,'linked-sync');
});
