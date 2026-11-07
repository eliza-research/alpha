#!/usr/bin/env node
import {sourceDirectory} from './local-agent-source.mjs';
import {prepareClientFeatures} from './prepare-client-features.mjs';
import {developmentSpeechEnvironment} from './dev-speech-settings.mjs';
// Owns only the two processes it starts. Credentials stay in the host profile.
import {spawn,execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {readFileSync,existsSync} from 'node:fs';
import {createServer} from 'node:net';
// This launcher invokes Vite directly, so npm's predev hook does not run.
prepareClientFeatures();
const profile=resolve(process.env.ALPHA_REMOTE_PROFILE||join(homedir(),'.local/share/alphaphone/browser-agent'));
const configuredEnvironment=developmentSpeechEnvironment(profile);
const port=Number(process.env.ALPHA_REMOTE_PORT||47849);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local agent port');
const source=process.env.ALPHA_ELIZA_SOURCE?resolve(process.env.ALPHA_ELIZA_SOURCE):sourceDirectory(resolve(import.meta.dirname,'..'));
if(!process.env.ALPHA_ELIZA_SOURCE)execFileSync(process.execPath,['scripts/prepare-local-agent.mjs'],{stdio:'inherit'});
if(!existsSync(join(source,'node_modules')))throw Error('Install the pinned Eliza runtime dependencies in a prepared source checkout, then set ALPHA_ELIZA_SOURCE to that checkout. Do not edit vendor/eliza.');
await new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(port,'127.0.0.1',()=>server.close(resolve));});
const metadata=join(profile,'process.json');
if(existsSync(metadata)){
  const previous=JSON.parse(readFileSync(metadata,'utf8'));
  if(Number.isInteger(previous.pid))try{process.kill(previous.pid,0);throw Error('The selected local profile already has a live process. Use its existing session or a separate profile.');}catch(error){if(error.code!=='ESRCH')throw error;}
}
const viteArgs=process.argv.slice(2);
const portAt=viteArgs.findIndex(arg=>arg==='--port'||arg.startsWith('--port='));
const vitePort=portAt<0?5317:Number(viteArgs[portAt].includes('=')?viteArgs[portAt].split('=')[1]:viteArgs[portAt+1]);
if(!Number.isInteger(vitePort)||vitePort<1024||vitePort>65535)throw Error('Invalid preview port');
const env={...configuredEnvironment,ALPHA_REMOTE_PROFILE:profile,ALPHA_REMOTE_PORT:String(port),ALPHA_ELIZA_SOURCE:source,ALPHA_BROWSER_GMAIL_READ_BROKER:`http://127.0.0.1:${vitePort}/__alpha-owner-gmail`};
const children=new Set();let stopping=false;
function stop(signal='SIGTERM'){if(stopping)return;stopping=true;for(const child of children)child.kill(signal);}
function run(command,args,childEnv){const child=spawn(command,args,{stdio:'inherit',env:childEnv});children.add(child);child.on('error',error=>{console.error(error.message);process.exitCode=1;stop();});child.on('exit',code=>{children.delete(child);if(!stopping){process.exitCode=code||0;stop();}});return child;}
process.on('SIGINT',()=>stop('SIGINT'));process.on('SIGTERM',()=>stop());
run(process.execPath,['scripts/start-local-remote.mjs'],env);
// Development server: explicitly opts into test mocks and developer surfaces. Its connection
// sheet is the product one ("Alpha connection": connected, connecting or couldn't connect, Try
// again, conversation history) and startup attaches to the agent in the background, so loading
// the page while the agent restarts does not open the sheet. ALPHA_DEV_CONNECTION_TOOLS=1 restores
// the development connection sheet: ?mode=dev profiles, mock mode, subscription gate QA,
// development Cloud and pairing. build-flags.ts admits the flag on the development server only.
const developmentConnectionTools=env.ALPHA_DEV_CONNECTION_TOOLS==='1';
// Extra arguments (for example `npm run dev -- --port 5400`) go to Vite; the default port is 5317.
const portArgs=viteArgs.some(arg=>arg==='--port'||arg.startsWith('--port='))?[]:['--port','5317'];
console.log(`Starting the local agent on 127.0.0.1:${port} (profile ${profile}) and the development server.`);
console.log(developmentConnectionTools?'Connection sheet: development tools (ALPHA_DEV_CONNECTION_TOOLS=1).':'Connection sheet: Alpha connection. Set ALPHA_DEV_CONNECTION_TOOLS=1 for development profiles, mock mode and subscription gate QA.');
run(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1',...portArgs,'--strictPort',...viteArgs],{
  ...env,ELIZA_DEV_ALLOW_TEST_MOCKS:'1',VITE_LOCAL_AGENT:'1',VITE_ALPHA_PRIVATE_LOCAL_PREVIEW:developmentConnectionTools?'':'1',VITE_ALPHA_DEV_CARTESIA:env.ALPHA_DEV_CARTESIA==='1'?'1':'',ALPHA_LOCAL_AGENT_ORIGIN:`http://127.0.0.1:${port}`,ALPHA_LOCAL_AGENT_TOKEN_FILE:join(profile,'owner-token'),
});
