// `npm run dev` (scripts/dev-local.mjs) runs here with recording stand-ins for the local agent and
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
import {stripTypeScriptTypes} from 'node:module';

const stubs={
 'scripts/prepare-client-features.mjs':'export function prepareClientFeatures(){}\n',
 'scripts/local-agent-source.mjs':"export function sourceDirectory(){throw Error('ALPHA_ELIZA_SOURCE is set by the test');}\n",
 // Self-exits so a failed run cannot leave it behind.
 'scripts/start-local-remote.mjs':"import fs from 'node:fs';fs.writeFileSync('agent.json',JSON.stringify(process.env));setTimeout(()=>process.exit(0),20000);\n",
 'node_modules/vite/package.json':'{"type":"module"}\n',
 'node_modules/vite/bin/vite.js':"import fs from 'node:fs';const until=Date.now()+15000;while(!fs.existsSync('agent.json')&&Date.now()<until)await new Promise(r=>setTimeout(r,20));fs.writeFileSync('vite.json',JSON.stringify({argv:process.argv.slice(2),env:process.env}));\n",
};
const freePort=()=>new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const {port}=server.address();server.close(()=>resolve(port));});});
async function launch(overrides={}){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'alpha-dev-local-')));
 try{
  for(const file of ['scripts/dev-local.mjs','scripts/dev-speech-settings.mjs','scripts/speech-env.mjs']){fs.mkdirSync(path.join(root,path.dirname(file)),{recursive:true});fs.copyFileSync(file,path.join(root,file));}
  for(const [file,text] of Object.entries(stubs)){fs.mkdirSync(path.join(root,path.dirname(file)),{recursive:true});fs.writeFileSync(path.join(root,file),text);}
  fs.mkdirSync(path.join(root,'source/node_modules'),{recursive:true});
  const env={...process.env,ALPHA_ELIZA_SOURCE:path.join(root,'source'),ALPHA_REMOTE_PROFILE:path.join(root,'profile'),ALPHA_REMOTE_PORT:String(await freePort()),...overrides};
  for(const key of ['NODE_TEST_CONTEXT',...['ALPHA_DEV_CONNECTION_TOOLS','VITE_ALPHA_PRIVATE_LOCAL_PREVIEW'].filter(key=>!Object.hasOwn(overrides,key))])delete env[key];
  const child=spawn(process.execPath,['scripts/dev-local.mjs'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
  const timer=setTimeout(()=>child.kill('SIGTERM'),20000);
  const status=await new Promise(resolve=>child.on('close',resolve));clearTimeout(timer);
  assert.equal(status,0,stderr);
  return {stdout,agent:JSON.parse(fs.readFileSync(path.join(root,'agent.json'),'utf8')),vite:JSON.parse(fs.readFileSync(path.join(root,'vite.json'),'utf8'))};
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
const flags=stripTypeScriptTypes(fs.readFileSync('apps/app/src/build-flags.ts','utf8').replace(/^export /gm,'').replaceAll('import.meta.env','env'),{mode:'transform'});
/** import.meta.env as Vite derives it from the launched process environment (vite.config.ts `define`). */
function renderer(processEnv,DEV){
 const env={DEV,...Object.fromEntries(Object.entries(processEnv).filter(([key])=>key.startsWith('VITE_'))),VITE_ELIZA_DEV_ALLOW_TEST_MOCKS:processEnv.ELIZA_DEV_ALLOW_TEST_MOCKS==='1'||processEnv.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS==='1'?'1':''};
 return vm.runInNewContext(flags+'\n({testMocksEnabled,devSurfacesEnabled,privateLocalPreviewEnabled})',{env});
}

test('npm run dev opens the product connection sheet, on the development server only',async()=>{
 for(const tools of [undefined,'0','true']){
  const {stdout,agent,vite}=await launch(tools===undefined?{}:{ALPHA_DEV_CONNECTION_TOOLS:tools});
  assert.equal(vite.env.VITE_ALPHA_PRIVATE_LOCAL_PREVIEW,'1');assert.equal(vite.env.VITE_LOCAL_AGENT,'1');assert.equal(vite.env.ELIZA_DEV_ALLOW_TEST_MOCKS,'1');
  assert.deepEqual({...renderer(vite.env,true)},{testMocksEnabled:true,devSurfacesEnabled:true,privateLocalPreviewEnabled:true});
  // A build from the same environment never admits it: the APK and production web builds are unchanged.
  assert.equal(renderer(vite.env,false).privateLocalPreviewEnabled,false);
  assert.equal(agent.VITE_ALPHA_PRIVATE_LOCAL_PREVIEW,undefined,'the flag is renderer-only');
  assert.match(stdout,/Connection sheet: Alpha connection\. Set ALPHA_DEV_CONNECTION_TOOLS=1/);
 }
});

test('ALPHA_DEV_CONNECTION_TOOLS=1 restores the development connection sheet over an inherited preview flag',async()=>{
 const {stdout,vite}=await launch({ALPHA_DEV_CONNECTION_TOOLS:'1',VITE_ALPHA_PRIVATE_LOCAL_PREVIEW:'1'});
 assert.equal(vite.env.VITE_ALPHA_PRIVATE_LOCAL_PREVIEW,'');assert.equal(vite.env.VITE_LOCAL_AGENT,'1');
 assert.deepEqual({...renderer(vite.env,true)},{testMocksEnabled:true,devSurfacesEnabled:true,privateLocalPreviewEnabled:false});
 assert.match(stdout,/Connection sheet: development tools/);
});
