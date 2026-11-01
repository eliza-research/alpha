import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {preparePrivateRuntimeProfile,runtimeEnvironment,startPrivateRuntimeProcess} from '../vendor/eliza/packages/agent/native-host/private-runtime-launch.mjs';
import {verifySource,preparedSourceEnv,workerArtifactDirectory,digest} from './local-agent-source.mjs';
import {verifyWorkerArtifact} from './workflow-worker-artifact.mjs';
import {verifyNativeGoogleHostArtifact} from './native-google-host-artifact.mjs';
import {nativeViewDeclarationsJson} from './native-view-policy.mjs';
import {CLOUD_SDK_BASES} from './cloud-sdk-authority.mjs';
export const CLOUD_MODEL='cerebras/qwen-3.8-27b';
/** Host-owned process. No provider key is written to configuration or returned to the renderer. */
export async function createCloudResidentHost({source,profile,port,environment='production',profileMode='lean',launch=startPrivateRuntimeProcess,inherited=process.env,request=fetch,startGoogleHost}){
 if(!['production','staging'].includes(environment))throw Error('Invalid Cloud environment');
 if(profileMode!=='lean'&&profileMode!=='full')throw Error('Invalid Cloud resident profile mode');
 const root=path.resolve(import.meta.dirname,'..');
 const commit=JSON.parse(fs.readFileSync(path.join(root,'upstream.lock.json'),'utf8')).commit;
 verifySource(source,commit);
 // The product declaration comes only from the current verified worker module,
 // independent of provider credentials. No inherited module path or character JSON.
 const worker=workerArtifactDirectory(root,inherited);
 verifyWorkerArtifact(worker,{sourceStampSha256:digest(path.join(source,'.alpha-runtime-source.json')),lockSha256:digest(path.join(source,'bun.lock'))});
 verifyNativeGoogleHostArtifact(root,worker);
 const nativeHostEnvironment={ELIZA_SMTHRS_RUNTIME_DIR:worker,ELIZA_NATIVE_GOOGLE_HOST_MODULE:path.join(worker,'google-host.mjs')};
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid resident port');
 fs.mkdirSync(profile,{recursive:true,mode:0o700});
 const st=fs.lstatSync(profile);if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)||st.uid!==process.getuid?.())throw Error('Private resident directory required');
 const tokenPath=path.join(profile,'owner-token'),configPath=path.join(profile,'eliza.json');
 const privateProfile=await preparePrivateRuntimeProfile({tokenPath,configPath,createToken:()=>randomBytes(32).toString('hex'),initialConfig:{cloud:{enabled:true},serviceRouting:{llmText:{backend:'elizacloud',transport:'cloud-proxy',smallModel:CLOUD_MODEL,largeModel:CLOUD_MODEL},embeddings:{backend:'elizacloud',transport:'cloud-proxy'}},plugins:{entries:{'personal-assistant':{enabled:profileMode==='full'}}}}});
 const route=privateProfile.config.serviceRouting?.llmText;
 if(route?.backend!=='elizacloud'||route?.transport!=='cloud-proxy'||privateProfile.config.cloud?.enabled!==true||privateProfile.config.cloud?.apiKey)throw Error('Select a separate Cloud-only resident profile');
 // A full host must not silently reverse a saved assistant opt-out.
 if(profileMode==='full'&&privateProfile.config.plugins?.entries?.['personal-assistant']?.enabled!==true)throw Error('Full Cloud profile requires personal-assistant explicitly enabled');
 // Headless Linux has no OS keychain. Keep its supported vault passphrase in this private host profile.
 const vaultPath=path.join(profile,'vault-passphrase');
 try{const fd=fs.openSync(vaultPath,'wx',0o600);try{fs.writeFileSync(fd,randomBytes(32).toString('hex'));}finally{fs.closeSync(fd);}}catch(error){if(error.code!=='EEXIST')throw error;}
 const vaultFd=fs.openSync(vaultPath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);let vaultPassphrase;
 try{const stat=fs.fstatSync(vaultFd);if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o077)||stat.uid!==process.getuid?.()||stat.size!==64)throw Error('Private vault passphrase required');vaultPassphrase=fs.readFileSync(vaultFd,'utf8');if(!/^[a-f0-9]{64}$/.test(vaultPassphrase))throw Error('Invalid vault passphrase');}finally{fs.closeSync(vaultFd);}
 let googleHost=null,running=null,bound=null,queue=Promise.resolve(),expiry,closed=false,retiring=false;
 const serial=run=>{const next=queue.then(run,run);queue=next.catch(()=>{});return next;};
 async function stop(){
  clearTimeout(expiry);retiring=true;const old=running,oldGoogle=googleHost,failures=[];
  // Revoke the read broker even when child retirement fails. Never let an old
  // binding resolve a replacement account through the shared host port.
  if(oldGoogle)try{await oldGoogle.close();if(googleHost===oldGoogle)googleHost=null;}catch(error){failures.push(error);}
  if(old)try{await old.stop();if(running===old){running=null;bound=null;}}catch(error){failures.push(error);}
  if(failures.length)throw new AggregateError(failures,'Resident retirement could not be confirmed');
  retiring=false;
 }
 async function replace(credential){
  if(closed)throw Error('Cloud resident host closed');
  if(!retiring&&running&&bound?.credentialId===credential?.credentialId&&bound?.reference===credential?.reference&&bound?.expiresAt===credential?.expiresAt)return status(credential?.credentialId);
  await stop();
  if(credential&&(!credential.token||typeof credential.token!=='string'||!credential.credentialId||credential.expiresAt!==undefined&&(!Number.isFinite(credential.expiresAt)||credential.expiresAt<=Date.now())))throw Error('Invalid Cloud resident binding');
  const settings={...(environment==='staging'?{ELIZA_DEV_SOURCE:'1',ELIZA_DEV_CLOUD_ENV_AUTHORITY:'staging-explicit'}:{}),ELIZA_VAULT_PASSPHRASE:vaultPassphrase,ELIZAOS_CLOUD_USE_INFERENCE:credential?'true':'false',ELIZAOS_CLOUD_USE_EMBEDDINGS:credential?'true':'false',ELIZA_DISABLE_LOCAL_EMBEDDINGS:'true',ELIZA_LOCAL_EMBEDDING_ENABLED:'0',ELIZA_ASR_ENABLED:'0',ELIZA_PARADEE_ENABLED:'0',...(credential?{ELIZAOS_CLOUD_API_KEY:credential.token,ELIZAOS_CLOUD_BASE_URL:CLOUD_SDK_BASES[environment],ELIZAOS_CLOUD_SMALL_MODEL:CLOUD_MODEL,ELIZAOS_CLOUD_LARGE_MODEL:CLOUD_MODEL,ELIZAOS_CLOUD_EMBEDDING_MODEL:'bge-small-en-v1.5',ELIZAOS_CLOUD_EMBEDDING_DIMENSIONS:'384'}:{})};
  googleHost=credential&&startGoogleHost?await startGoogleHost(privateProfile.token,{credentialId:credential.credentialId,reference:credential.reference}):null;
  let log;
  try{
  if(googleHost&&(!Number.isInteger(googleHost.port)||googleHost.port<1024||googleHost.port>65535||typeof googleHost.close!=='function'))throw Error('Invalid private Google host');
  const env=runtimeEnvironment({inherited:preparedSourceEnv(inherited),allow:['PATH','TMPDIR','LANG','SHELL','USER','LOGNAME','HOME'],settings,owned:{...nativeHostEnvironment,ELIZA_MANAGED_CALENDAR_READ_BROKER:googleHost?`http://127.0.0.1:${googleHost.port}/__alpha-owner-gmail`:'',ELIZA_HEADLESS:'1',ELIZA_DISTRIBUTION_PROFILE:'store',...(profileMode==='lean'?{ELIZA_PLUGIN_SET:'lean-chat',ELIZA_LEAN_CHAT_WORKFLOWS:'1'}:{}),ELIZA_REQUIRE_LOCAL_AUTH:'1',ELIZA_API_BIND:'127.0.0.1',ELIZA_API_PORT:String(port),ELIZA_API_EXPOSE_PORT:'1',ELIZA_STATE_DIR:profile,ELIZA_CONFIG_PATH:configPath,ELIZA_API_TOKEN:privateProfile.token,ELIZA_HOST_CONTEXT_REVISION:'cloud:'+randomUUID(),ELIZA_NATIVE_VIEW_DECLARATIONS:nativeViewDeclarationsJson}});
  log=fs.openSync(path.join(profile,'server.log'),fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW,0o600);fs.fchmodSync(log,0o600);
  running=await launch({command:inherited.ALPHA_BUN||'bun',args:['--no-install','--conditions=eliza-source',path.join(source,'packages/app/src/runtime/dev-server.ts')],cwd:profile,env,stdio:['ignore',log,log]});
  }catch(error){const failedGoogle=googleHost;if(failedGoogle){try{await failedGoogle.close();if(googleHost===failedGoogle)googleHost=null;}catch(cleanup){retiring=true;throw new AggregateError([error,cleanup],'Resident startup and private Google cleanup failed');}}throw error;}finally{if(log!==undefined)fs.closeSync(log);}

  const current=running;bound=credential?{credentialId:credential.credentialId,reference:credential.reference,expiresAt:credential.expiresAt}:null;
  const finished=()=>serial(async()=>{if(running!==current)return;retiring=true;running=null;bound=null;clearTimeout(expiry);const endedGoogle=googleHost;if(endedGoogle)await endedGoogle.close();if(googleHost===endedGoogle)googleHost=null;retiring=false;});
  void current.completion.then(finished,finished).catch(()=>{retiring=true;});
  if(credential?.expiresAt){const expire=()=>{const remaining=credential.expiresAt-Date.now();if(remaining<=0){void serial(()=>replace(null));return;}expiry=setTimeout(expire,Math.min(remaining,2147483647));};expire();}
  return status(credential?.credentialId);
 }
 function status(id){return {provider:'elizacloud',configured:!!running&&!!bound,model:CLOUD_MODEL,attachable:!retiring&&!!running&&!!bound&&bound.credentialId===id};}
 async function ready(signal){
  if(retiring)throw Error('Resident retirement unconfirmed');
  if(!running)await serial(()=>{if(!running)return replace(null);});
  const current=running,deadline=Date.now()+110000;
  while(Date.now()<deadline){signal.throwIfAborted();if(running!==current)throw Error('Resident changed during startup');
   try{const response=await request(`http://127.0.0.1:${port}/api/agents`,{headers:{Authorization:'Bearer '+privateProfile.token},redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(2000)])});if(response.ok){const value=await response.json();signal.throwIfAborted();if(running!==current||retiring)throw Error('Resident changed during startup');if(Array.isArray(value.agents)&&value.agents.length===1&&value.agents[0]?.status==='running')return {state:'host-managed'};}else await response.body?.cancel();}catch(error){signal.throwIfAborted();}
   await new Promise(resolve=>setTimeout(resolve,300));
  }throw Error('Cloud resident startup timed out');
 }
 return {bind:credential=>serial(()=>replace(credential)),clear:()=>serial(()=>replace(null)),status,ready,close:()=>serial(async()=>{closed=true;await stop();})};
}
