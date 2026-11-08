import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createCloudResidentHost} from './fixtures/product-character-host.mjs';
import {CLOUD_MODEL} from '../scripts/cloud-resident-host.mjs';

function recordingLauncher(launches) {
 return async options=>{launches.push(options);let finish;return {completion:new Promise(done=>{finish=done;}),async stop(){finish({code:0});}};};
}

// Exercise the real SDK's routing normalization, runtime projection and dispatch
// capability gate. No runtime or registered provider is instantiated or called.
function selectEmbeddingRoute(config,env) {
 assert.ok(process.env.ALPHA_CLOUD_COLLECTOR_SOURCE,'a verified prepared SDK is required');
 assert.ok(process.env.ALPHA_BUN,'the pinned Bun must be supplied');
 const code=`import {readFileSync} from 'node:fs';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
 const {config,env}=JSON.parse(readFileSync(0,'utf8')),source=process.env.ALPHA_CLOUD_COLLECTOR_SOURCE;
 const load=p=>import(pathToFileURL(join(source,p)).href);
 const {resolveElizaCloudTopology}=await load('packages/host/src/contracts/cloud-topology.ts');
 const {buildRuntimeSettingsProjection}=await load('packages/agent/src/runtime/runtime-settings.ts');
 const {isCanonicalModelCapabilityDisabled}=await load('packages/core/src/runtime/model-policy.ts');
 const {buildElizaCloudServiceRoute}=await load('packages/host/src/contracts/service-routing.ts');
 const settings=buildRuntimeSettingsProjection(config,{env});
 const disabled=isCanonicalModelCapabilityDisabled({getSetting:key=>settings[key]},'TEXT_EMBEDDING');
 console.log('EMBEDDING_ROUTE='+JSON.stringify({cloud:resolveElizaCloudTopology(config).services.embeddings,disabled,enabled:settings.ELIZA_CANONICAL_EMBEDDINGS_ENABLED,canonicalRoute:buildElizaCloudServiceRoute()}));`;
 const run=spawnSync(process.env.ALPHA_BUN,['--no-install','--conditions=eliza-source','--eval',code],{env:{...process.env},input:JSON.stringify({config,env}),encoding:'utf8',timeout:20000});
 assert.equal(run.status,0,run.stderr);
 const line=run.stdout.split('\n').find(row=>row.startsWith('EMBEDDING_ROUTE='));assert.ok(line,run.stdout);
 return JSON.parse(line.slice('EMBEDDING_ROUTE='.length));
}

for(const profileMode of ['lean','full'])test(`fresh ${profileMode} host explicitly enables canonical Cloud embeddings without persisting credentials`,async()=>{
 const profile=await fs.mkdtemp(join(tmpdir(),'alpha-cloud-embedding-fresh-')),launches=[];
 const host=await createCloudResidentHost({source:resolve('vendor/eliza'),profile,port:47869,profileMode,launch:recordingLauncher(launches),inherited:{PATH:process.env.PATH}});
 try {
  const file=join(profile,'eliza.json'),before=await fs.readFile(file,'utf8');
  await host.bind({token:'synthetic-route-token',credentialId:'synthetic-owner-binding',reference:'synthetic-reference'});
  const config=JSON.parse(await fs.readFile(file,'utf8')),env=launches[0].env;
  const route=selectEmbeddingRoute(config,env);
  assert.equal(route.cloud,true);assert.equal(route.disabled,false);assert.equal(route.enabled,'true');
  assert.deepEqual(config.serviceRouting.embeddings,{backend:route.canonicalRoute.backend,transport:route.canonicalRoute.transport});
  assert.equal(env.ELIZAOS_CLOUD_USE_EMBEDDINGS,'true');assert.equal(env.ELIZA_DISABLE_LOCAL_EMBEDDINGS,'true');
  assert.equal(env.ELIZAOS_CLOUD_EMBEDDING_MODEL,'bge-small-en-v1.5');assert.equal(env.ELIZAOS_CLOUD_EMBEDDING_DIMENSIONS,'384');
  assert.equal(config.serviceRouting.llmText.largeModel,CLOUD_MODEL);
  assert.deepEqual(Object.keys(config.serviceRouting).sort(),['embeddings','llmText']);
  assert.equal(await fs.readFile(file,'utf8'),before,'binding must not rewrite the initial configuration');
  assert.ok(!before.includes('synthetic-route-token'));assert.ok(!JSON.stringify(config).includes('apiKey'));
 } finally {await host.close();await fs.rm(profile,{recursive:true,force:true});}
});

for(const choice of ['omitted','disabled','explicit'])for(const profileMode of ['lean','full'])test(`saved ${profileMode} ${choice} embedding route remains byte-for-byte owner configuration`,async()=>{
 const profile=await fs.mkdtemp(join(tmpdir(),'alpha-cloud-embedding-saved-')),launches=[],file=join(profile,'eliza.json');
 const embeddings=choice==='omitted'?{}:{embeddings:choice==='disabled'?null:{backend:'elizacloud',transport:'cloud-proxy'}};
 const saved=' \n'+JSON.stringify({cloud:{enabled:true},serviceRouting:{llmText:{backend:'elizacloud',transport:'cloud-proxy',smallModel:CLOUD_MODEL,largeModel:CLOUD_MODEL},...embeddings},plugins:{entries:{'personal-assistant':{enabled:profileMode==='full'}}}},null,3)+'\n';
 await fs.writeFile(file,saved,{mode:0o600});await fs.writeFile(join(profile,'owner-token'),'1'.repeat(64),{mode:0o600});
 const host=await createCloudResidentHost({source:resolve('vendor/eliza'),profile,port:47869,profileMode,launch:recordingLauncher(launches),inherited:{PATH:process.env.PATH}});
 try {
  await host.bind({token:'synthetic-route-token',credentialId:'synthetic-owner-binding',reference:'synthetic-reference'});
  const route=selectEmbeddingRoute(JSON.parse(saved),launches[0].env);
  assert.equal(route.cloud,choice==='explicit');
  if(choice!=='explicit'){assert.equal(route.disabled,true);assert.equal(route.enabled,'false','bound process flags must not override the omitted canonical capability');}
  await host.clear();assert.equal(await fs.readFile(file,'utf8'),saved,'never migrate, repair or fill a saved route');
 } finally {await host.close();await fs.rm(profile,{recursive:true,force:true});}
});
