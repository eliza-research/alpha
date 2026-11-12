import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:net';

 test('actual Cloud launcher strips inherited provider authority before enabling only resident batch speech',async()=>{
 const directory=await fs.mkdtemp(join(tmpdir(),'alpha-cloud-launcher-')),source=join(directory,'source'),capture=join(directory,'capture.json'),loader=join(directory,'loader.mjs');
 const port=async()=>{const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const selected=server.address().port;await new Promise(resolve=>server.close(resolve));return selected;};
 try{
  await fs.mkdir(join(source,'node_modules'),{recursive:true});
  // Bun binds a builtin's named exports once, so the launcher's `spawn` import is intercepted where
  // every spawn starts the process: ChildProcess.prototype.spawn.
  await fs.writeFile(loader,`import {ChildProcess} from 'node:child_process';import {writeFileSync} from 'node:fs';ChildProcess.prototype.spawn=function(options){const keys=['ELIZA_DEV_ALLOW_TEST_MOCKS','VITE_ELIZA_DEV_ALLOW_TEST_MOCKS','VITE_ALPHA_CLOUD_RESIDENT','VITE_ALPHA_CLOUD_ENVIRONMENT','ALPHA_DEV_CLOUD_VOICE','ALPHA_DEV_CARTESIA','ALPHA_DEV_CLOUD_REALTIME_VOICE','VITE_ALPHA_DEV_CLOUD_VOICE','CEREBRAS_API_KEY','OPENAI_API_KEY','ELIZAOS_CLOUD_API_KEY'];writeFileSync(process.env.ALPHA_LAUNCHER_TEST_CAPTURE,JSON.stringify(Object.fromEntries(keys.map(key=>[key,options.env[key]??null]))));this.kill=()=>true;queueMicrotask(()=>this.emit('exit',0));};`);
  // Keep the authority assertions while allowing the authenticated client preparation to finish.
  const run=spawnSync(process.execPath,['--preload',loader,'scripts/dev-cloud.ts'],{cwd:process.cwd(),env:{...process.env,ALPHA_ELIZA_SOURCE:source,ALPHA_REMOTE_PORT:String(await port()),ALPHA_CLOUD_UI_PORT:String(await port()),ALPHA_CLOUD_ENVIRONMENT:'staging',ALPHA_LAUNCHER_TEST_CAPTURE:capture,CEREBRAS_API_KEY:'synthetic-direct',OPENAI_API_KEY:'synthetic-openai',ELIZAOS_CLOUD_API_KEY:'synthetic-cloud',ALPHA_DEV_CARTESIA:'1',ALPHA_DEV_CLOUD_REALTIME_VOICE:'1',VITE_ALPHA_DEV_CLOUD_VOICE:'1'},encoding:'utf8',timeout:120000});
  assert.equal(run.status,0,run.stderr);
  const env=JSON.parse(await fs.readFile(capture,'utf8'));assert.equal(env.ALPHA_DEV_CLOUD_VOICE,'1');assert.equal(env.ELIZA_DEV_ALLOW_TEST_MOCKS,'');assert.equal(env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS,'');assert.equal(env.VITE_ALPHA_CLOUD_RESIDENT,'1');assert.equal(env.VITE_ALPHA_CLOUD_ENVIRONMENT,'staging');
  for(const key of ['CEREBRAS_API_KEY','OPENAI_API_KEY','ELIZAOS_CLOUD_API_KEY','ALPHA_DEV_CARTESIA','ALPHA_DEV_CLOUD_REALTIME_VOICE','VITE_ALPHA_DEV_CLOUD_VOICE'])assert.equal(env[key],null,key);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
 });
