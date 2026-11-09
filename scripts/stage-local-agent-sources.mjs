import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {sourceDirectory, verifySource} from './local-agent-source.mjs';
import {applyUpstreamRepair} from './upstream-native-repairs.mjs';
const root=path.resolve(import.meta.dirname,'..');
const upstream=path.join(root,'vendor/eliza');
const pin=JSON.parse(fs.readFileSync(path.join(root,'upstream.lock.json'),'utf8')).commit;
if(execFileSync('git',['-C',upstream,'rev-parse','HEAD'],{encoding:'utf8'}).trim()!==pin)throw Error('Unexpected native runtime source pin');
const identity=JSON.parse(fs.readFileSync(path.join(root,'app.config.json'),'utf8')).appId;
if(!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(identity))throw Error('Invalid application identity');
// All shared native code comes directly from the same reviewed upstream commit.
const digest=value=>createHash('sha256').update(value).digest('hex');
const runtimeSource=sourceDirectory(root);
if(!fs.existsSync(path.join(runtimeSource,'.alpha-runtime-source.json')))throw Error(`Prepared runtime source ${path.relative(root,runtimeSource)} is missing. Run npm run android:build:local (distributable APKs) or npm run agent:prepare first.`);
verifySource(runtimeSource,pin);
const classes=['SecureStoreFrameInput','AgentSecureStore','DeviceRamTierPolicy','ElizaAgentService','IpcStartupRecovery','WorkflowSurvivorInventory','ElizaAgentWatchdogPolicy','ElizaAssetExtractionPolicy','ElizaBionicInferenceServer','NativeSourceHost','ElizaStartupTrace','ElizaWorkScheduler','ElizaTasksWorker','InferenceMemoryPolicy','RuntimeInstallationIdentity','BionicDecodeLoop','BionicAsrStreams','ElizaAsrNativeEnv','ElizaVoiceNative','BgeEmbeddingSession','AndroidBunTarget'];
const output=path.join(root,'android/app/build/generated/local-agent/java');
fs.rmSync(output,{recursive:true,force:true});
const target=path.join(output,...identity.split('.'));fs.mkdirSync(target,{recursive:true});
const manifest={pin,identity,runtimeSource:{commit:pin},patches:[],upstreamRepairs:[],files:[]};
for(const name of classes){
  const relative=`packages/app/platforms/android/app/src/main/java/ai/elizaos/app/${name}.java`;
  const input=fs.readFileSync(path.join(runtimeSource,relative),'utf8');
  const repaired=applyUpstreamRepair(relative,input);
  if(repaired.repair)manifest.upstreamRepairs.push(repaired.repair);
  let value=repaired.value.replaceAll('ai.elizaos.app',identity).replaceAll('R.mipmap.ic_launcher','R.drawable.notification_icon');
  // Abstract sockets are device-global. Give the consumer its own namespace.
  value=value.replaceAll('"eliza_local_agent_v1"',`"${identity}.agent.v1"`).replaceAll('"eliza_bionic_infer_v1"',`"${identity}.inference.v1"`);
  if(name==='ElizaAgentService'){
    const anchor='agentEnv.put("ELIZA_LOCAL_AGENT_SOCKET_PATH",privateSocketPath);';
    if(value.split(anchor).length!==2)throw Error('Native runtime environment insertion point changed');
    value=value.replace(anchor,anchor+`\n            agentEnv.put("ELIZA_ANDROID_SECURE_STORE_SOCKET", "${identity}.secure-store");\n            try { AlphaLocalAgentPlugin.configureEnvironment(this, agentEnv); } catch (java.io.IOException unavailable) { currentStatus = "provider-unavailable"; updateNotification(); return false; }`);
  }
  fs.writeFileSync(path.join(target,name+'.java'),value);
  manifest.files.push({path:relative,generatedPath:path.relative(root,path.join(target,name+'.java')),sourceSha256:digest(input),sha256:digest(input),generatedSha256:createHash('sha256').update(value).digest('hex')});
}
// Stage shared native helpers without changing their packages or implementations.
// Record the same source provenance as the service adapters above.
for(const relative of [
 'plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/NativeProcessSupervisor.java',
 'plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/CredentialShutdownLease.java',
 // JsonCredentialSlots is compiled from the :elizaos-capacitor-secure-store module (patched
 // source, byte-identical for that file); staging a second copy would duplicate the class.
]){
 const input=fs.readFileSync(path.join(runtimeSource,relative),'utf8');
 const target=path.join(output,relative.split('/android/src/main/java/')[1]);
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,input);
 manifest.files.push({path:relative,generatedPath:path.relative(root,target),sourceSha256:digest(input),sha256:digest(input),generatedSha256:digest(input)});
}
const browserTarget=path.join(output,'ai/eliza/plugins/browsersurface');fs.mkdirSync(browserTarget,{recursive:true});
for(const name of ['ChromiumBrowserIdentity','ChromiumBrowserConnection','BrowserWebOrigin','BrowserDownloadPolicy','BrowserSessionPolicy','BrowserSitePermissions','BrowserSitePermissionRecord','BrowserExternalPage','BrowserExternalLinkPolicy','BrowserAutofillEligibility']){
 const relative=`plugins/plugin-native-browser-surface/android/src/main/java/ai/eliza/plugins/browsersurface/${name}.java`;
 const input=fs.readFileSync(path.join(runtimeSource,relative),'utf8');
 const value=name==='ChromiumBrowserConnection'?input.replace('package ai.eliza.plugins.browsersurface;',`package ai.eliza.plugins.browsersurface;\nimport ${identity}.BuildConfig;`):input;
 const generated=path.join(browserTarget,name+'.java');fs.writeFileSync(generated,value);
 manifest.files.push({path:relative,generatedPath:path.relative(root,generated),sourceSha256:digest(input),sha256:digest(input),generatedSha256:digest(value)});
}
fs.writeFileSync(path.join(root,'android/app/build/generated/local-agent/source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`Generated ${manifest.files.length} pinned local-agent sources for ${identity}`);
