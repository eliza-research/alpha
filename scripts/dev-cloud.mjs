#!/usr/bin/env node
/** Real loopback resident + production Cloud services, with simulated surfaces disabled. */
import {spawn,execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve,join} from 'node:path';
import {createServer} from 'node:net';
import {sourceDirectory} from './local-agent-source.mjs';
import {prepareClientFeatures} from './prepare-client-features.mjs';
prepareClientFeatures();
const root=resolve(import.meta.dirname,'..');
const source=process.env.ALPHA_ELIZA_SOURCE?resolve(process.env.ALPHA_ELIZA_SOURCE):sourceDirectory(root);
if(!process.env.ALPHA_ELIZA_SOURCE)execFileSync(process.execPath,['scripts/prepare-local-agent.mjs'],{stdio:'inherit'});
if(!existsSync(join(source,'node_modules')))throw Error('Prepare the pinned runtime dependencies first');
const environment=process.env.ALPHA_CLOUD_ENVIRONMENT||'production';
if(!['production','staging'].includes(environment))throw Error('Invalid Cloud environment');
const profileMode=process.env.ALPHA_CLOUD_RESIDENT_PROFILE??'lean';
if(profileMode!=='lean'&&profileMode!=='full')throw Error('Invalid Cloud resident profile mode');
const profile=resolve(process.env.ALPHA_REMOTE_PROFILE||join(homedir(),'.local/share/alphaphone/cloud-resident-'+environment));
const cloudProfile=resolve(process.env.ALPHA_BROWSER_CLOUD_PROFILE||join(homedir(),'.local/share/alphaphone/cloud-resident-account-'+environment));
const port=Number(process.env.ALPHA_REMOTE_PORT||47859),uiPort=Number(process.env.ALPHA_CLOUD_UI_PORT||5318);
for(const selected of [port,uiPort]){if(!Number.isInteger(selected)||selected<1024||selected>65535)throw Error('Invalid Cloud development port');await new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(selected,'127.0.0.1',()=>server.close(resolve));});}
const env={...process.env,ELIZA_DEV_ALLOW_TEST_MOCKS:'',VITE_ELIZA_DEV_ALLOW_TEST_MOCKS:'',VITE_ALPHA_CLOUD_RESIDENT:'1',VITE_ALPHA_CLOUD_ENVIRONMENT:environment,ALPHA_CLOUD_RESIDENT_PROFILE:profileMode,VITE_LOCAL_AGENT:'1',VITE_ELIZA_RUNTIME_PROFILE:'cloud',ALPHA_REMOTE_PROFILE:profile,ALPHA_BROWSER_CLOUD_PROFILE:cloudProfile,ALPHA_REMOTE_PORT:String(port),ALPHA_ELIZA_SOURCE:source,ALPHA_LOCAL_AGENT_ORIGIN:`http://127.0.0.1:${port}`,ALPHA_LOCAL_AGENT_TOKEN_FILE:join(profile,'owner-token')};
// Inherited provider/developer flags cannot change this launch's authority.
for(const key of Object.keys(env))if(/^(?:CEREBRAS_|OPENAI_|ANTHROPIC_|ELIZAOS_CLOUD_|ALPHA_DEV_|VITE_ALPHA_DEV_)/.test(key))delete env[key];
// Batch speech uses this resident's selected Cloud account, never an inherited direct key.
env.ALPHA_DEV_CLOUD_VOICE='1';
const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(uiPort),'--strictPort'],{cwd:root,env,stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('error',()=>{console.error('Cloud development server failed');process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
console.log(`Cloud ${environment} resident preview: http://127.0.0.1:${uiPort}; sign in through Alpha. No direct-provider key or mock runtime is used.`);
