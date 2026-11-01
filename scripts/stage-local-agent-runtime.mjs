#!/usr/bin/env node
import {preparedSourceEnv,sourceDirectory,workerArtifactDirectory} from './local-agent-source.mjs';
import {verifyWorkerArtifact,workerHash} from './workflow-worker-artifact.mjs';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {nativeViewPolicyPath} from './native-view-policy.mjs';
import {verifyNativeGoogleHostArtifact} from './native-google-host-artifact.mjs';
import {stageAgentBundleDependencies} from './agent-bundle-dependencies.mjs';
import {MOBILE_BUILD_RECEIPT,verifyMobileBuildReceipt} from './mobile-uuid-adapter.mjs';
const root=path.resolve(import.meta.dirname,'..');

/** Explicit producer inputs; native Android never falls back to a musl archive or another ABI. */
export function runtimeStagingSelection(source,parentEnv=process.env){
 const bunTarget=parentEnv.ELIZA_ANDROID_BUN_TARGET??'linux-musl';
 if(!['linux-musl','android'].includes(bunTarget))throw Error('Unsupported Android Bun target');
 const requested=(parentEnv.ELIZA_ANDROID_TARGET_ABIS??'arm64-v8a,x86_64').split(',').map(abi=>abi.trim());
 if(!requested.length||new Set(requested).size!==requested.length||requested.some(abi=>!['arm64-v8a','x86_64'].includes(abi)))throw Error('Invalid Android runtime ABI selection');
 const targetAbis=requested.join(',');
 const extra={ELIZA_ANDROID_TARGET_ABIS:targetAbis,ELIZA_ANDROID_BUN_TARGET:bunTarget};
 if(bunTarget==='android'){
  if(targetAbis!=='arm64-v8a')throw Error('Native Android producer requires explicit ARM64-only selection');
  if(!['stable','release'].includes((parentEnv.ELIZA_BUN_CHANNEL??'stable').trim().toLowerCase()))throw Error('Native Android producer requires the reviewed stable channel');
  const archive=parentEnv.ELIZA_BUN_AARCH64_FILE;
  if(!archive||!path.isAbsolute(archive)||!fs.lstatSync(archive).isFile())throw Error('Native Android producer requires an absolute verified archive file');
  if(fs.statSync(archive).size>40*1024*1024)throw Error('Native Android archive exceeds the reviewed size bound');
  const lock=JSON.parse(fs.readFileSync(path.join(source,'packages/app/scripts/lib/android-bun-artifacts.lock.json'),'utf8'));
  const expected=lock.targets?.android?.stable?.artifacts?.aarch64?.archiveSha256;
  if(!/^[a-f0-9]{64}$/.test(expected??'')||createHash('sha256').update(fs.readFileSync(archive)).digest('hex')!==expected)throw Error('Native Android archive differs from the pinned SDK artifact');
  extra.ELIZA_BUN_AARCH64_FILE=archive;extra.ELIZA_BUN_CHANNEL='stable';
 }
 return {bunTarget,targetAbis,env:preparedSourceEnv(parentEnv,extra)};
}

function stageLocalAgentRuntime(){

const profile=process.argv.slice(2);
if(profile.some(arg=>arg!=='--runtime-profile=cloud'))throw Error('Unknown runtime profile');
const runtimeProfile=profile.includes('--runtime-profile=cloud')?'cloud':'native';
const source=sourceDirectory(root);
if(!fs.existsSync(path.join(source,'.alpha-runtime-source.json')))throw Error('Run npm run agent:prepare first.');
execFileSync(process.execPath,[path.join(root,'scripts/prepare-local-agent.mjs'),'--source-only'],{cwd:root,stdio:'inherit'});
const selection=runtimeStagingSelection(source,process.env);
verifyWorkerArtifact(workerArtifactDirectory(root),
 {sourceStampSha256:workerHash(fs.readFileSync(path.join(source,'.alpha-runtime-source.json'))),lockSha256:workerHash(fs.readFileSync(path.join(source,'bun.lock')))});
verifyNativeGoogleHostArtifact(root,workerArtifactDirectory(root));
// Children run inside the immutable prepared source; keep turbo from editing its AGENTS.md.
const env=selection.env;
execFileSync(process.env.ALPHA_BUN||'bun',[path.join(root,'scripts/build-mobile-agent.mjs'),source,'--target=android'],{cwd:source,env,stdio:'inherit'});
verifyMobileBuildReceipt(root,source);
// The build must leave the prepared source at the exact pinned commit.
execFileSync(process.execPath,[path.join(root,'scripts/prepare-local-agent.mjs'),'--source-only'],{cwd:root,stdio:'inherit'});
// Bun supplies the upstream TypeScript staging module's runtime semantics.
const runner=path.join(source,'.alpha-stage-runtime.ts');
fs.writeFileSync(runner,`import {stageAndroidAgentRuntime} from './packages/app/scripts/lib/stage-android-agent.ts';\nawait stageAndroidAgentRuntime({androidDir:${JSON.stringify(path.join(root,'android'))},spikeDir:${JSON.stringify(path.join(source,'packages/app/scripts'))},bunTarget:${JSON.stringify(selection.bunTarget)}});\n`);
try{execFileSync(process.env.ALPHA_BUN||'bun',[runner],{cwd:source,env,stdio:'inherit'});}finally{fs.unlinkSync(runner);}
stageAgentBundleDependencies(source,path.join(root,'android/app/src/main/assets/agent'));
fs.copyFileSync(path.join(source,'packages/agent/dist-mobile',MOBILE_BUILD_RECEIPT),path.join(root,'android/app/src/main/assets/agent',MOBILE_BUILD_RECEIPT));
fs.copyFileSync(path.join(source,'.alpha-runtime-source.json'),path.join(root,'android/app/src/main/assets/agent/alpha-source.json'));
// Host configuration is separate from the authenticated, unmodified producer source.
fs.copyFileSync(nativeViewPolicyPath,path.join(root,'android/app/src/main/assets/agent/native-view-declarations.json'));
execFileSync(process.execPath,[path.join(root,'scripts/stage-workflow-worker.mjs')],{cwd:root,env:process.env,stdio:'inherit'});
const omittedLocalModels=[];
if(runtimeProfile==='cloud'){
 const relative='assets/agent/models/bge-small-en-v1.5-f16.gguf',file=path.join(root,'android/app/src/main',relative);
 const sha256=createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 if(sha256!=='f0b2fef971e8366438bfd2d9aefea1b0115919389448806d290237f638bae999')throw Error('Cloud projection refuses unrecognized local model');
 omittedLocalModels.push({path:relative,sha256});fs.unlinkSync(file);
}
// The original producer provenance remains unchanged; this explicit consumer projection
// records the exact local-only model deliberately omitted from the Cloud APK.
fs.writeFileSync(path.join(root,'android/app/src/main/assets/agent/alpha-runtime-profile.json'),JSON.stringify({version:1,runtimeProfile,...(runtimeProfile==='cloud'?{omittedLocalModels}:{})},null,2)+'\n');
console.log(`Android runtime payload staged for ${selection.targetAbis} with ${selection.bunTarget}. This is not device execution evidence.`);

}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))stageLocalAgentRuntime();
