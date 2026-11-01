import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {deploymentOutputs,validateCloudDeployment} from '../scripts/cloud-deployment.mjs';
const defaults=JSON.parse(fs.readFileSync(new URL('../config/cloud-deployment.json',import.meta.url)));
test('committed renderer and native authorities match the deployment configuration',()=>{
 for(const [file,contents] of Object.entries(deploymentOutputs(defaults)))assert.equal(fs.readFileSync(file,'utf8'),contents);
});
test('a different deployment changes actual native login, request admission and revocation together',()=>{
 const config=structuredClone(defaults);
 config.production={api:'https://api.example.org',web:'https://login.example.org',services:'https://services.example.org',tenant:'example'};
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-cloud-config-'));
 try{
  const native='android/app/src/main/java/ai/elizaresearch/alphaphone/';
  fs.writeFileSync(path.join(temp,'CloudDeployment.java'),deploymentOutputs(config)[native+'CloudDeployment.java']);
  const files=['ConnectionRoutes.java'];
  for(const file of files)fs.copyFileSync(native+file,path.join(temp,file));
  // Alpha's registration of the shared sign-in client, read from its plugin, over the shared pure classes.
  const plugin=fs.readFileSync(native+'AlphaCloudSignInPlugin.java','utf8');
  const registration=plugin.slice(plugin.indexOf(' static final String PENDING_SLOT'),plugin.indexOf(' static String receiptSlot('));
  assert.ok(registration.includes('static CloudSignInConfig registration(boolean testMocks)'));
  const shared='vendor/eliza/packages/auth/android/src/main/java/ai/eliza/auth/cloud/';
  const sharedFiles=['CloudSignInConfig.java','CloudSignInEnvironment.java','CloudSignInFlow.java','CloudSignInRoutes.java','CloudKeyRevocation.java','CloudEmailCode.java','CloudSmsCode.java'].map(file=>shared+file).concat('vendor/eliza/packages/auth/android/test/org/json/JSONObject.java','vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/connection/CloudConnectionPolicy.java');
  fs.writeFileSync(path.join(temp,'AlphaRegistration.java'),`package ai.elizaresearch.alphaphone;
import ai.eliza.auth.cloud.*;
final class BuildConfig {static final boolean ELIZA_DEV_ALLOW_TEST_MOCKS=false;}
final class AlphaRegistration {
${registration}
}`);
  fs.writeFileSync(path.join(temp,'DeploymentTest.java'),`package ai.elizaresearch.alphaphone;
import ai.eliza.auth.cloud.*;
public class DeploymentTest {public static void main(String[] args){
 CloudSignInConfig product=AlphaRegistration.registration(false);
 CloudSignInEnvironment production=product.defaultEnvironment();
 if(!production.api().equals("https://api.example.org"))throw new AssertionError("login");
 if(!production.callback().equals("https://login.example.org/alphaphone/auth/callback"))throw new AssertionError("callback");
 if(!production.tenant.equals("example")||product.environments().size()!=1)throw new AssertionError("product registration");
 if(AlphaRegistration.registration(true).environments().size()!=2)throw new AssertionError("staging only in test-mocks builds");
 if(!CloudSignInRoutes.origin(product,"https","api.example.org",-1)||CloudSignInRoutes.origin(product,"https","api.eliza.app",-1))throw new AssertionError("sign-in origin");
 if(!ConnectionRoutes.admittedOrigin("https","api.example.org",-1,false))throw new AssertionError("configured origin refused");
 if(ConnectionRoutes.admittedOrigin("https","api.eliza.app",-1,false))throw new AssertionError("default origin retained");
 if(ConnectionRoutes.admittedOrigin("http","api.example.org",-1,false))throw new AssertionError("HTTP admitted");
 if(!ConnectionRoutes.externalHost("https","services.example.org",-1,false))throw new AssertionError("configured services refused");
 if(ConnectionRoutes.externalHost("https","cloud.eliza.app",-1,false))throw new AssertionError("default services retained");
 if(ConnectionRoutes.externalHost("https","unlisted.example.org",-1,true))throw new AssertionError("unconfigured browser host admitted");
 if(!CloudKeyRevocation.endpoint(production).equals("https://api.example.org/api/v1/api-keys/current"))throw new AssertionError("revocation");
 if(!product.readinessPreferences.equals("alpha-cloud-signin-readiness-"+CloudDeployment.STORAGE_NAMESPACE))throw new AssertionError("readiness cache bound to the deployment");
 if(CloudDeployment.storageSlot("cloud:production").equals("cloud:production"))throw new AssertionError("legacy credential reused");
 if(!CloudDeployment.storageSlot("cloud-signin:v1:pending").startsWith(CloudDeployment.STORAGE_NAMESPACE))throw new AssertionError("pending not bound");
 if(!CloudDeployment.storageSlot("local-agent-provider:v1").startsWith(CloudDeployment.STORAGE_NAMESPACE))throw new AssertionError("provider not bound");
 if(!CloudDeployment.storageSlot("notes-records:v1:device").equals("notes-records:v1:device"))throw new AssertionError("local notes changed");
 System.out.println("PASS");}}
`);
  execFileSync('javac',['--release','11','-d',temp,...['CloudDeployment.java',...files,'AlphaRegistration.java','DeploymentTest.java'].map(f=>path.join(temp,f)),...sharedFiles]);
  assert.equal(execFileSync('java',['-cp',temp,'ai.elizaresearch.alphaphone.DeploymentTest'],{encoding:'utf8'}).trim(),'PASS');
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('configuration refuses credentials, insecure URLs, paths, aliases and accidental environment overlap',()=>{
 for(const api of ['http://api.example.org','https://user:password@api.example.org','https://api.example.org/path','https://api.example.org/','https://api.example.org?token=x','https://api.example.org#x','https://API.example.org']){
  const config=structuredClone(defaults);config.production.api=api;assert.throws(()=>validateCloudDeployment(config));
 }
 const config=structuredClone(defaults);config.staging.api=config.production.api;assert.throws(()=>validateCloudDeployment(config));
});
test('configuration the shared native sign-in client cannot register fails at build time, not on the phone',()=>{
 const refused=(environment,change)=>{const config=structuredClone(defaults);change(config[environment]);assert.throws(()=>validateCloudDeployment(config),undefined,JSON.stringify(config[environment]));};
 for(const host of ['https://my_host.example.org','https://-api.example.org','https://api-.example.org'])for(const field of ['api','web'])refused('production',row=>{row[field]=host;});
 for(const tenant of ['t'.repeat(65),'tenant id','tenant.v2','tenant:eu'])refused('staging',row=>{row.tenant=tenant;});
 for(const name of ['N'.repeat(81),'Eliza‮Cloud','Eliza\u0085Cloud','Eliza​Cloud'])refused('production',row=>{row.name=name;});
 // Accepted shapes stay accepted, and the services origin keeps its own browser-host rule.
 const config=structuredClone(defaults);
 config.production={...config.production,tenant:'Org_Tenant-1',name:'N'.repeat(80),services:'https://my_services.example.org'};
 assert.doesNotThrow(()=>validateCloudDeployment(config));
 // The shared registration constructor accepts every tenant this validator admits.
 const shared=fs.readFileSync('vendor/eliza/packages/auth/android/src/main/java/ai/eliza/auth/cloud/CloudSignInEnvironment.java','utf8');
 const tenantRule=shared.match(/tenant\.matches\("([^"]+)"\)/)?.[1];
 assert.ok(tenantRule,'shared tenant rule located');
 for(const tenant of ['Org_Tenant-1','elizacloud','elizacloud-staging','t'.repeat(64)])assert.match(tenant,new RegExp(`^(?:${tenantRule})$`),tenant);
});

test('build admission rejects drift in either renderer or native generated authorities',async()=>{
 const {checkCloudDeployment}=await import('../scripts/cloud-deployment.mjs');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-cloud-build-'));
 try{
  fs.mkdirSync(path.join(temp,'config'));fs.writeFileSync(path.join(temp,'config/cloud-deployment.json'),JSON.stringify(defaults));
  const outputs=deploymentOutputs(defaults);
  for(const [file,contents] of Object.entries(outputs)){fs.mkdirSync(path.dirname(path.join(temp,file)),{recursive:true});fs.writeFileSync(path.join(temp,file),contents);}
  checkCloudDeployment(temp);
  for(const [file,contents] of Object.entries(outputs)){
   fs.writeFileSync(path.join(temp,file),contents.replace('api.eliza.app','unexpected.example.org'));
   assert.throws(()=>checkCloudDeployment(temp),/Stale Cloud deployment output/);
   fs.writeFileSync(path.join(temp,file),contents);
  }
  const changed=structuredClone(defaults);changed.production.tenant='another-tenant';
  fs.writeFileSync(path.join(temp,'config/cloud-deployment.json'),JSON.stringify(changed));
  assert.throws(()=>checkCloudDeployment(temp),/Stale Cloud deployment output/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('every authority change gives renderer and native credentials a new namespace',async()=>{
 const file='apps/app/src/runtime/cloud-deployment.generated.ts';
 const load=async config=>{
  const {stripTypeScriptTypes}=await import('node:module');
  return import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(deploymentOutputs(config)[file])).toString('base64'));
 };
 const original=await load(defaults);
 for(const env of ['production','staging'])for(const key of ['api','web','services','tenant','entitlementAudience']){
  const config=structuredClone(defaults);config[env][key]=key==='tenant'?'another-tenant':key==='entitlementAudience'?'another-audience':'https://different.example.org';
  const changed=await load(config);
  assert.notEqual(changed.cloudStorageSlot('cloud:production'),original.cloudStorageSlot('cloud:production'));
  assert.notEqual(changed.cloudStorageSlot('cloud-signin:v1:ack:production'),original.cloudStorageSlot('cloud-signin:v1:ack:production'));
  assert.equal(changed.cloudStorageSlot('notes-records:v1:device'),'notes-records:v1:device');
  assert.ok(deploymentOutputs(config)['android/app/src/main/java/ai/elizaresearch/alphaphone/CloudDeployment.java'].includes(changed.cloudStorageNamespace));
 }
});

test('custom deployment reaches native inference configuration and Google transport',async()=>{
 const {pathToFileURL}=await import('node:url');
 const {tsImport}=await import('tsx/esm/api');
 const config=structuredClone(defaults);
 config.production={api:'https://api.example.org',web:'https://login.example.org',services:'https://services.example.org',tenant:'example'};
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-cloud-backend-'));
 const write=(name,text)=>{fs.mkdirSync(path.dirname(path.join(temp,name)),{recursive:true});fs.writeFileSync(path.join(temp,name),text);};
 const envKeys=['ELIZAOS_CLOUD_BASE_URL','ELIZAOS_CLOUD_SMALL_MODEL','ELIZAOS_CLOUD_LARGE_MODEL','ELIZA_RUNTIME_PROFILE','ELIZA_LOCAL_EMBEDDING_ENABLED','ELIZA_DISABLE_LOCAL_EMBEDDINGS'];
 const previousEnv=Object.fromEntries(envKeys.map(name=>[name,process.env[name]]));
 try{
  write('package.json','{"type":"module"}');
  for(const [name,text] of Object.entries(deploymentOutputs(config)))write(name,text);
  for(const name of ['config/alpha-product.json','backend/managed-google-failure-stage.ts','backend/managed-google-route-policy.ts','backend/native-google-cloud-port.ts','backend/native-cloud-runtime.ts','apps/app/src/runtime/managed-service-routes.ts'])write(name,fs.readFileSync(name,'utf8'));
  const load=name=>tsImport(pathToFileURL(path.join(temp,name)).href,{parentURL:import.meta.url});
  // The product declares only its admitted Cloud API base; the shared upstream
  // runtime profile writes routing and refuses any other base URL.
  const {nativeCloudRuntime}=await load('backend/native-cloud-runtime.ts');
  assert.equal(nativeCloudRuntime.apiBaseUrl,config.production.api+'/api/v1');
  const product=JSON.parse(fs.readFileSync('config/alpha-product.json','utf8'));
  assert.equal(nativeCloudRuntime.productCharacter.name,product.identity.characterName);
  assert.ok(nativeCloudRuntime.productCharacter.bio[0].includes(product.identity.appName));
  assert.ok(Object.isFrozen(nativeCloudRuntime));
  const {createNativeGoogleCloudPort}=await load('backend/native-google-cloud-port.ts');
  const id='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222',org='33333333-3333-4333-8333-333333333333',calls=[];
  const port=createNativeGoogleCloudPort({credentialId:id,userId:user,organizationId:org,accountRef:JSON.stringify(['cloud','production',user,org]),sessionGeneration:'synthetic',token:'synthetic-token'},()=>{},async(url)=>{calls.push(String(url));return new Response('{}',{headers:{'content-type':'application/json'}});});
  const request={url:config.production.api+'/api/v1/eliza/google/accounts?side=owner',method:'GET',credentialReference:'native-google-reference:'+id,signal:new AbortController().signal};
  await port.agentRead(request);assert.deepEqual(calls,[request.url]);
  await assert.rejects(port.agentRead({...request,url:defaults.production.api+'/api/v1/eliza/google/accounts?side=owner'}),/refused/);
 }finally{
  for(const [name,value] of Object.entries(previousEnv)){if(value===undefined)delete process.env[name];else process.env[name]=value;}
  fs.rmSync(temp,{recursive:true,force:true});
 }
});

test('configured service names reach the renderer without changing credential authority',async()=>{
 const {stripTypeScriptTypes}=await import('node:module');
 const load=async config=>import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(deploymentOutputs(config)['apps/app/src/runtime/cloud-deployment.generated.ts'])).toString('base64'));
 const original=await load(defaults),config=structuredClone(defaults);
 config.production.name='Independent Service';config.staging.name='Independent Preview';
 const changed=await load(config);
 assert.equal(changed.productionCloud.name,'Independent Service');assert.equal(changed.stagingCloud.name,'Independent Preview');
 assert.equal(changed.cloudStorageNamespace,original.cloudStorageNamespace);
 delete config.production.name;assert.equal((await load(config)).productionCloud.name,new URL(config.production.api).hostname);
 for(const name of ['', '   ', ' Invalid', 'Invalid\nName', 42]){config.production.name=name;assert.throws(()=>validateCloudDeployment(config));}
});
