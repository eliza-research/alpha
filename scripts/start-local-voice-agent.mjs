#!/usr/bin/env node
// Runs the patched upstream host with explicit local voice assets in an isolated profile.
import {admitSpeech} from './host-speech-admission.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {AGENT_MODEL,agentModelEnvironment} from './agent-model.mjs';
import {AGENT_CHARACTER_ENVIRONMENT,freshAgentProfile,prepareAgentIdentityConfig} from './agent-identity.mjs';
import {LOCAL_EMBEDDING_ROUTE,localEmbeddingEnvironment,reportMissingEmbeddingRoute} from './agent-embeddings.mjs';
import {sourceDirectory} from './local-agent-source.mjs';
// Inputs are flags, not product-specific environment names. The default source is the
// prepared tree of the pinned commit (vendor/eliza itself has no installed dependencies and is
// never modified); --source selects another prepared tree of that commit.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {values:options} = parseArgs({options:{source:{type:'string'}, profile:{type:'string'}, port:{type:'string'}, bun:{type:'string'}}, strict:true});
const source = path.resolve(options.source || sourceDirectory(root));
if (!fs.existsSync(path.join(source,'node_modules'))) {
  console.error(`No installed runtime source at ${source}. Run \`npm run agent:prepare\` (creates artifacts/local-agent-resident-<commit> from the pinned commit), or pass --source with another prepared checkout of it. Never install into vendor/eliza.`);
  process.exit(2);
}
const profile = path.resolve(options.profile || path.join(os.homedir(), '.local/share/alphaphone/local-voice'));
const port = Number(options.port || 47844);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
const freshProfile=freshAgentProfile(profile);
const keyPath = path.join(os.homedir(), '.config/alphaphone/cerebras-key');
if ((fs.statSync(keyPath).mode & 0o077) !== 0) throw new Error('Provider key must be owner-only');
fs.mkdirSync(profile, {recursive:true, mode:0o700});
fs.chmodSync(profile, 0o700);
const tokenPath = path.join(profile, 'owner-token');
if (!fs.existsSync(tokenPath)) fs.writeFileSync(tokenPath, crypto.randomBytes(32).toString('hex'), {mode:0o600, flag:'wx'});
if ((fs.statSync(tokenPath).mode & 0o077) !== 0) throw new Error('Owner token must be owner-only');
const entry = path.join(source,'packages/app/src/runtime/dev-server.ts');
if (!fs.existsSync(entry)) throw new Error('Eliza app host source is missing');
const config = path.join(profile,'eliza.json');
if (!fs.existsSync(config)) fs.writeFileSync(config, JSON.stringify({cloud:{enabled:false}, serviceRouting:{llmText:{backend:'cerebras',transport:'direct',smallModel:AGENT_MODEL,largeModel:AGENT_MODEL},embeddings:{...LOCAL_EMBEDDING_ROUTE}},plugins:{entries:{scheduling:{enabled:false},'personal-assistant':{enabled:false}}}})+'\n', {mode:0o600, flag:'wx'});
const savedConfig=await prepareAgentIdentityConfig(config,JSON.parse(fs.readFileSync(config,'utf8')),{freshProfile}), modelEnvironment=agentModelEnvironment(savedConfig);
reportMissingEmbeddingRoute(savedConfig,config);
const log = fs.openSync(path.join(profile,'server.log'), 'a', 0o600);
fs.fchmodSync(log, 0o600);
const baseEnv = Object.fromEntries(['PATH','TMPDIR','LANG','SHELL','USER','LOGNAME','HOME'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
const env = {...baseEnv, ...AGENT_CHARACTER_ENVIRONMENT, ELIZA_HEADLESS:'1', ELIZA_API_BIND:'127.0.0.1', ELIZA_ALLOWED_HOSTS:'10.0.2.2', ELIZA_API_PORT:String(port), ELIZA_API_EXPOSE_PORT:'1', ELIZA_STATE_DIR:profile, ELIZA_CONFIG_PATH:config, ELIZA_API_TOKEN:fs.readFileSync(tokenPath,'utf8').trim(), CEREBRAS_API_KEY:fs.readFileSync(keyPath,'utf8').trim(), ...modelEnvironment, ELIZAOS_CLOUD_USE_INFERENCE:'false'};
Object.assign(env, admitSpeech('tts'));
if(process.env.ELIZA_ASR_ENABLED==='1')Object.assign(env,admitSpeech('asr'));
Object.assign(env, localEmbeddingEnvironment({...process.env,...env}));
for (const key of ['ELIZAOS_CLOUD_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY']) delete env[key];
const child = spawn(options.bun || 'bun', ['--conditions=eliza-source', entry], {cwd:profile, env, stdio:['ignore',log,log]});
const metadata = {pid:child.pid, port, profile, source, revision:execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(), startedAt:new Date().toISOString()};
fs.writeFileSync(path.join(profile,'process.json'), JSON.stringify(metadata,null,2), {mode:0o600});
console.log(JSON.stringify({...metadata, log:path.join(profile,'server.log')}));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
