#!/usr/bin/env node
import {coreRuntimeArguments} from './core-state-patch.ts';
/** Isolated development-only Cloud inference QA. Never used by the phone build or 5209. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {sourceDirectory} from './local-agent-source.ts';
import {preparePrivateRuntimeProfile,runtimeEnvironment as upstreamRuntimeEnvironment,startPrivateRuntimeProcess as upstreamStartPrivateRuntimeProcess,writePrivateRuntimeJson} from '../vendor/eliza/packages/agent/native-host/private-runtime-launch.mjs';
import type {RuntimeEnvironment,PrivateRuntimeLauncher,PrivateRuntimeProcess} from './private-runtime-types.ts';
const runtimeEnvironment=upstreamRuntimeEnvironment as RuntimeEnvironment;
const startPrivateRuntimeProcess=upstreamStartPrivateRuntimeProcess as unknown as PrivateRuntimeLauncher;
import {nativeViewDeclarationsJson} from './native-view-policy.ts';
import {CLOUD_SDK_BASES} from './cloud-sdk-authority.ts';
const HERE=path.dirname(fileURLToPath(import.meta.url));
export function cloudQaConfiguration(env: any=process.env){
 const profile=env.ALPHA_QA_PROFILE,keyFile=env.ALPHA_QA_CLOUD_KEY_FILE,port=Number(env.ALPHA_QA_PORT);
 if(!profile||!path.isAbsolute(profile)||!keyFile||!path.isAbsolute(keyFile))throw Error('Provide absolute ALPHA_QA_PROFILE and ALPHA_QA_CLOUD_KEY_FILE paths for an isolated staging QA profile.');
 if(!Number.isSafeInteger(port)||port<1024||port>65535||[47839,47849,5203,5209].includes(port))throw Error('Choose a separate free ALPHA_QA_PORT; active preview/agent ports are protected.');
 for(let current=profile;current!==path.dirname(current);current=path.dirname(current))if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('QA profile must not traverse symlinks.');
 if(fs.existsSync(profile)){
  const marker=path.join(profile,'alpha-cloud-qa.json');
  if(!fs.existsSync(marker)||JSON.parse(fs.readFileSync(marker,'utf8')).purpose!=='isolated-staging-cloud-qa')throw Error('Refusing to reuse an existing non-QA profile.');
 }
 const st=fs.lstatSync(keyFile);
 if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o077))throw Error('Staging QA credential file must be a private owner-only regular file.');
 const key=fs.readFileSync(keyFile,'utf8').trim();if(key.length<16||key.length>8192||/[\r\n\0]/.test(key))throw Error('Staging QA credential is invalid.');
 const model=env.ALPHA_QA_MODEL;
 if(!model||!/^[a-zA-Z0-9._:/-]{1,200}$/.test(model))throw Error('Set ALPHA_QA_MODEL to the exact reviewed Cloud model; no default model substitution is allowed.');
 return {profile:path.resolve(profile),keyFile:path.resolve(keyFile),port,key,model,
  route:{backend:'elizacloud',transport:'cloud-proxy',accountId:'elizacloud',smallModel:model,largeModel:model},
  authority:{ELIZA_DEV_SOURCE:'1',ELIZA_DEV_CLOUD_ENV_AUTHORITY:'staging-explicit',ELIZAOS_CLOUD_BASE_URL:CLOUD_SDK_BASES.staging,ELIZAOS_CLOUD_API_KEY:key,ELIZAOS_CLOUD_USE_INFERENCE:'true'}};
}
async function main(){
 const root=path.resolve(HERE,'..');
 const qa=cloudQaConfiguration(),source=process.env.ALPHA_ELIZA_SOURCE?path.resolve(process.env.ALPHA_ELIZA_SOURCE):sourceDirectory(path.resolve(HERE,'..'));
 const entry=path.join(source,'packages/app/src/runtime/dev-server.ts');if(!fs.existsSync(entry))throw Error('Normal Eliza source entrypoint is missing.');
 fs.mkdirSync(qa.profile,{recursive:true,mode:0o700});fs.chmodSync(qa.profile,0o700);
 const marker=path.join(qa.profile,'alpha-cloud-qa.json');
 if(!fs.existsSync(marker))fs.writeFileSync(marker,JSON.stringify({purpose:'isolated-staging-cloud-qa',environment:'staging'},null,2)+'\n',{mode:0o600});
 const configPath=path.join(qa.profile,'eliza.json'),privateProfile=await preparePrivateRuntimeProfile({tokenPath:path.join(qa.profile,'owner-token'),configPath,createToken:()=>crypto.randomBytes(32).toString('hex'),initialConfig:{cloud:{enabled:true},serviceRouting:{llmText:qa.route},plugins:{entries:{'personal-assistant':{enabled:false}}}}});
 if(JSON.stringify(privateProfile.config.serviceRouting?.llmText)!==JSON.stringify(qa.route)||privateProfile.config.cloud?.enabled!==true)throw Error('QA profile routing differs from the requested staging Cloud route. Use a fresh profile or review its existing configuration.');
 const env=runtimeEnvironment({inherited:process.env,allow:['PATH','TMPDIR','LANG','SHELL','USER','LOGNAME','HOME'],settings:{},owned:{...qa.authority,ELIZA_HEADLESS:'1',ELIZA_DISTRIBUTION_PROFILE:'store',ELIZA_PLUGIN_SET:'lean-chat',ELIZA_REQUIRE_LOCAL_AUTH:'1',ELIZA_API_BIND:'127.0.0.1',ELIZA_API_PORT:String(qa.port),ELIZA_API_EXPOSE_PORT:'1',ELIZA_STATE_DIR:qa.profile,ELIZA_CONFIG_PATH:configPath,ELIZA_API_TOKEN:privateProfile.token,ELIZA_HOST_CONTEXT_REVISION:'cloud-qa:'+crypto.randomUUID(),ELIZA_NATIVE_VIEW_DECLARATIONS:nativeViewDeclarationsJson,ELIZA_NATIVE_BROWSER_COMMANDS:'back,forward,reload',ELIZA_BROWSER_NATIVE_TARGET:'off'},remove:['CEREBRAS_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY']});
 const {O_WRONLY,O_APPEND,O_CREAT,O_NOFOLLOW,O_NONBLOCK}=fs.constants;
 const log=fs.openSync(path.join(qa.profile,'server.log'),O_WRONLY|O_APPEND|O_CREAT|O_NOFOLLOW|O_NONBLOCK,0o600);
 try{
  const stat=fs.fstatSync(log);
  if(!stat.isFile()||stat.nlink!==1)throw Error('QA log must be a single-link regular file.');
  fs.fchmodSync(log,0o600);
  const running=await startPrivateRuntimeProcess({command:process.env.ALPHA_BUN||'bun',args:coreRuntimeArguments(root,source,['--no-install','--conditions=eliza-source',entry]),cwd:qa.profile,env:{...env,ALPHA_CORE_STATE_SOURCE:source},stdio:['ignore',log,log],async recordLaunch({pid,launchedAt}: any){
  const receipt={purpose:'isolated-staging-cloud-qa',pid,port:qa.port,profile:qa.profile,source,revision:execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),route:qa.route,environment:'staging',apiBase:CLOUD_SDK_BASES.staging,credentialLocation:'server-side owner-only file',identityVerified:false,modelCallsPerformedByLauncher:0,startedAt:new Date(launchedAt).toISOString()};
  await writePrivateRuntimeJson(path.join(qa.profile,'process.json'),receipt);console.log(JSON.stringify(receipt));
 }});const result=await running.completion;if(result.error)console.error(result.error.message);process.exitCode=result.error?1:result.code??1;}finally{fs.closeSync(log);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch((error: any)=>{console.error(error.message);process.exitCode=1;});
