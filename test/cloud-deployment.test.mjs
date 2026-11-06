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
  const files=['CloudSignInFlow.java','ConnectionRoutes.java','CloudKeyRevocation.java'];
  for(const file of files)fs.copyFileSync(native+file,path.join(temp,file));
  fs.writeFileSync(path.join(temp,'DeploymentTest.java'),`package ai.elizaresearch.alphaphone;
public class DeploymentTest {public static void main(String[] args){
 if(!CloudSignInFlow.Environment.PRODUCTION.api().equals("https://api.example.org"))throw new AssertionError("login");
 if(!CloudSignInFlow.Environment.PRODUCTION.callback().equals("https://login.example.org/alphaphone/auth/callback"))throw new AssertionError("callback");
 if(!ConnectionRoutes.admittedOrigin("https","api.example.org",-1,false))throw new AssertionError("configured origin refused");
 if(ConnectionRoutes.admittedOrigin("https","api.eliza.app",-1,false))throw new AssertionError("default origin retained");
 if(ConnectionRoutes.admittedOrigin("http","api.example.org",-1,false))throw new AssertionError("HTTP admitted");
 if(!ConnectionRoutes.externalHost("https","services.example.org",-1,false))throw new AssertionError("configured services refused");
 if(ConnectionRoutes.externalHost("https","cloud.eliza.app",-1,false))throw new AssertionError("default services retained");
 if(ConnectionRoutes.externalHost("https","unlisted.example.org",-1,true))throw new AssertionError("unconfigured browser host admitted");
 if(!CloudKeyRevocation.endpoint("production").equals("https://api.example.org/api/v1/api-keys/current"))throw new AssertionError("revocation");
 if(CloudDeployment.storageSlot("cloud:production").equals("cloud:production"))throw new AssertionError("legacy credential reused");
 if(!CloudDeployment.storageSlot("cloud-signin:v1:pending").startsWith(CloudDeployment.STORAGE_NAMESPACE))throw new AssertionError("pending not bound");
 if(!CloudDeployment.storageSlot("local-agent-provider:v1").startsWith(CloudDeployment.STORAGE_NAMESPACE))throw new AssertionError("provider not bound");
 if(!CloudDeployment.storageSlot("notes-records:v1:device").equals("notes-records:v1:device"))throw new AssertionError("local notes changed");
 System.out.println("PASS");}}
`);
  execFileSync('javac',['--release','11','-d',temp,...['CloudDeployment.java',...files,'DeploymentTest.java'].map(f=>path.join(temp,f))]);
  assert.equal(execFileSync('java',['-cp',temp,'ai.elizaresearch.alphaphone.DeploymentTest'],{encoding:'utf8'}).trim(),'PASS');
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('configuration refuses credentials, insecure URLs, paths, aliases and accidental environment overlap',()=>{
 for(const api of ['http://api.example.org','https://user:password@api.example.org','https://api.example.org/path','https://api.example.org/','https://api.example.org?token=x','https://api.example.org#x','https://API.example.org']){
  const config=structuredClone(defaults);config.production.api=api;assert.throws(()=>validateCloudDeployment(config));
 }
 const config=structuredClone(defaults);config.staging.api=config.production.api;assert.throws(()=>validateCloudDeployment(config));
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
 const config=structuredClone(defaults);
 config.production={api:'https://api.example.org',web:'https://login.example.org',services:'https://services.example.org',tenant:'example'};
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-cloud-backend-'));
 const write=(name,text)=>{fs.mkdirSync(path.dirname(path.join(temp,name)),{recursive:true});fs.writeFileSync(path.join(temp,name),text);};
 const oldBase=process.env.ELIZAOS_CLOUD_BASE_URL,oldSmall=process.env.ELIZAOS_CLOUD_SMALL_MODEL,oldLarge=process.env.ELIZAOS_CLOUD_LARGE_MODEL;
 try{
  write('package.json','{"type":"module"}');
  for(const [name,text] of Object.entries(deploymentOutputs(config)))write(name,text);
  for(const name of ['backend/managed-google-route-policy.ts','backend/native-google-cloud-port.ts','backend/native-cloud-runtime-config.ts','apps/app/src/runtime/managed-service-routes.ts'])write(name,fs.readFileSync(name,'utf8'));
  const load=name=>import(pathToFileURL(path.join(temp,name)).href);
  // The native module declares only its deployment; upstream's runtime profile owns routing.
  const {nativeCloudRuntime}=await load('backend/native-cloud-runtime-config.ts');
  assert.deepEqual(nativeCloudRuntime,{apiBaseUrl:config.production.api+'/api/v1'});assert.ok(Object.isFrozen(nativeCloudRuntime));
  const {createNativeGoogleCloudPort}=await load('backend/native-google-cloud-port.ts');
  const id='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222',org='33333333-3333-4333-8333-333333333333',calls=[];
  const port=createNativeGoogleCloudPort({credentialId:id,userId:user,organizationId:org,accountRef:JSON.stringify(['cloud','production',user,org]),sessionGeneration:'synthetic',token:'synthetic-token'},()=>{},async(url)=>{calls.push(String(url));return new Response('{}',{headers:{'content-type':'application/json'}});});
  const request={url:config.production.api+'/api/v1/eliza/google/accounts?side=owner',method:'GET',credentialReference:'native-google-reference:'+id,signal:new AbortController().signal};
  await port.agentRead(request);assert.deepEqual(calls,[request.url]);
  await assert.rejects(port.agentRead({...request,url:defaults.production.api+'/api/v1/eliza/google/accounts?side=owner'}),/refused/);
 }finally{
  for(const [name,value] of Object.entries({ELIZAOS_CLOUD_BASE_URL:oldBase,ELIZAOS_CLOUD_SMALL_MODEL:oldSmall,ELIZAOS_CLOUD_LARGE_MODEL:oldLarge})){if(value===undefined)delete process.env[name];else process.env[name]=value;}
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
