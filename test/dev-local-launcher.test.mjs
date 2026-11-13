// `bun run dev` (scripts/dev-local.ts) runs here with recording stand-ins for the local agent and
// Vite, so the exact environment each child receives is observed without starting either. The
// renderer flags are then read through the real build-flags.ts with that environment.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {loadConfigFromFile} from 'vite';
import {stripTypeScriptTypes} from './support/strip-types.mjs';

const stubs={
 'scripts/prepare-client-features.ts':'export function prepareClientFeatures(){}\n',
 'scripts/local-agent-source.ts':"export function sourceDirectory(){throw Error('ALPHA_ELIZA_SOURCE is set by the test');}\n",
 // Publish only complete JSON before Vite observes readiness and can stop this child. Self-exits on a failed run.
 'scripts/start-local-remote.ts':"import fs from 'node:fs';fs.writeFileSync('agent.json.tmp',JSON.stringify(process.env));fs.renameSync('agent.json.tmp','agent.json');setTimeout(()=>process.exit(0),20000);\n",
 'node_modules/vite/package.json':'{"type":"module"}\n',
 'node_modules/vite/bin/vite.js':"import fs from 'node:fs';const until=Date.now()+15000;while(!fs.existsSync('agent.json')&&Date.now()<until)await new Promise(r=>setTimeout(r,20));fs.writeFileSync('vite.json',JSON.stringify({argv:process.argv.slice(2),env:process.env}));\n",
};
const freePort=()=>new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const {port}=server.address();server.close(()=>resolve(port));});});
async function launch(overrides={}){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'alpha-dev-local-')));
 try{
  for(const file of ['scripts/dev-local.ts','scripts/dev-speech-settings.ts','scripts/speech-env.ts']){fs.mkdirSync(path.join(root,path.dirname(file)),{recursive:true});fs.copyFileSync(file,path.join(root,file));}
  for(const [file,text] of Object.entries(stubs)){fs.mkdirSync(path.join(root,path.dirname(file)),{recursive:true});fs.writeFileSync(path.join(root,file),text);}
  fs.mkdirSync(path.join(root,'source/node_modules'),{recursive:true});
  const env={...process.env,ALPHA_ELIZA_SOURCE:path.join(root,'source'),ALPHA_REMOTE_PROFILE:path.join(root,'profile'),ALPHA_REMOTE_PORT:String(await freePort()),...overrides};
  for(const key of ['NODE_TEST_CONTEXT',...['ALPHA_DEV_CONNECTION_TOOLS'].filter(key=>!Object.hasOwn(overrides,key))])delete env[key];
  const child=spawn(process.execPath,['scripts/dev-local.ts'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
  const timer=setTimeout(()=>child.kill('SIGTERM'),20000);
  const status=await new Promise(resolve=>child.on('close',resolve));clearTimeout(timer);
  assert.equal(status,0,stderr);
  return {stdout,agent:JSON.parse(fs.readFileSync(path.join(root,'agent.json'),'utf8')),vite:JSON.parse(fs.readFileSync(path.join(root,'vite.json'),'utf8'))};
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
const flags=stripTypeScriptTypes(fs.readFileSync('apps/app/src/build-flags.ts','utf8').replace(/^export /gm,'').replaceAll('import.meta.env','env'),{mode:'strip'});
/** import.meta.env as Vite derives it from the launched process environment, through the real vite.config.ts `define`. */
async function renderer(processEnv,DEV){
 const saved=process.env;process.env={...processEnv};
 let define;try{define=(await loadConfigFromFile({command:'serve',mode:'development'},path.resolve('vite.config.ts'))).config.define;}finally{process.env=saved;}
 const derived=Object.fromEntries(Object.entries(define).filter(([key])=>key.startsWith('import.meta.env.')).map(([key,value])=>[key.slice('import.meta.env.'.length),JSON.parse(value)]));
 const env={DEV,...Object.fromEntries(Object.entries(processEnv).filter(([key])=>key.startsWith('VITE_'))),...derived};
 return vm.runInNewContext(flags+'\n({testMocksEnabled,devSurfacesEnabled,privateLocalPreviewEnabled})',{env});
}

test('bun run dev opens the product connection sheet, on the development server only',async()=>{
 for(const tools of [undefined,'0','true']){
  const {stdout,vite}=await launch(tools===undefined?{}:{ALPHA_DEV_CONNECTION_TOOLS:tools});
  assert.equal(vite.env.VITE_LOCAL_AGENT,'1');assert.equal(vite.env.ELIZA_DEV_ALLOW_TEST_MOCKS,'1');
  assert.equal(vite.env.ALPHA_DEV_CONNECTION_TOOLS,'0');
  assert.deepEqual({...await renderer(vite.env,true)},{testMocksEnabled:true,devSurfacesEnabled:true,privateLocalPreviewEnabled:true});
  // A build from the same environment never admits it: the APK and production web builds are unchanged.
  assert.equal((await renderer(vite.env,false)).privateLocalPreviewEnabled,false);
  assert.match(stdout,/Connection sheet: Alpha connection\. Set ALPHA_DEV_CONNECTION_TOOLS=1/);
 }
});

test('ALPHA_DEV_CONNECTION_TOOLS=1 restores the development connection sheet',async()=>{
 const {stdout,vite}=await launch({ALPHA_DEV_CONNECTION_TOOLS:'1'});
 assert.equal(vite.env.VITE_LOCAL_AGENT,'1');assert.equal(vite.env.ALPHA_DEV_CONNECTION_TOOLS,'1');
 assert.deepEqual({...await renderer(vite.env,true)},{testMocksEnabled:true,devSurfacesEnabled:true,privateLocalPreviewEnabled:false});
 assert.match(stdout,/Connection sheet: development tools/);
});

test('dev:ui with the local agent and no connection tools setting keeps the development sheet',async()=>{
 const env={...process.env,ELIZA_DEV_ALLOW_TEST_MOCKS:'1',VITE_LOCAL_AGENT:'1',ALPHA_LOCAL_AGENT_ORIGIN:'http://127.0.0.1:1'};delete env.ALPHA_DEV_CONNECTION_TOOLS;
 assert.deepEqual({...await renderer(env,true)},{testMocksEnabled:true,devSurfacesEnabled:true,privateLocalPreviewEnabled:false});
});
