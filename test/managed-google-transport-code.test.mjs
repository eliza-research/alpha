import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';import {EventEmitter} from 'node:events';import {spawnSync} from 'node:child_process';
if(!process.versions.bun&&!process.execArgv.includes('tsx')){const c=spawnSync(process.execPath,['--conditions=eliza-source','--import','tsx',process.argv[1]],{stdio:'inherit',timeout:60000});if(c.error)throw c.error;process.exit(c.status??1);}
const {createManagedGoogleAgentBroker}=await import('../backend/managed-google-agent-broker.ts');const {createManagedGoogleAgentHost}=await import('../backend/managed-google-agent-host.ts');const {createNativeGoogleCloudPort}=await import('../backend/native-google-cloud-port.ts');const {managedGoogleFailureStage,managedGoogleTransportCodes}=await import('../backend/managed-google-failure-stage.ts');
const secret='NEVER_LOG_URL_TOKEN_HOSTNAME_ACCOUNT';const user='11111111-1111-4111-8111-111111111111',org='22222222-2222-4222-8222-222222222222';
async function run(error,{throwLogger=false,responseReader=false}={}){
 const logs=[];let requests=0;
 const port=createNativeGoogleCloudPort({credentialId:'33333333-3333-4333-8333-333333333333',userId:user,organizationId:org,sessionGeneration:'synthetic',accountRef:JSON.stringify(['cloud','production',user,org]),token:secret},()=>{},async()=>{requests++;if(responseReader)return {status:200,body:{getReader(){throw error}}};throw error;});
 const broker=createManagedGoogleAgentBroker({host:createManagedGoogleAgentHost(port),authorized:async()=>true,diagnostic:value=>{logs.push(value);if(throwLogger)throw Error(secret);}});
 const req=Readable.from([JSON.stringify({calendar:{operation:'sources'}})]);Object.assign(req,{method:'POST',url:'/',headers:{host:'127.0.0.1:12345',authorization:'Bearer '+secret}});const res=new EventEmitter();Object.assign(res,{writableEnded:false,destroyed:false,status:0,body:'',writeHead(status){this.status=status},end(body){this.body=body;this.writableEnded=true}});await broker(req,res);return {logs,requests,status:res.status,body:res.body};
}
const expected={operation:'calendar.sources',errorClass:'TypeError',code:'unclassified',stage:'fetch',capabilities:{abortAny:true,abortTimeout:true,fetch:true}};
for(const code of ['ERR_INVALID_THIS','ERR_INVALID_ARG_TYPE','ENOTFOUND','ECONNREFUSED','ConnectionRefused','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID'])test(`only allowlisted ${code} reaches transport diagnostics`,async()=>{const error=Object.assign(new TypeError(secret),{code,hostname:secret,data:{authorization:secret}});const r=await run(error);assert.deepEqual(r.logs,[{...expected,transportCode:code}]);assert.equal(r.status,409);assert.equal(r.requests,1);assert.equal(managedGoogleFailureStage(error),'fetch');assert(!JSON.stringify(r.logs).includes(secret));assert(!r.body.includes(secret));});
test('one cause code is projected without cause message/data or deeper traversal',async()=>{const error=Object.assign(new TypeError(secret),{code:'ECONNRESET',cause:{code:'CERT_HAS_EXPIRED',message:secret,hostname:secret,data:{token:secret},cause:{code:'ENOTFOUND'}}});const r=await run(error);assert.deepEqual(r.logs,[{...expected,transportCode:'ECONNRESET',causeTransportCode:'CERT_HAS_EXPIRED'}]);assert(!JSON.stringify(r.logs).includes(secret));});
test('unknown and non-string error codes are omitted rather than serialized',async()=>{for(const code of [secret,404,{toString(){throw Error(secret);}}]){const r=await run(Object.assign(new TypeError(secret),{code,cause:{code:secret}}));assert.deepEqual(r.logs,[expected]);assert.equal(r.status,409);}});
test('diagnostics do not invoke accessors or fail on hostile property descriptors',async()=>{let invoked=0;const error=new TypeError(secret);Object.defineProperty(error,'code',{get(){invoked++;throw Error(secret)}});Object.defineProperty(error,'cause',{get(){invoked++;throw Error(secret)}});assert.deepEqual(managedGoogleTransportCodes(error),{});assert.equal(invoked,0);const causeOnly=new TypeError(secret);Object.defineProperty(causeOnly,'cause',{get(){invoked++;throw Error(secret)}});const r=await run(causeOnly);assert.equal(invoked,0);assert.deepEqual(r.logs,[expected]);assert.deepEqual(managedGoogleTransportCodes(new Proxy({},{getOwnPropertyDescriptor(){throw Error(secret)}})),{});});
test('throwing diagnostic callback leaves original refusal and error identity intact',async()=>{const error=Object.assign(new TypeError(secret),{cause:{code:'EAI_AGAIN'}});const r=await run(error,{throwLogger:true});assert.equal(r.status,409);assert.deepEqual(r.logs,[{...expected,causeTransportCode:'EAI_AGAIN'}]);assert.equal(managedGoogleFailureStage(error),'fetch');});

