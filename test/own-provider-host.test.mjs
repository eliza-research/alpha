import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {productCharacterHostFixture} from './fixtures/product-character-host.mjs';

test('own provider uses same resident and keeps Cloud integration binding without storing keys',async()=>{
 const seen=[],bindings=[];
 const fixture=productCharacterHostFixture(undefined,{request:async(url,options)=>{seen.push([url,options]);return Response.json({data:[{id:'qwen-3.8-27b'}]});},startGoogleHost:async(token,binding)=>{bindings.push(binding);return {port:47871,async close(){}};}});
 const host=await fixture.make();
 try{
  await host.bind({token:'synthetic-cloud-secret',credentialId:'account-a',reference:'ref-a'});
  assert.equal(seen.length,0,'Cloud admission and status never probe direct providers');
  await host.selectOwn({apiKey:'synthetic-cerebras-key',cartesiaKey:'synthetic-cartesia-key'});
  assert.equal(seen.length,1);assert.equal(seen[0][0],'https://api.cerebras.ai/v1/models');
  assert.equal(host.status().provider,'cerebras');assert.equal(host.status().voiceConfigured,true);
  const direct=fixture.launches.at(-1);assert.equal(direct.env.CEREBRAS_API_KEY,'synthetic-cerebras-key');assert.equal(direct.env.CARTESIA_API_KEY,'synthetic-cartesia-key');assert.equal(direct.env.ELIZAOS_CLOUD_API_KEY,undefined);
  assert.equal(direct.env.ELIZA_STATE_DIR,fixture.profile);assert.equal(JSON.stringify(bindings.at(-1)),JSON.stringify({credentialId:'account-a',reference:'ref-a'}));
  for(const name of await fs.readdir(fixture.profile)){const data=await fs.readFile(fixture.profile+'/'+name,'utf8');assert.ok(!data.includes('synthetic-'),name+' contains provider credentials');}
  await host.selectCloud();assert.equal(host.status().provider,'elizacloud');assert.equal(fixture.launches.at(-1).env.ELIZAOS_CLOUD_API_KEY,'synthetic-cloud-secret');assert.equal(fixture.launches.at(-1).env.CARTESIA_API_KEY,undefined);assert.equal(seen.length,1);
  assert.ok(!JSON.stringify(host.status()).includes('synthetic-'));
 }finally{await host.close();fixture.close();}
});

test('rejected own key preserves Cloud and AI-only own key leaves voice disabled',async()=>{
 let reject=true;
 const fixture=productCharacterHostFixture(undefined,{request:async()=>reject?new Response('',{status:401}):Response.json({data:[{id:'qwen-3.8-27b'}]})});
 const host=await fixture.make();
 try{
  await host.bind({token:'synthetic-cloud-secret',credentialId:'account-a',reference:'ref-a'});
  await assert.rejects(host.selectOwn({apiKey:'synthetic-cerebras-key'}),/did not confirm/);assert.equal(host.status().provider,'elizacloud');assert.equal(fixture.launches.length,1);
  reject=false;await host.selectOwn({apiKey:'synthetic-cerebras-key'});assert.equal(host.status().voiceConfigured,false);assert.equal(fixture.launches.at(-1).env.CARTESIA_API_KEY,undefined);
  await host.clear();assert.equal(host.status().provider,'cerebras','Cloud sign-out cannot select a different AI provider');assert.equal(fixture.launches.at(-1).env.CEREBRAS_API_KEY,'synthetic-cerebras-key');
 }finally{await host.close();fixture.close();}
});

