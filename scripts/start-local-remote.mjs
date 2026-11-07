#!/usr/bin/env node
import {sourceDirectory, verifySource} from './local-agent-source.mjs';
// Runs the real, unmodified Eliza app host with an isolated private profile.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {preparePrivateRuntimeProfile,runtimeEnvironment,startPrivateRuntimeProcess,writePrivateRuntimeJson} from '../vendor/eliza/packages/agent/native-host/private-runtime-launch.mjs';
import {AGENT_MODEL,agentModelEnvironment} from './agent-model.mjs';
import {AGENT_CHARACTER_ENVIRONMENT,freshAgentProfile,prepareAgentIdentityConfig} from './agent-identity.mjs';
import {LOCAL_EMBEDDING_ROUTE,localEmbeddingEnvironment,reportMissingEmbeddingRoute} from './agent-embeddings.mjs';
import {agentTtsEnvironment} from './agent-tts.mjs';
import {developmentCartesiaEnvironment} from './dev-cartesia.mjs';
import {agentAsrEnvironment} from './agent-asr.mjs';
import {nativeViewDeclarationsJson} from './native-view-policy.mjs';
const source = process.env.ALPHA_ELIZA_SOURCE ? path.resolve(process.env.ALPHA_ELIZA_SOURCE) : sourceDirectory(path.resolve(import.meta.dirname,'..'));
// Upstream's own swap switches. Only both together are qualified, and only on verified pinned source.
const swapFlags = ['ELIZA_SECRET_SWAP_ENABLED', 'ELIZA_PII_SWAP_ENABLED'].map(key => process.env[key]);
for (const value of swapFlags) if (value !== undefined && !['true', 'false'].includes(value)) throw new Error('ELIZA_SECRET_SWAP_ENABLED and ELIZA_PII_SWAP_ENABLED must be true or false');
if ((swapFlags[0] === 'true') !== (swapFlags[1] === 'true')) throw new Error('Set ELIZA_SECRET_SWAP_ENABLED and ELIZA_PII_SWAP_ENABLED together');
const redaction = swapFlags[0] === 'true' ? 'all' : 'off';
if (redaction === 'all') {
  const lock=JSON.parse(fs.readFileSync(new URL('../upstream.lock.json',import.meta.url),'utf8'));
  verifySource(source,lock.commit);
}
const profile = path.resolve(process.env.ALPHA_REMOTE_PROFILE || path.join(os.homedir(), '.local/share/alphaphone/local-remote'));
const port = Number(process.env.ALPHA_REMOTE_PORT || 47839);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
const freshProfile=freshAgentProfile(profile);
const keyPath = path.join(os.homedir(), '.config/alphaphone/cerebras-key');
let providerKey = process.env.CEREBRAS_API_KEY;
if (!providerKey && fs.existsSync(keyPath)) { if ((fs.statSync(keyPath).mode & 0o077) !== 0) throw new Error('Provider key must be owner-only'); providerKey=fs.readFileSync(keyPath,'utf8').trim(); }
if (!providerKey) throw new Error('Configure CEREBRAS_API_KEY or the private Cerebras key file.');
fs.mkdirSync(profile, {recursive:true, mode:0o700});
fs.chmodSync(profile, 0o700);
const tokenPath = path.join(profile, 'owner-token');
if (fs.existsSync(tokenPath) && (fs.statSync(tokenPath).mode & 0o077) !== 0) throw new Error('Owner token must be owner-only');
const entry = path.join(source,'packages/app/src/runtime/dev-server.ts');
if (!fs.existsSync(entry)) throw new Error('Eliza app host source is missing');
const config = path.join(profile,'eliza.json');
const privateProfile=await preparePrivateRuntimeProfile({tokenPath,configPath:config,
 createToken:()=>crypto.randomBytes(32).toString('hex'),
 initialConfig:{cloud:{enabled:false},serviceRouting:{llmText:{backend:'cerebras',transport:'direct',smallModel:AGENT_MODEL,largeModel:AGENT_MODEL},embeddings:{...LOCAL_EMBEDDING_ROUTE}},plugins:{entries:{'personal-assistant':{enabled:false}}}},
});
const savedConfig=await prepareAgentIdentityConfig(config,privateProfile.config,{freshProfile});
const modelEnvironment=agentModelEnvironment(savedConfig);
reportMissingEmbeddingRoute(savedConfig,config);
if(!/^[a-f0-9]{64}$/.test(privateProfile.token))throw Error('Invalid owner token');
const asrEnvironment = agentAsrEnvironment();
const ttsEnvironment = agentTtsEnvironment();
const cartesiaEnvironment = developmentCartesiaEnvironment();
if ((asrEnvironment.ELIZA_ASR_ENABLED === '1' || ttsEnvironment.ELIZA_PARADEE_ENABLED === '1') && redaction !== 'all') {
  const lock=JSON.parse(fs.readFileSync(new URL('../upstream.lock.json',import.meta.url),'utf8'));
  verifySource(source,lock.commit);
}
const env=runtimeEnvironment({
 inherited:process.env,allow:['PATH','TMPDIR','LANG','SHELL','USER','LOGNAME','HOME','ELIZA_PGLITE_AUTO_RESET'],
 settings:{CEREBRAS_API_KEY:providerKey,...modelEnvironment,...localEmbeddingEnvironment({...process.env,...asrEnvironment,...ttsEnvironment}),...asrEnvironment,...ttsEnvironment,...cartesiaEnvironment,...(redaction==='all'?{ELIZA_SECRET_SWAP_ENABLED:'true',ELIZA_PII_SWAP_ENABLED:'true'}:{})},
 owned:{...AGENT_CHARACTER_ENVIRONMENT,ELIZA_HEADLESS:'1',ELIZA_DISTRIBUTION_PROFILE:'store',ELIZA_PLUGIN_SET:'lean-chat',ELIZA_REQUIRE_LOCAL_AUTH:'1',ELIZA_API_BIND:'127.0.0.1',ELIZA_ALLOWED_HOSTS:'10.0.2.2',ELIZA_API_PORT:String(port),ELIZA_API_EXPOSE_PORT:'1',ELIZA_STATE_DIR:profile,ELIZA_HOST_CONTEXT_REVISION:'boot:'+crypto.randomUUID(),ELIZA_CONFIG_PATH:config,ELIZA_API_TOKEN:privateProfile.token,ELIZAOS_CLOUD_USE_INFERENCE:'false',ELIZA_LEAN_CHAT_WORKFLOWS:'1',ELIZA_NATIVE_VIEW_DECLARATIONS:nativeViewDeclarationsJson,...(process.env.ALPHA_BROWSER_GMAIL_READ_BROKER?{ELIZA_MANAGED_GMAIL_READ_BROKER:process.env.ALPHA_BROWSER_GMAIL_READ_BROKER,ELIZA_MANAGED_GMAIL_SEND_BROKER:process.env.ALPHA_BROWSER_GMAIL_READ_BROKER,ELIZA_MANAGED_GMAIL_OPERATION_BROKER:process.env.ALPHA_BROWSER_GMAIL_READ_BROKER,ELIZA_MANAGED_CALENDAR_READ_BROKER:process.env.ALPHA_BROWSER_GMAIL_READ_BROKER}:{})},
 remove:['ELIZAOS_CLOUD_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY'],
});
const log=fs.openSync(path.join(profile,'server.log'),'a',0o600);
try {
 fs.fchmodSync(log,0o600);
 // The profile cwd cannot supply the workspace source condition.
 const running=await startPrivateRuntimeProcess({command:process.env.ALPHA_BUN||'bun',args:['--no-install','--conditions=eliza-source',entry],cwd:profile,env,stdio:['ignore',log,log],
  async recordLaunch({pid,launchedAt}){
   const sourceManifest=path.join(source,'.alpha-runtime-source.json');
   const metadata={cartesiaConfigured:cartesiaEnvironment.ELIZA_SELF_HOSTED_VOICE_ENABLED==='1',localTtsConfigured:ttsEnvironment.ELIZA_PARADEE_ENABLED==='1',localAsrConfigured:asrEnvironment.ELIZA_ASR_ENABLED==='1',speechReadiness:'worker-initialization-required',egressRedactionRequested:redaction,sourceManifestSha256:fs.existsSync(sourceManifest)?crypto.createHash('sha256').update(fs.readFileSync(sourceManifest)).digest('hex'):null,pid,port,profile,source,revision:execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),startedAt:new Date(launchedAt).toISOString()};
   await writePrivateRuntimeJson(path.join(profile,'process.json'),metadata);
   console.log(JSON.stringify({...metadata,log:path.join(profile,'server.log')}));
  },
 });
 const result=await running.completion;
 if(result.error)console.error(result.error.message);
 process.exitCode=result.error?1:result.code??1;
}finally{fs.closeSync(log);}
