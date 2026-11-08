import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';import {EventEmitter} from 'node:events';import {spawnSync} from 'node:child_process';
if(!process.versions.bun&&!process.execArgv.includes('tsx')){const c=spawnSync(process.execPath,['--conditions=eliza-source','--import','tsx',process.argv[1]],{stdio:'inherit',timeout:60000});if(c.error)throw c.error;process.exit(c.status??1);}
const {createManagedGoogleAgentBroker}=await import('../backend/managed-google-agent-broker.ts');const {createManagedGoogleAgentHost}=await import('../backend/managed-google-agent-host.ts');const {createNativeGoogleCloudPort}=await import('../backend/native-google-cloud-port.ts');
const secret='NO_LOG_CREDENTIAL_QUERY_ACCOUNT';const user='11111111-1111-4111-8111-111111111111',org='22222222-2222-4222-8222-222222222222';
const binding={credentialId:'33333333-3333-4333-8333-333333333333',userId:user,organizationId:org,sessionGeneration:'test-generation',accountRef:JSON.stringify(['cloud','production',user,org]),token:secret};
async function fixture(mode,{throwLogger=false}={}){
 const logs=[];let requests=0;const port=createNativeGoogleCloudPort(binding,()=>{},async url=>{requests++;
  if(mode==='fetch')throw Object.assign(new TypeError(secret),{data:{token:secret}});
  if(mode==='response-json')return {status:200,body:{}};
  if(mode==='http')return Response.json({error:secret},{status:401});
  const pathname=new URL(url).pathname;
  if(pathname==='/api/v1/user')return Response.json({success:true,data:{id:user,organization_id:org}});
  return Response.json({unexpected:secret});
 });
 const host=createManagedGoogleAgentHost(port),broker=createManagedGoogleAgentBroker({host,authorized:async()=>true,diagnostic:value=>{logs.push(value);if(throwLogger)throw new Error(secret);}});
 const req=Readable.from([JSON.stringify({calendar:{operation:'sources'}})]);Object.assign(req,{method:'POST',url:'/',headers:{host:'127.0.0.1:12345',authorization:'Bearer '+secret}});
 const res=new EventEmitter();Object.assign(res,{writableEnded:false,destroyed:false,status:0,body:'',writeHead(status){this.status=status},end(body){this.body=body;this.writableEnded=true}});await broker(req,res);return {logs,requests,status:res.status,body:res.body};
}
test('missing AbortSignal.any is safely classified at signal creation before any request',async()=>{const d=Object.getOwnPropertyDescriptor(AbortSignal,'any');Object.defineProperty(AbortSignal,'any',{configurable:true,value:undefined});try{const r=await fixture('none');assert.equal(r.requests,0);assert.equal(r.status,409);assert.equal(r.logs[0].stage,'signal');assert.equal(r.logs[0].errorClass,'TypeError');assert.equal(r.logs[0].capabilities.abortAny,false);assert(!JSON.stringify(r.logs).includes(secret));}finally{Object.defineProperty(AbortSignal,'any',d)}});
test('fetch and response-reader TypeErrors retain their first precise stage without secret text',async()=>{for(const mode of ['fetch','response-json']){const r=await fixture(mode);assert.equal(r.status,409);assert.equal(r.requests,1);assert.equal(r.logs[0].stage,mode);assert.equal(r.logs[0].errorClass,'TypeError');assert.deepEqual(Object.keys(r.logs[0]).sort(),['operation','errorClass','code','stage','capabilities'].sort());assert(!JSON.stringify(r.logs).includes(secret));assert(!r.body.includes(secret));}});
test('Cloud HTTP and invalid account payload failures remain distinct',async()=>{const h=await fixture('http');assert.equal(h.logs[0].stage,'identity');assert.equal(h.logs[0].code,'http');assert.equal(h.logs[0].status,401);const a=await fixture('invalid-accounts');assert.equal(a.logs[0].stage,'accounts');assert.equal(a.logs[0].code,'invalid-response');assert.equal(a.status,409);assert(!JSON.stringify(a.logs).includes(secret));});
test('diagnostic callback failure cannot change original refusal',async()=>{const r=await fixture('fetch',{throwLogger:true});assert.equal(r.status,409);assert.equal(r.logs[0].stage,'fetch');});
