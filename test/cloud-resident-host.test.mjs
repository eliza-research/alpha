import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {createCloudResidentHost} from './fixtures/product-character-host.mjs';
import {assertBefore} from './fixtures/assert-order.mjs';
test('Cloud host retires old processes, strips direct-provider keys and never persists Cloud credentials',async()=>{
 const profile=await fs.mkdtemp(join(tmpdir(),'alpha-cloud-resident-')),events=[],launches=[];let rejectStop=false;
 const launch=async options=>{let done;const completion=new Promise(resolve=>done=resolve);const id=launches.length;launches.push(options);events.push('start'+id);return {completion,async stop(){events.push('stop'+id);if(rejectStop)throw Error('stop failed');done({code:0});}};};
 const host=await createCloudResidentHost({source:resolve('vendor/eliza'),profile,port:47869,environment:'staging',launch,inherited:{PATH:process.env.PATH,CEREBRAS_API_KEY:'forbidden-direct-key',OPENAI_API_KEY:'forbidden-openai',ELIZAOS_CLOUD_API_KEY:'forbidden-inherited-cloud'}});
 try{
  await host.clear();assert.equal(launches[0].env.ELIZAOS_CLOUD_USE_INFERENCE,'false');
  const binding={token:'synthetic-cloud-secret',credentialId:'first',reference:'ref-first'};
  await host.bind(binding);assert.deepEqual(events,['start0','stop0','start1']);
  const env=launches[1].env;assert.equal(env.ELIZAOS_CLOUD_IMAGE_DESCRIPTION_MODEL,'cerebras/qwen-3.8-27b');assert.equal(env.ELIZAOS_CLOUD_API_KEY,binding.token);assert.equal(env.ELIZAOS_CLOUD_BASE_URL,'https://api-staging.eliza.app/api/v1');assert.equal(env.ELIZA_DEV_SOURCE,'1');assert.equal(env.ELIZA_DEV_CLOUD_ENV_AUTHORITY,'staging-explicit');assert.equal(env.ELIZAOS_CLOUD_USE_INFERENCE,'true');assert.equal(env.CEREBRAS_API_KEY,undefined);assert.equal(env.OPENAI_API_KEY,undefined);assert.match(env.ELIZA_VAULT_PASSPHRASE,/^[a-f0-9]{64}$/);
  assert.equal(host.status('first').attachable,true);assert.equal(host.status('other').attachable,false);assert.ok(!JSON.stringify(host.status()).includes(binding.token));
  await host.bind(binding);assert.equal(launches.length,2,'same binding reuses resident');
  await host.clear();assert.deepEqual(events,['start0','stop0','start1','stop1','start2']);assert.equal(host.status().configured,false);assert.equal(launches[2].env.ELIZAOS_CLOUD_API_KEY,undefined);
  rejectStop=true;await assert.rejects(host.bind(binding),error=>error.name==='AggregateError'&&error.errors.some(cause=>/stop failed/.test(cause.message)));assert.equal(launches.length,3);await assert.rejects(host.bind(binding),error=>error.name==='AggregateError'&&error.errors.some(cause=>/stop failed/.test(cause.message)));assert.equal(launches.length,3,'failed retirement never launches a replacement');await assert.rejects(host.clear(),error=>error.name==='AggregateError'&&error.errors.some(cause=>/stop failed/.test(cause.message)));await assert.rejects(host.ready(new AbortController().signal),/retirement unconfirmed/);assert.equal(launches.length,3);rejectStop=false;await host.clear();assert.equal(launches.length,4,'successful retirement can restart an unbound resident');
  assert.ok(!(await fs.readFile(join(profile,'eliza.json'),'utf8')).includes(binding.token));assert.equal((await fs.stat(join(profile,'vault-passphrase'))).mode&0o777,0o600);
 }finally{await host.close();await fs.rm(profile,{recursive:true,force:true});}
});

test('Cloud readiness waits for the single running agent after the auth listener is available',async()=>{
 const profile=await fs.mkdtemp(join(tmpdir(),'alpha-cloud-ready-'));let calls=0,done;
 const host=await createCloudResidentHost({source:resolve('vendor/eliza'),profile,port:47869,
  launch:async()=>({completion:new Promise(resolve=>done=resolve),async stop(){done({code:0});}}),
  request:async url=>{
   assert.equal(new URL(url).pathname,'/api/agents');calls++;
   if(calls===1)return new Response('{}',{status:503});
   return Response.json({agents:[{status:calls===2?'starting':'running'}]});
  }});
 try{await host.clear();assert.deepEqual(JSON.parse(JSON.stringify(await host.ready(new AbortController().signal))),{state:'host-managed'});assert.equal(calls,3);
  await host.bind({token:'synthetic-cloud-secret',credentialId:'retained',reference:'retained-ref'});
  const controller=new AbortController();controller.abort();await assert.rejects(host.ready(controller.signal),{name:'AbortError'});
  assert.equal(host.status('retained').attachable,true,'cancelled readiness preserves the admitted Cloud binding');
 }finally{await host.close();await fs.rm(profile,{recursive:true,force:true});}
});

