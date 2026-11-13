#!/usr/bin/env bun
import {preparedSourceEnv,sourceDirectory,workerArtifactDirectory} from './local-agent-source.ts';
import {verifyWorkerArtifact,workerHash} from './workflow-worker-artifact.ts';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {nativeViewDeclarationsJson} from './native-view-policy.ts';
import {verifyNativeGoogleHostArtifact} from './native-google-host-artifact.ts';
import {stageAgentBundleDependencies} from './agent-bundle-dependencies.ts';
import {MOBILE_BUILD_RECEIPT,verifyMobileBuildReceipt} from './mobile-uuid-adapter.ts';
const root=path.resolve(import.meta.dirname,'..');

/** The one producer selection: the musl Bun for both packaged debug ABIs. */
const BUN_TARGET='linux-musl',TARGET_ABIS='arm64-v8a,x86_64';
export function runtimeStagingSelection(parentEnv=process.env){
 return {bunTarget:BUN_TARGET,targetAbis:TARGET_ABIS,env:preparedSourceEnv(parentEnv,{ELIZA_ANDROID_TARGET_ABIS:TARGET_ABIS,ELIZA_ANDROID_BUN_TARGET:BUN_TARGET})};
}

/** Staging takes no options: one profile, with local speech and embeddings always packaged. */
export function stagingArguments(args: readonly string[]){
 if(args.length)throw Error('Unknown option '+args[0]);
}

function stageLocalAgentRuntime(){

stagingArguments(process.argv.slice(2));
const source=sourceDirectory(root);
if(!fs.existsSync(path.join(source,'.alpha-runtime-source.json')))throw Error('Run bun run agent:prepare first.');
execFileSync(process.execPath,[path.join(root,'scripts/prepare-local-agent.ts'),'--source-only'],{cwd:root,stdio:'inherit'});
const selection=runtimeStagingSelection(process.env);
verifyWorkerArtifact(workerArtifactDirectory(root),
 {sourceStampSha256:workerHash(fs.readFileSync(path.join(source,'.alpha-runtime-source.json'))),lockSha256:workerHash(fs.readFileSync(path.join(source,'bun.lock')))});
verifyNativeGoogleHostArtifact(root,workerArtifactDirectory(root));
// Children run inside the immutable prepared source; keep turbo from editing its AGENTS.md.
const env=selection.env;
execFileSync(process.env.ALPHA_BUN||'bun',[path.join(root,'scripts/build-mobile-agent.ts'),source,'--target=android'],{cwd:source,env,stdio:'inherit'});
verifyMobileBuildReceipt(root,source);
// The build must leave the prepared source at the exact pinned commit.
execFileSync(process.execPath,[path.join(root,'scripts/prepare-local-agent.ts'),'--source-only'],{cwd:root,stdio:'inherit'});
// Bun supplies the upstream TypeScript staging module's runtime semantics.
const runner=path.join(source,'.alpha-stage-runtime.ts');
fs.writeFileSync(runner,`import {stageAndroidAgentRuntime} from './packages/app/scripts/lib/stage-android-agent.ts';\nawait stageAndroidAgentRuntime({androidDir:${JSON.stringify(path.join(root,'android'))},spikeDir:${JSON.stringify(path.join(source,'packages/app/scripts'))},bunTarget:${JSON.stringify(selection.bunTarget)}});\n`);
try{execFileSync(process.env.ALPHA_BUN||'bun',[runner],{cwd:source,env,stdio:'inherit'});}finally{fs.unlinkSync(runner);}
stageAgentBundleDependencies(source,path.join(root,'android/app/src/main/assets/agent'));
fs.copyFileSync(path.join(source,'packages/agent/dist-mobile',MOBILE_BUILD_RECEIPT),path.join(root,'android/app/src/main/assets/agent',MOBILE_BUILD_RECEIPT));
fs.copyFileSync(path.join(source,'.alpha-runtime-source.json'),path.join(root,'android/app/src/main/assets/agent/alpha-source.json'));
// Host configuration is separate from the authenticated, unmodified producer source.
fs.writeFileSync(path.join(root,'android/app/src/main/assets/agent/native-view-declarations.json'),nativeViewDeclarationsJson);
execFileSync(process.execPath,[path.join(root,'scripts/stage-workflow-worker.ts')],{cwd:root,env:process.env,stdio:'inherit'});
// The one runtime profile: every staged runtime keeps its local embedding model.
fs.writeFileSync(path.join(root,'android/app/src/main/assets/agent/alpha-runtime-profile.json'),JSON.stringify({version:1,runtimeProfile:'native'},null,2)+'\n');
console.log(`Android runtime payload staged for ${selection.targetAbis} with ${selection.bunTarget}. This is not device execution evidence.`);

}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))stageLocalAgentRuntime();