for(const [message,family] of [
 ['Unexpected redirect','redirect-refused'],["Fetch failed: Encountered redirect while redirect mode is set to 'error'",'redirect-refused'],
 ['certificate verify failed','certificate'],['unable to get local issuer certificate','certificate'],
 ['TLS handshake failed','tls'],['ERR_SSL_PROTOCOL_ERROR','tls'],
 ['Invalid URL','invalid-url-or-arguments'],['Failed to parse URL from https://'+secret+'/','invalid-url-or-arguments'],
 ['The "input" argument must be of type string. Received '+secret,'invalid-url-or-arguments'],
 ['Unable to connect. Is the computer able to access the url?','connection'],['fetch failed','generic-fetch'],['Failed to fetch','generic-fetch'],
])test(`codeless fetch failure projects only finite ${family} label`,async()=>{
 const error=new TypeError(message);const r=await run(error);
 assert.deepEqual(r.logs,[{...expected,transportMessageFamily:family}]);assert.equal(r.requests,1);assert.equal(r.status,409);
 assert(!JSON.stringify(r.logs).includes(secret));assert(!r.body.includes(secret));
});
test('one cause message label coexists with generic outer failure and allowlisted codes',async()=>{
 const error=Object.assign(new TypeError('fetch failed'),{code:'ECONNRESET',cause:Object.assign(new Error('certificate verify failed'),{code:'CERT_HAS_EXPIRED',data:secret,cause:new Error('Unexpected redirect')})});
 const r=await run(error);assert.deepEqual(r.logs,[{...expected,transportMessageFamily:'generic-fetch',causeTransportMessageFamily:'certificate',transportCode:'ECONNRESET',causeTransportCode:'CERT_HAS_EXPIRED'}]);
 assert(!JSON.stringify(r.logs).includes(secret));
});
test('message classification never invokes getters, coercion or prototype accessors',async()=>{
 let touched=0;const error=new TypeError(secret);Object.defineProperty(error,'message',{get(){touched++;throw Error(secret)}});
 const cause={};Object.defineProperty(cause,'message',{get(){touched++;throw Error(secret)}});Object.defineProperty(error,'cause',{value:cause});
 assert.deepEqual(managedGoogleTransportCodes(error),{});const r=await run(error);assert.deepEqual(r.logs,[expected]);
 const inherited=Object.create({get message(){touched++;return 'fetch failed'}});assert.deepEqual(managedGoogleTransportCodes(inherited),{});
 assert.deepEqual(managedGoogleTransportCodes({message:{toString(){touched++;return 'fetch failed'}}}),{});assert.equal(touched,0);
 assert.deepEqual(managedGoogleTransportCodes(new Proxy({},{getOwnPropertyDescriptor(){throw Error(secret)}})),{});
});
test('unknown, long, embedded, multiline and partial lookalikes are omitted',async()=>{
 for(const message of [secret,'prefix certificate verify failed','fetch failed '+secret,'TLS handshake failed\n'+secret,'Failed to parse URL from '+secret.repeat(100),'Unexpected redirect '+secret]){
  const r=await run(new TypeError(message));assert.deepEqual(r.logs,[expected]);assert(!JSON.stringify(r.logs).includes(secret));assert(!r.body.includes(secret));
 }
});
test('message label diagnostic failure keeps original refusal and error identity',async()=>{
 const error=new TypeError('fetch failed');const r=await run(error,{throwLogger:true});assert.equal(r.status,409);assert.equal(managedGoogleFailureStage(error),'fetch');assert.deepEqual(r.logs,[{...expected,transportMessageFamily:'generic-fetch'}]);
});

test('known message text outside fetch stage cannot create transport labels',async()=>{
 const error=new TypeError('fetch failed');const r=await run(error,{responseReader:true});assert.deepEqual(r.logs,[{...expected,stage:'response-json'}]);assert.equal(r.status,409);assert.equal(r.requests,1);
});