test('first readiness preserves a concurrently queued Cloud binding',async()=>{
 const profile=await fs.mkdtemp(join(tmpdir(),'alpha-cloud-resident-')),launches=[],events=[];
 const launch=async options=>{let done;const completion=new Promise(resolve=>done=resolve);launches.push(options.env.ELIZAOS_CLOUD_USE_INFERENCE);events.push('start');return {completion,async stop(){events.push('stop');done({code:0});}};};
 const host=await createCloudResidentHost({source:resolve('vendor/eliza'),profile,port:47869,launch,request:async()=>Response.json({agents:[{status:'running'}]}),inherited:{PATH:process.env.PATH}});
 try{
  const binding=host.bind({token:'synthetic-cloud-secret',credentialId:'first',reference:'ref-first'});
  const readiness=host.ready(new AbortController().signal);
  await Promise.all([binding,readiness]);
  assert.deepEqual(launches,['true'],'readiness must reuse the bound resident');
  assert.equal(host.status('first').attachable,true);
  assert.deepEqual(events,['start'],'readiness must not retire the bound resident');
 }finally{await host.close();await fs.rm(profile,{recursive:true,force:true});}
});

 test('actual Cloud launcher strips inherited provider authority before enabling only resident batch speech',async()=>{
 const directory=await fs.mkdtemp(join(tmpdir(),'alpha-cloud-launcher-')),source=join(directory,'source'),capture=join(directory,'capture.json'),loader=join(directory,'loader.mjs');
 const port=async()=>{const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const selected=server.address().port;await new Promise(resolve=>server.close(resolve));return selected;};
 try{
  await fs.mkdir(join(source,'node_modules'),{recursive:true});
  await fs.writeFile(loader,`import child from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {EventEmitter} from 'node:events';import {writeFileSync} from 'node:fs';child.spawn=(command,args,options)=>{const keys=['ELIZA_DEV_ALLOW_TEST_MOCKS','VITE_ELIZA_DEV_ALLOW_TEST_MOCKS','VITE_ALPHA_CLOUD_RESIDENT','VITE_ALPHA_CLOUD_ENVIRONMENT','ALPHA_DEV_CLOUD_VOICE','ALPHA_DEV_CARTESIA','ALPHA_DEV_CLOUD_REALTIME_VOICE','VITE_ALPHA_DEV_CLOUD_VOICE','CEREBRAS_API_KEY','OPENAI_API_KEY','ELIZAOS_CLOUD_API_KEY'];writeFileSync(process.env.ALPHA_LAUNCHER_TEST_CAPTURE,JSON.stringify(Object.fromEntries(keys.map(key=>[key,options.env[key]??null]))));const result=new EventEmitter();result.kill=()=>true;queueMicrotask(()=>result.emit('exit',0));return result;};syncBuiltinESMExports();`);
  // Keep the authority assertions while allowing the authenticated client preparation to finish.
  const run=spawnSync(process.execPath,['--import',loader,'scripts/dev-cloud.mjs'],{cwd:process.cwd(),env:{...process.env,ALPHA_ELIZA_SOURCE:source,ALPHA_REMOTE_PORT:String(await port()),ALPHA_CLOUD_UI_PORT:String(await port()),ALPHA_CLOUD_ENVIRONMENT:'staging',ALPHA_LAUNCHER_TEST_CAPTURE:capture,CEREBRAS_API_KEY:'synthetic-direct',OPENAI_API_KEY:'synthetic-openai',ELIZAOS_CLOUD_API_KEY:'synthetic-cloud',ALPHA_DEV_CARTESIA:'1',ALPHA_DEV_CLOUD_REALTIME_VOICE:'1',VITE_ALPHA_DEV_CLOUD_VOICE:'1'},encoding:'utf8',timeout:120000});
  assert.equal(run.status,0,run.stderr);
  const env=JSON.parse(await fs.readFile(capture,'utf8'));assert.equal(env.ALPHA_DEV_CLOUD_VOICE,'1');assert.equal(env.ELIZA_DEV_ALLOW_TEST_MOCKS,'');assert.equal(env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS,'');assert.equal(env.VITE_ALPHA_CLOUD_RESIDENT,'1');assert.equal(env.VITE_ALPHA_CLOUD_ENVIRONMENT,'staging');
  for(const key of ['CEREBRAS_API_KEY','OPENAI_API_KEY','ELIZAOS_CLOUD_API_KEY','ALPHA_DEV_CARTESIA','ALPHA_DEV_CLOUD_REALTIME_VOICE','VITE_ALPHA_DEV_CLOUD_VOICE'])assert.equal(env[key],null,key);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
 });


test('managed read broker is bound before launch and revoked even when resident stop fails',async()=>{
 const profile=await fs.mkdtemp(join(tmpdir(),'alpha-calendar-broker-')),events=[],launches=[];let rejectStop=false;
 const host=await createCloudResidentHost({profile,port:47869,
  startGoogleHost:async(token,binding)=>{assert.match(token,/^[a-f0-9]{64}$/);assert.equal(binding.credentialId,'read-owner');events.push('broker-start');return {port:47871,async close(){events.push('broker-close');}};},
  launch:async options=>{launches.push(options);events.push('launch');let done;return {completion:new Promise(resolve=>done=resolve),async stop(){events.push('stop');if(rejectStop)throw Error('stop failed');done({code:0});}};}});
 try{
  await host.bind({token:'synthetic-cloud-key',credentialId:'read-owner',reference:'read-ref'});
  assert.deepEqual(events,['broker-start','launch']);assert.equal(launches[0].env.ELIZA_MANAGED_CALENDAR_READ_BROKER,'http://127.0.0.1:47871/__alpha-owner-gmail');
  assert.equal(launches[0].env.ELIZA_MANAGED_GMAIL_READ_BROKER,launches[0].env.ELIZA_MANAGED_CALENDAR_READ_BROKER);assert.equal(launches[0].env.ELIZA_MANAGED_CALENDAR_DELETE_ENABLED,'1');
  for(const key of ['ELIZA_MANAGED_GMAIL_SEND_BROKER','ELIZA_MANAGED_GMAIL_OPERATION_BROKER'])assert.equal(launches[0].env[key],undefined,key);
  rejectStop=true;await assert.rejects(host.clear(),error=>error.name==='AggregateError');
  assert.deepEqual(events,['broker-start','launch','broker-close','stop']);assert.equal(host.status('read-owner').attachable,false);assert.equal(launches.length,1);
  rejectStop=false;await host.clear();assert.equal(launches.length,2);assert.equal(launches[1].env.ELIZA_MANAGED_CALENDAR_READ_BROKER,'');assert.equal(launches[1].env.ELIZA_MANAGED_GMAIL_READ_BROKER,'');assert.equal(launches[1].env.ELIZA_MANAGED_CALENDAR_DELETE_ENABLED,'0');
 }finally{rejectStop=false;await host.close();await fs.rm(profile,{recursive:true,force:true});}
});

test('managed read broker retires after either fulfilled or rejected resident completion',async()=>{
 for(const reject of [false,true]){
  const profile=await fs.mkdtemp(join(tmpdir(),'alpha-calendar-exit-'));let finish,fail,closed=0;
  const host=await createCloudResidentHost({profile,port:47869,startGoogleHost:async()=>({port:47871,async close(){closed++;}}),
   launch:async()=>({completion:new Promise((resolve,reject)=>{finish=resolve;fail=reject;}),async stop(){finish({code:0});}})});
  try{await host.bind({token:'synthetic-cloud-key',credentialId:'read-owner',reference:'read-ref'});if(reject)fail(Error('synthetic process completion'));else finish({code:1});
   for(let i=0;i<20&&closed===0;i++)await new Promise(resolve=>setImmediate(resolve));
   assert.equal(closed,1);assert.equal(host.status('read-owner').configured,false);assert.equal(host.status('read-owner').attachable,false);
  }finally{await host.close();await fs.rm(profile,{recursive:true,force:true});}
 }
});

test('managed broker cleanup covers log setup and launch failures without starting a replacement',async()=>{
 for(const failure of ['log','launch']){
  const profile=await fs.mkdtemp(join(tmpdir(),'alpha-calendar-start-'));let closed=0,launches=0;
  const host=await createCloudResidentHost({profile,port:47869,startGoogleHost:async()=>({port:47871,async close(){closed++;}}),launch:async()=>{launches++;throw Error('synthetic launch failure');}});
  try{if(failure==='log')await fs.mkdir(join(profile,'server.log'));
   await assert.rejects(host.bind({token:'synthetic-cloud-key',credentialId:'read-owner',reference:'read-ref'}));
   assert.equal(closed,1);assert.equal(launches,failure==='log'?0:1);assert.equal(host.status().configured,false);
  }finally{await host.close();await fs.rm(profile,{recursive:true,force:true});}
 }
});


test('broker close rejection keeps retirement unavailable and still stops the old process',async()=>{
 const profile=await fs.mkdtemp(join(tmpdir(),'alpha-calendar-close-'));let rejectClose=true,stops=0,launches=0,done;
 const host=await createCloudResidentHost({profile,port:47869,startGoogleHost:async()=>({port:47871,async close(){if(rejectClose)throw Error('synthetic broker close failure');}}),
  launch:async()=>{launches++;return {completion:new Promise(resolve=>done=resolve),async stop(){stops++;done({code:0});}};}});
 try{await host.bind({token:'synthetic-cloud-key',credentialId:'read-owner',reference:'read-ref'});
  await assert.rejects(host.clear(),error=>error.name==='AggregateError'&&error.errors.some(cause=>/broker close failure/.test(cause.message)));
  assert.equal(stops,1);assert.equal(launches,1);assert.equal(host.status('read-owner').attachable,false);await assert.rejects(host.ready(new AbortController().signal),/retirement unconfirmed/);
  rejectClose=false;
 }finally{rejectClose=false;await host.close();await fs.rm(profile,{recursive:true,force:true});}
});


test('explicit Cloud realtime host switches to Direct and back without leaking relay authority',async()=>{
 for(const cloudRealtimeVoice of [false,true]){
  const launches=[];
  const host=await createCloudResidentHost({cloudRealtimeVoice,launch:async options=>{launches.push(options);let done;return {completion:new Promise(resolve=>done=resolve),async stop(){done({code:0});}};},request:async()=>Response.json({data:[{id:'qwen-3.8-27b'}]})});
  try{
   await host.clear();
   assert.equal(launches.at(-1).env.ELIZA_SELF_HOSTED_VOICE_CLOUD_RELAY_ENABLED,undefined,'unbound host cannot use relay');
   await host.bind({token:'synthetic-cloud-key',credentialId:'relay-owner',reference:'relay-reference'});
   assert.equal(launches.at(-1).env.ELIZA_SELF_HOSTED_VOICE_CLOUD_RELAY_ENABLED,cloudRealtimeVoice?'1':undefined);
   await host.selectOwn({apiKey:'synthetic-direct-key',cartesiaKey:'synthetic-cartesia-key'});
   assert.equal(launches.at(-1).env.ELIZA_SELF_HOSTED_VOICE_CLOUD_RELAY_ENABLED,undefined,'Direct keeps its own provider');
   assert.equal(launches.at(-1).env.CARTESIA_API_KEY,'synthetic-cartesia-key');
   assert.equal(launches.at(-1).env.ELIZAOS_CLOUD_API_KEY,undefined);
   await host.selectCloud();
   assert.equal(launches.at(-1).env.ELIZA_SELF_HOSTED_VOICE_CLOUD_RELAY_ENABLED,cloudRealtimeVoice?'1':undefined);
   assert.equal(launches.at(-1).env.ELIZAOS_CLOUD_API_KEY,'synthetic-cloud-key');
   assert.equal(launches.at(-1).env.CARTESIA_API_KEY,undefined);
   await host.clear();
   assert.equal(launches.at(-1).env.ELIZA_SELF_HOSTED_VOICE_CLOUD_RELAY_ENABLED,undefined);
  }finally{await host.close();}
 }
});


test('Gmail and embeddings keep their Cloud owner while Direct owns text and media',async()=>{
 const profile=await fs.mkdtemp(join(tmpdir(),'alpha-gmail-read-launch-')),launches=[],events=[],bindings=[];let nextPort=47870;
 const host=await createCloudResidentHost({profile,port:47869,
  inherited:{ELIZA_MANAGED_GMAIL_READ_BROKER:'http://untrusted.invalid',ELIZA_MANAGED_GMAIL_SEND_BROKER:'http://untrusted.invalid',ELIZA_MANAGED_GMAIL_OPERATION_BROKER:'http://untrusted.invalid'},
  request:async()=>Response.json({data:[{id:'qwen-3.8-27b'}]}),
  startGoogleHost:async(_token,binding)=>{const port=++nextPort;bindings.push(binding.credentialId);events.push('broker:'+port);return {port,async close(){events.push('close:'+port);}};},
  launch:async options=>{launches.push(options);events.push('launch');let done;return {completion:new Promise(resolve=>done=resolve),async stop(){events.push('stop');done({code:0});}};}});
 const assertRead=(entry,port)=>{
  assert.equal(entry.env.ELIZA_MANAGED_GMAIL_READ_BROKER,`http://127.0.0.1:${port}/__alpha-owner-gmail`);
  assert.equal(entry.env.ELIZA_MANAGED_GMAIL_READ_BROKER,entry.env.ELIZA_MANAGED_CALENDAR_READ_BROKER);
  for(const key of ['ELIZA_MANAGED_GMAIL_SEND_BROKER','ELIZA_MANAGED_GMAIL_OPERATION_BROKER'])assert.equal(entry.env[key],undefined,key);
 };
 try{
  await host.bind({token:'synthetic-cloud-a',credentialId:'owner-a',reference:'ref-a'});assertRead(launches.at(-1),47871);
  const cloudConfig=JSON.parse(await fs.readFile(join(profile,'provider-launch.json'),'utf8'));
  assert.deepEqual(cloudConfig.serviceRouting.media,{backend:'elizacloud',transport:'cloud-proxy'});
  assert.deepEqual(cloudConfig.serviceRouting.tts,{backend:'elizacloud',transport:'cloud-proxy'});
  await host.selectOwn({apiKey:'synthetic-direct-key'});assertRead(launches.at(-1),47872);
  assert.equal(launches.at(-1).env.CEREBRAS_API_KEY,'synthetic-direct-key');assert.equal(launches.at(-1).env.ELIZAOS_CLOUD_API_KEY,undefined);assert.equal(launches.at(-1).env.ELIZAOS_CLOUD_USE_INFERENCE,'false');
  assert.equal(launches.at(-1).env.ELIZAOS_CLOUD_EMBEDDING_API_KEY,'synthetic-cloud-a');
  assert.equal(launches.at(-1).env.ELIZAOS_CLOUD_EMBEDDING_URL,'https://api.eliza.app/api/v1');
  assert.equal(launches.at(-1).env.ELIZAOS_CLOUD_USE_EMBEDDINGS,'true');
  for(const key of ['ELIZAOS_CLOUD_USE_MEDIA','ELIZAOS_CLOUD_USE_TTS','ELIZAOS_CLOUD_USE_STT'])assert.equal(launches.at(-1).env[key],'false');
  const directConfig=JSON.parse(await fs.readFile(join(profile,'provider-launch.json'),'utf8'));
  assert.deepEqual(directConfig.serviceRouting.media,{backend:'cerebras',transport:'direct'});
  assert.deepEqual(directConfig.serviceRouting.embeddings,{backend:'elizacloud',transport:'cloud-proxy'});
  assert.equal(directConfig.linkedAccounts.elizacloud.status,'linked');
  assert.equal(directConfig.serviceRouting.tts,undefined);
  await host.bind({token:'synthetic-cloud-b',credentialId:'owner-b',reference:'ref-b'});assertRead(launches.at(-1),47873);
  assert.equal(launches.at(-1).env.ELIZAOS_CLOUD_EMBEDDING_API_KEY,'synthetic-cloud-b');
  assert.deepEqual(bindings,['owner-a','owner-a','owner-b']);assert.equal(host.status('owner-a').attachable,false);
  assert.ok(events.includes('close:47871'),'owner-a read broker closed');assert.ok(events.includes('close:47872'),'direct-provider read broker closed');
  assertBefore(events,'close:47871','broker:47872');assertBefore(events,'close:47872','broker:47873');
  await host.clear();assert.equal(launches.at(-1).env.ELIZA_MANAGED_GMAIL_READ_BROKER,'');assert.equal(launches.at(-1).env.ELIZA_MANAGED_CALENDAR_READ_BROKER,'');
  assert.equal(launches.at(-1).env.ELIZAOS_CLOUD_EMBEDDING_API_KEY,undefined);
  assert.equal(launches.at(-1).env.ELIZAOS_CLOUD_USE_EMBEDDINGS,'false');
  assert.equal(JSON.parse(await fs.readFile(join(profile,'provider-launch.json'),'utf8')).linkedAccounts.elizacloud.status,'unlinked');
  for(const key of ['ELIZA_MANAGED_GMAIL_SEND_BROKER','ELIZA_MANAGED_GMAIL_OPERATION_BROKER'])assert.equal(launches.at(-1).env[key],undefined,key);
 }finally{await host.close();await fs.rm(profile,{recursive:true,force:true});}
});
