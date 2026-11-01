import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifySource,preparedSourceEnv,workerArtifactDirectory,digest} from '../../scripts/local-agent-source.mjs';
import {verifyWorkerArtifact} from '../../scripts/workflow-worker-artifact.mjs';
import {preparePrivateRuntimeProfile,runtimeEnvironment} from '../../vendor/eliza/packages/agent/native-host/private-runtime-launch.mjs';
import {CLOUD_SDK_BASES} from '../../scripts/cloud-sdk-authority.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
// Real host function and admission helpers; only its product-root location and
// process launch port are fixture-owned. No verifier is mocked or disabled.
const nativeSource=fs.readFileSync('scripts/native-google-host-artifact.mjs','utf8');
const verification=nativeSource.slice(nativeSource.indexOf('const hash='),nativeSource.indexOf('/** Product host code'));
const {verifyNativeGoogleHostArtifact}=vm.runInNewContext(verification.replace('export function','function')+';({verifyNativeGoogleHostArtifact});',{fs,path,createHash});
const source=fs.readFileSync('scripts/cloud-resident-host.mjs','utf8').replace(/^import .*;\n/gm,'').replaceAll('import.meta.dirname','scriptDirectory').replace(/^export /gm,'');
export function productCharacterHostFixture(mode,options={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'product-character-host-')),sdk=path.join(root,'sdk'),profile=path.join(root,'profile'),worker=path.join(root,'artifacts','fixture-worker');
 fs.mkdirSync(sdk,{recursive:true});fs.writeFileSync(path.join(sdk,'bun.lock'),'{}');fs.writeFileSync(path.join(sdk,'package.json'),JSON.stringify({name:'fixture',workspaces:[]}));fs.writeFileSync(path.join(sdk,'turbo.json'),JSON.stringify({tasks:{}}));
 const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
 execFileSync('git',['-c','core.hooksPath=/dev/null','init','-q',sdk],{env});execFileSync('git',['-C',sdk,'-c','core.hooksPath=/dev/null','add','bun.lock','package.json','turbo.json'],{env});execFileSync('git',['-C',sdk,'-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','fixture'],{env});
 const commit=execFileSync('git',['-C',sdk,'rev-parse','HEAD'],{encoding:'utf8',env}).trim();fs.writeFileSync(path.join(sdk,'.alpha-runtime-source.json'),'{}');fs.writeFileSync(path.join(root,'upstream.lock.json'),JSON.stringify({commit}));
 fs.mkdirSync(path.join(root,'backend'));const input='backend/native-cloud-runtime.ts';fs.writeFileSync(path.join(root,input),'synthetic product source');
 fs.mkdirSync(worker,{recursive:true});const entries=['dependencies.json','node_modules/smthrs/package.json','node_modules/zod/package.json','node_modules/effect/package.json','node_modules/@smthrs/engine/package.json','google-host.mjs'];const files={};
 for(const name of entries){const file=path.join(worker,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,name==='google-host.mjs'?'export const nativeCloudRuntime={productCharacter:{name:"Fixture"}};':'{}');files[name]=hash(fs.readFileSync(file));}
 fs.writeFileSync(path.join(worker,'manifest.json'),JSON.stringify({version:1,sourceStampSha256:hash(fs.readFileSync(path.join(sdk,'.alpha-runtime-source.json'))),lockSha256:hash(fs.readFileSync(path.join(sdk,'bun.lock'))),files,nativeGoogleHost:{version:1,module:'google-host.mjs',bunVersion:'1.4.2',inputs:{[input]:hash(fs.readFileSync(path.join(root,input)))}}}));
 verifySource(sdk,commit);verifyWorkerArtifact(worker,{sourceStampSha256:hash(fs.readFileSync(path.join(sdk,'.alpha-runtime-source.json'))),lockSha256:hash(fs.readFileSync(path.join(sdk,'bun.lock')))});verifyNativeGoogleHostArtifact(root,worker);
 if(mode==='module-missing')fs.unlinkSync(path.join(worker,'google-host.mjs'));
 if(mode==='module-changed')fs.appendFileSync(path.join(worker,'google-host.mjs'),'changed');
 if(mode==='input-changed')fs.appendFileSync(path.join(root,input),'changed');
 if(mode==='manifest-changed'){const manifest=JSON.parse(fs.readFileSync(path.join(worker,'manifest.json')));manifest.sourceStampSha256='0'.repeat(64);fs.writeFileSync(path.join(worker,'manifest.json'),JSON.stringify(manifest));}
 if(mode==='symlink'){fs.renameSync(worker,worker+'-real');fs.symlinkSync(worker+'-real',worker);}
 const globals={fs,path,randomUUID,randomBytes,preparePrivateRuntimeProfile,runtimeEnvironment,verifySource,preparedSourceEnv,workerArtifactDirectory,digest,verifyWorkerArtifact,verifyNativeGoogleHostArtifact,CLOUD_SDK_BASES,nativeViewDeclarationsJson:'[]',scriptDirectory:path.join(root,'scripts'),process,fetch,AbortSignal,setTimeout,clearTimeout};
 vm.runInNewContext(source+';globalThis.make=createCloudResidentHost;',globals);
 const launches=[];const launch=async options=>{launches.push(options);let done;return {completion:new Promise(resolve=>done=resolve),async stop(){done({code:0});}};};
 return {root,sdk,worker,profile,launches,async make(){return globals.make({...options,source:sdk,profile:options.profile??profile,port:options.port??47869,launch:options.launch??launch,inherited:{...options.inherited,PATH:process.env.PATH,ALPHA_WORKFLOW_WORKER_OUTPUT:worker,ELIZA_NATIVE_GOOGLE_HOST_MODULE:'/untrusted/module',ELIZA_SMTHRS_RUNTIME_DIR:'/untrusted/root',ELIZA_AGENT_CHARACTER_JSON:'untrusted',CEREBRAS_API_KEY:'untrusted'}});},close(){fs.rmSync(root,{recursive:true,force:true});}};
}

export async function createCloudResidentHost(options){
 const fixture=productCharacterHostFixture(undefined,options);
 try{const host=await fixture.make();return {...host,async close(){try{await host.close();}finally{fixture.close();}}};}
 catch(error){fixture.close();throw error;}
}