test('resident exit retains explicit own selection and retries the same provider',async()=>{
 let finish;const launches=[];
 const fixture=productCharacterHostFixture(undefined,{request:async url=>String(url).includes('/models')?Response.json({data:[{id:'qwen-3.8-27b'}]}):Response.json({agents:[{status:'running'}]}),launch:async options=>{launches.push(options);let end;const completion=new Promise(resolve=>end=resolve);finish=end;return {completion,async stop(){end({code:0});}};}});
 const host=await fixture.make();
 try{
  await host.bind({token:'synthetic-cloud-secret',credentialId:'account-a',reference:'ref-a'});
  await host.selectOwn({apiKey:'synthetic-cerebras-key'});finish({code:1});
  for(let index=0;index<10&&host.status().configured;index++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(host.status().selected,true);assert.equal(host.status().configured,false);assert.equal(host.status().provider,'cerebras');
  await host.ready(new AbortController().signal);
  assert.equal(launches.at(-1).env.CEREBRAS_API_KEY,'synthetic-cerebras-key');assert.equal(launches.at(-1).env.ELIZAOS_CLOUD_API_KEY,undefined);
 }finally{await host.close();fixture.close();}
});

test('cancel/back during browser validation causes no save, selection or retirement',async()=>{
 let entered,release,validationCalls=0,retirements=0;
 const paused=new Promise(resolve=>entered=resolve),ready=new Promise(resolve=>release=resolve);
 const fixture=productCharacterHostFixture(undefined,{request:async()=>{validationCalls++;entered();await ready;return Response.json({data:[{id:'qwen-3.8-27b'}]});},launch:async()=>{let ended;return {completion:new Promise(resolve=>ended=resolve),async stop(){retirements++;ended({code:0});}};}});
 const host=await fixture.make();
 try{
  await host.bind({token:'synthetic-cloud-secret',credentialId:'account-a',reference:'ref-a'});
  const controller=new AbortController(),pending=host.selectOwn({apiKey:'synthetic-cancelled-key'},controller.signal);
  await paused;controller.abort(new DOMException('Back','AbortError'));release();
  await assert.rejects(pending,{name:'AbortError'});
  assert.equal(retirements,0);assert.equal(host.status().provider,'elizacloud');assert.equal(host.status('account-a').attachable,true);
  for(const name of await fs.readdir(fixture.profile))assert.ok(!(await fs.readFile(fixture.profile+'/'+name,'utf8')).includes('synthetic-cancelled-key'));
  const already=new AbortController();already.abort();await assert.rejects(host.selectOwn({apiKey:'synthetic-cancelled-key'},already.signal),{name:'AbortError'});assert.equal(validationCalls,1);
  await host.selectOwn({apiKey:'synthetic-accepted-key'},new AbortController().signal);assert.equal(retirements,1);assert.equal(host.status().provider,'cerebras');
 }finally{await host.close();fixture.close();}
});

test('cancelled queued Cloud selection never clears own provider or retires its agent',async()=>{
 let checking,release,calls=0,retirements=0;
 const paused=new Promise(resolve=>checking=resolve),resume=new Promise(resolve=>release=resolve);
 const fixture=productCharacterHostFixture(undefined,{request:async()=>{if(++calls===2){checking();await resume;}return Response.json({data:[{id:'qwen-3.8-27b'}]});},launch:async()=>{let ended;return {completion:new Promise(resolve=>ended=resolve),async stop(){retirements++;ended({code:0});}};}});
 const host=await fixture.make();
 try{
  await host.selectOwn({apiKey:'synthetic-first-key'});
  const saving=host.selectOwn({apiKey:'synthetic-second-key'});await paused;
  const priorRetirements=retirements,controller=new AbortController(),switching=host.selectCloud(controller.signal);controller.abort(new DOMException('Back','AbortError'));release();
  await saving;await assert.rejects(switching,{name:'AbortError'});const before=retirements;
  assert.equal(retirements,priorRetirements+1);assert.equal(host.status().provider,'cerebras');assert.equal(host.status().selected,true);
  await host.selectCloud(new AbortController().signal);assert.equal(host.status().provider,'elizacloud');assert.equal(retirements,before+1);
 }finally{await host.close();fixture.close();}
});

test('Cloud and Own selection retain RAM keys while independent edit/removal never choose a provider',async()=>{
 const fixture=productCharacterHostFixture(undefined,{inherited:{CEREBRAS_API_KEY:'synthetic-inherited-text',CARTESIA_API_KEY:'synthetic-inherited-voice',OPENAI_API_KEY:'synthetic-inherited-openai'},cloudRealtimeVoice:true,request:async()=>Response.json({data:[{id:'qwen-3.8-27b'}]})});
 const host=await fixture.make(),call=(name,input)=>host[name]({...input,expectedRevision:host.status().revision});
 try{
  await host.bind({token:'synthetic-cloud-secret',credentialId:'account-a',reference:'ref-a'});
  await call('editProviderKeys',{textKey:'synthetic-text-first',voiceKey:'synthetic-voice-first'});
  assert.equal(host.status().mode,'cloud');assert.equal(fixture.launches.length,1,'editing inactive Own keys leaves Cloud running');
  await call('selectProvider',{mode:'own'});await call('selectProvider',{mode:'cloud'});
  assert.deepEqual(JSON.parse(JSON.stringify(host.status().keys)),{text:{configured:true},voice:{configured:true}});
  assert.equal(host.status().voiceConfigured,false,'retained Voice does not select Own speech');
  assert.equal(fixture.launches.at(-1).env.CARTESIA_API_KEY,undefined);
  assert.equal(fixture.launches.at(-1).env.CEREBRAS_API_KEY,undefined);
  assert.equal(fixture.launches.at(-1).env.OPENAI_API_KEY,undefined);
  assert.equal(fixture.launches.at(-1).env.ELIZA_SELF_HOSTED_VOICE_CLOUD_RELAY_ENABLED,'1');
  assert.equal(fixture.launches.at(-1).env.ELIZAOS_CLOUD_USE_INFERENCE,'true');
  await call('editProviderKeys',{textKey:'synthetic-text-second'});
  assert.equal((await call('revealProviderKey',{key:'voice'})).value,'synthetic-voice-first');
  await call('selectProvider',{mode:'own'});
  assert.equal(fixture.launches.at(-1).env.CEREBRAS_API_KEY,'synthetic-text-second');
  assert.equal(fixture.launches.at(-1).env.CARTESIA_API_KEY,'synthetic-voice-first');
  await call('removeProviderKey',{key:'text'});
  assert.equal(host.status().mode,'own');assert.equal(host.status().configured,false);assert.equal(host.status().voiceConfigured,true);
  assert.equal(fixture.launches.at(-1).env.CEREBRAS_API_KEY,undefined);assert.equal(fixture.launches.at(-1).env.ELIZAOS_CLOUD_API_KEY,undefined);
  assert.equal(fixture.launches.at(-1).env.ELIZAOS_CLOUD_USE_INFERENCE,'false');
  await call('removeProviderKey',{key:'voice'});assert.equal(host.status().voiceConfigured,false);
  for(const name of await fs.readdir(fixture.profile))assert.ok(!(await fs.readFile(fixture.profile+'/'+name,'utf8')).includes('synthetic-'),name);
  assert.equal(JSON.stringify(host.status()).includes('synthetic-'),false);
 }finally{await host.close();fixture.close();}
});

test('account retirement fences late key validation and old reveal without deleting saved keys',async()=>{
 let entered,release,hold=false;
 const paused=new Promise(resolve=>entered=resolve),resume=new Promise(resolve=>release=resolve);
 const fixture=productCharacterHostFixture(undefined,{request:async()=>{if(hold){entered();await resume;}return Response.json({data:[{id:'qwen-3.8-27b'}]});}});
 const host=await fixture.make();
 try{
  await host.selectOwn({apiKey:'synthetic-original-text',cartesiaKey:'synthetic-original-voice'});
  const expectedRevision=host.status().revision;hold=true;
  const editing=host.editProviderKeys({expectedRevision,textKey:'synthetic-late-text'});await paused;
  const changing=host.bind({token:'synthetic-cloud-new',credentialId:'account-b',reference:'ref-b'});
  release();await assert.rejects(editing,/changed/);await changing;
  await assert.rejects(host.revealProviderKey({key:'text',expectedRevision}),/changed/);
  await assert.rejects(host.removeProviderKey({key:'voice',expectedRevision}),/changed/);
  assert.equal(host.status().mode,'own');assert.equal(fixture.launches.at(-1).env.CEREBRAS_API_KEY,'synthetic-original-text');
  assert.equal(fixture.launches.at(-1).env.CARTESIA_API_KEY,'synthetic-original-voice');
  const current=host.status().revision;await assert.rejects(host.editProviderKeys({expectedRevision:current,voiceKey:''}),/valid Voice/);
  assert.equal(host.status().revision,current,'blank is rejected without altering key custody');
  const before=fixture.launches.length;await host.editProviderKeys({expectedRevision:current,voiceKey:'synthetic-new-voice'});
  assert.equal(fixture.launches.length,before+1);assert.equal(fixture.launches.at(-1).env.CEREBRAS_API_KEY,'synthetic-original-text');
 }finally{await host.close();fixture.close();}
});

test('legacy Text-only edit preserves the already saved Voice key',async()=>{
 const fixture=productCharacterHostFixture(undefined,{request:async()=>Response.json({data:[{id:'qwen-3.8-27b'}]})}),host=await fixture.make();
 try{
  await host.selectOwn({apiKey:'synthetic-original-text',cartesiaKey:'synthetic-original-voice'});
  await host.selectOwn({apiKey:'synthetic-replacement-text'});
  assert.equal(host.status().voiceConfigured,true);
  assert.equal(fixture.launches.at(-1).env.CARTESIA_API_KEY,'synthetic-original-voice');
 }finally{await host.close();fixture.close();}
});

test('Cloud credential expiry fences an in-flight key edit without selecting a fallback',async()=>{
 let entered,release;const paused=new Promise(resolve=>entered=resolve),resume=new Promise(resolve=>release=resolve);
 const fixture=productCharacterHostFixture(undefined,{request:async()=>{entered();await resume;return Response.json({data:[{id:'qwen-3.8-27b'}]});}}),host=await fixture.make();
 try{
  await host.bind({token:'synthetic-expiring-cloud',credentialId:'expiring',reference:'expiring-ref',expiresAt:Date.now()+150});
  const expectedRevision=host.status().revision,pending=host.editProviderKeys({expectedRevision,textKey:'synthetic-expired-edit'});await paused;
  await new Promise(resolve=>setTimeout(resolve,200));release();await assert.rejects(pending,/changed/);
  await assert.rejects(host.revealProviderKey({key:'text',expectedRevision}),/changed/);
  assert.equal(host.status().keys.text.configured,false);assert.equal(host.status().mode,'cloud');assert.equal(host.status().configured,false);
 }finally{release();await host.close();fixture.close();}
});
