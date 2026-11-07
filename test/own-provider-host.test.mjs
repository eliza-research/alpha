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
