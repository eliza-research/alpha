import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
// Compile the actual adapter with Vite's environment substitution, rather than
// invoking its Node-only branch (which intentionally admits both issuers).
async function protocol(env){
 const result=await build({stdin:{contents:"export {Capacitor} from '@capacitor/core';export {developmentCloudVoiceEnabled} from './apps/app/src/runtime/development-cloud-voice.ts';export {cloudEnvironmentAvailable,planManagementUrl,cloudSignInHandOffAvailable,CloudProtocol} from './apps/app/src/runtime/cloud-protocol.ts';export {browserCloudManagedServiceAllowed} from './apps/app/src/runtime/browser-cloud-resident.ts';export {nativeCloudRequest,cloudSignIn} from './apps/app/src/runtime/native-connection.ts';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,define:{'import.meta.env':JSON.stringify(env)},logLevel:'silent'});
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
test('actual Cloud adapter admits explicit staging resident without mocks and refuses packaged staging',async()=>{
 const flags={DEV:true,VITE_ALPHA_CLOUD_RESIDENT:'1',VITE_ALPHA_CLOUD_ENVIRONMENT:'staging',VITE_ELIZA_DEV_ALLOW_TEST_MOCKS:''};
 const staging=await protocol(flags);assert.equal(staging.cloudEnvironmentAvailable('staging'),true);assert.equal(staging.planManagementUrl('staging'),'https://cloud-staging.eliza.app/cloud/billing');
 for(const env of [{...flags,DEV:false},{...flags,VITE_ALPHA_CLOUD_RESIDENT:''},{...flags,VITE_ALPHA_CLOUD_ENVIRONMENT:'production'}]){
  const p=await protocol(env);assert.equal(p.cloudEnvironmentAvailable('staging'),false);assert.throws(()=>p.planManagementUrl('staging'),/unavailable/);assert.equal(p.cloudEnvironmentAvailable('production'),true);
 }
});

test('the Cloud sign-in hand-off exists only in test-mocks builds and the loopback browser Cloud host',async()=>{
 const session='https://api.eliza.app/api/auth/cli-session',poll=session+'/b7a2c1d0-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
 for(const env of [{DEV:false,VITE_ELIZA_DEV_ALLOW_TEST_MOCKS:''},{DEV:true,VITE_ELIZA_DEV_ALLOW_TEST_MOCKS:''},{DEV:false,VITE_ALPHA_CLOUD_RESIDENT:'1'}]){
  const p=await protocol(env);assert.equal(p.cloudSignInHandOffAvailable,false,JSON.stringify(env));
  assert.equal(p.browserCloudManagedServiceAllowed(session,'POST',true),false);assert.equal(p.browserCloudManagedServiceAllowed(poll,'GET'),false);
  // A product build refuses before any request is made or any page is opened.
  const calls=[];const client=new p.CloudProtocol('production',async input=>{calls.push(input.url);return {status:200,data:{}};},{read:async()=>null,write:async()=>{},clear:async()=>{}},async url=>{calls.push(url);});
  await assert.rejects(client.login(new AbortController().signal),error=>error.code==='unavailable');assert.deepEqual(calls,[]);
 }
 const resident=await protocol({DEV:true,VITE_ALPHA_CLOUD_RESIDENT:'1',VITE_ELIZA_DEV_ALLOW_TEST_MOCKS:''});
 assert.equal(resident.cloudSignInHandOffAvailable,true);assert.equal(resident.browserCloudManagedServiceAllowed(session,'POST',true),true);assert.equal(resident.browserCloudManagedServiceAllowed(poll,'GET'),true);
 assert.equal(resident.browserCloudManagedServiceAllowed(poll+'?x=1','GET'),false);assert.equal(resident.browserCloudManagedServiceAllowed('https://api-staging.eliza.app/api/auth/cli-session','POST',true),false);
 assert.equal((await protocol({DEV:false,VITE_ELIZA_DEV_ALLOW_TEST_MOCKS:'1'})).cloudSignInHandOffAvailable,true);
});

test('real staging transport reaches identity and entitlement but rejects other authorities and agent routes',async()=>{
 const p=await protocol({DEV:true,VITE_ALPHA_CLOUD_RESIDENT:'1',VITE_ALPHA_CLOUD_ENVIRONMENT:'staging',VITE_ELIZA_DEV_ALLOW_TEST_MOCKS:''});
 for(const path of ['/api/v1/user','/api/v1/subscription/entitlement','/api/v1/subscription/entitlement-keys'])assert.equal(p.browserCloudManagedServiceAllowed('https://api-staging.eliza.app'+path,'GET'),true);
 for(const url of ['https://api.eliza.app/api/v1/user','https://evil.invalid/api/v1/user','https://api-staging.eliza.app.evil.invalid/api/v1/user','https://user@api-staging.eliza.app/api/v1/user','https://api-staging.eliza.app:444/api/v1/user','https://api-staging.eliza.app/api/agents'])assert.equal(p.browserCloudManagedServiceAllowed(url,'GET'),false,url);
 const original=globalThis.fetch,calls=[];globalThis.fetch=async(url,init)=>{calls.push(JSON.parse(init.body));return Response.json({status:200,data:{}});};
 try{const reply=await p.nativeCloudRequest({url:'https://api-staging.eliza.app/api/v1/user',method:'GET',headers:{},timeoutMs:1000,signal:new AbortController().signal});assert.equal(reply.status,200);assert.equal(calls[0].input.url,'https://api-staging.eliza.app/api/v1/user');assert.equal(calls[0].environment,'staging');}finally{globalThis.fetch=original;}
 const packaged=await protocol({DEV:false,VITE_ALPHA_CLOUD_RESIDENT:'1',VITE_ALPHA_CLOUD_ENVIRONMENT:'staging'});assert.equal(packaged.browserCloudManagedServiceAllowed('https://api-staging.eliza.app/api/v1/user','GET'),false);
});

 test('real browser resident admits owner-bound Cloud speech without enabling mocks or packaged speech',async()=>{
 const flags={DEV:true,VITE_ALPHA_CLOUD_RESIDENT:'1',VITE_ELIZA_DEV_ALLOW_TEST_MOCKS:'',VITE_ALPHA_DEV_CLOUD_VOICE:''};
 assert.equal((await protocol(flags)).developmentCloudVoiceEnabled,true);
 for(const env of [{...flags,DEV:false},{...flags,VITE_ALPHA_CLOUD_RESIDENT:''},{...flags,VITE_ALPHA_CLOUD_RESIDENT:'',VITE_ALPHA_DEV_CLOUD_VOICE:'1'}])assert.equal((await protocol(env)).developmentCloudVoiceEnabled,false);
 assert.equal((await protocol({DEV:true,VITE_ALPHA_CLOUD_RESIDENT:'',VITE_ELIZA_DEV_ALLOW_TEST_MOCKS:'1',VITE_ALPHA_DEV_CLOUD_VOICE:'1'})).developmentCloudVoiceEnabled,true,'existing explicit mock preview still works');
 Object.defineProperty(globalThis,'androidBridge',{configurable:true,value:{}});try{const native=await protocol({...flags,VITE_ALPHA_CLOUD_ENVIRONMENT:'staging'});assert.equal(native.Capacitor.isNativePlatform(),true);assert.equal(native.developmentCloudVoiceEnabled,false);}finally{delete globalThis.androidBridge;}
 });

test('explicit private local preview reuses email sign-in host without mocks or Cloud resident provider',async()=>{
 const p=await protocol({DEV:true,VITE_ALPHA_PRIVATE_LOCAL_PREVIEW:'1',VITE_LOCAL_AGENT:'1',VITE_ELIZA_DEV_ALLOW_TEST_MOCKS:''});assert.equal(typeof p.cloudSignIn?.status,'function');assert.equal(p.developmentCloudVoiceEnabled,false);const original=globalThis.fetch,calls=[];globalThis.fetch=async(url,input)=>{calls.push({url,body:JSON.parse(input.body)});return Response.json({inApp:true,email:true,google:false});};try{const ready=await p.cloudSignIn.status({environment:'production'});assert.equal(ready.email,true);assert.equal(ready.google,false);assert.equal(calls.length,1);assert.equal(calls[0].url,'/__alpha-browser-cloud');assert.equal(calls[0].body.operation,'signInStatus');assert.equal(calls[0].body.email,undefined);}finally{globalThis.fetch=original;}
 for(const flags of[{DEV:false,VITE_ALPHA_PRIVATE_LOCAL_PREVIEW:'1',VITE_LOCAL_AGENT:'1'},{DEV:true,VITE_ALPHA_PRIVATE_LOCAL_PREVIEW:'1'},{DEV:true,VITE_LOCAL_AGENT:'1'}])assert.equal((await protocol(flags)).cloudSignIn,undefined);
});

test('private sign-in bridge requires all explicit preview/profile gates and creates no Cloud resident',async()=>{
 const {readFileSync}=await import('node:fs'),path=await import('node:path');const text=readFileSync('scripts/browser-cloud-dev-bridge.ts','utf8');const body=text.slice(text.indexOf('export function browserCloudDevBridge()')).replace('export ','');const {transform}=await import('esbuild');const code=(await transform(body,{loader:'ts',format:'cjs'})).code;
 const allowed={ALPHA_PRIVATE_LOCAL_PREVIEW:'1',VITE_ALPHA_PRIVATE_LOCAL_PREVIEW:'1',VITE_LOCAL_AGENT:'1',ALPHA_BROWSER_CLOUD_PROFILE:'/synthetic/cloud-profile'};
 async function mount(env){let providers=0;const handlers=[],mounted=[];const plugin=new Function('process','path','homedir','environment','createCloudResidentHost','createBrowserCloudDevHandler','BROWSER_CLOUD_BRIDGE_PATH',code+';return browserCloudDevBridge();')({env},path,()=>'/synthetic',value=>value,async()=>{providers++;return{close(){}};},input=>{handlers.push(input);return()=>{};},'/__alpha-browser-cloud');assert.equal(plugin.apply,'serve');await plugin.configureServer({middlewares:{use:(route,handler)=>mounted.push({route,handler})},httpServer:{once(){}}});return{providers,handlers,mounted};}
 const actual=await mount(allowed);assert.equal(actual.providers,0);assert.equal(actual.mounted.length,1);assert.equal(actual.mounted[0].route,'/__alpha-browser-cloud');assert.equal(actual.handlers[0].profile,'/synthetic/cloud-profile');assert.equal(actual.handlers[0].resident,undefined);
 for(const name of Object.keys(allowed)){const env={...allowed};delete env[name];assert.equal((await mount(env)).mounted.length,0,name+' is required');}
});
