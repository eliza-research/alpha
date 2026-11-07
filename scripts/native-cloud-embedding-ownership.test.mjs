import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// Each process owns an isolated real config/routing store; module caches and
// provider environment cannot leak between native, Cloud and disabled cases.
const moduleFile = process.env.ALPHA_NATIVE_CLOUD_HOST_MODULE;
if(!moduleFile||!path.isAbsolute(moduleFile))throw Error('Run through scripts/test-native-cloud-runtime-config.mjs with a verified prepared host');
const moduleUrl = pathToFileURL(moduleFile).href;
// The compiled product host declares its deployment; the prepared SDK's shared profile writes routing.
const sdkRoot = process.env.ALPHA_NATIVE_CLOUD_SDK;
if(!sdkRoot||!path.isAbsolute(sdkRoot))throw Error('Run through scripts/test-native-cloud-runtime-config.mjs with the prepared SDK');
const profileUrl = pathToFileURL(path.join(sdkRoot,'packages/app/src/runtime/native-runtime-profile.ts')).href;
for (const mode of ['native', 'cloud', 'disabled']) {
 test(`native Cloud preparation preserves ${mode} embedding ownership`, () => {
  const code = `
   import assert from 'node:assert/strict';
   import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import {pathToFileURL} from 'node:url';
   const root=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-routing-'));
   const config=path.join(root,'eliza.json'); const mode=${JSON.stringify(mode)};
   Object.assign(process.env, {ELIZA_STATE_DIR:root,ELIZA_CONFIG_PATH:config,ELIZA_PERSIST_CONFIG_PATH:config,
    ELIZA_PLATFORM:'android',ELIZA_SMTHRS_RUNTIME_DIR:root,ELIZAOS_CLOUD_BASE_URL:'https://api.eliza.app/api/v1',
    ELIZAOS_CLOUD_SMALL_MODEL:'cerebras/qwen-3.8-27b',ELIZAOS_CLOUD_LARGE_MODEL:'cerebras/qwen-3.8-27b',
    ELIZA_LOCAL_EMBEDDING_ENABLED:mode==='disabled'?'0':'1',ELIZA_DISABLE_LOCAL_EMBEDDINGS:mode==='disabled'?'true':'false'});
   if(mode==='cloud')process.env.ELIZA_RUNTIME_PROFILE='cloud'; else delete process.env.ELIZA_RUNTIME_PROFILE;
   fs.writeFileSync(config,JSON.stringify({cloud:{enabled:false},serviceRouting:{},features:{shellEnabled:false}}));
   let requests=0; globalThis.fetch=async()=>{requests++;throw Error('Unexpected network request');};
   try {
    const {nativeCloudRuntime}=await import(${JSON.stringify(moduleUrl)});
    const {applyNativeCloudRuntimeProfile}=await import(${JSON.stringify(profileUrl)});
    await applyNativeCloudRuntimeProfile(process.env,nativeCloudRuntime);
    const actual=JSON.parse(fs.readFileSync(config,'utf8'));
    assert.equal(actual.serviceRouting.llmText.backend,'elizacloud');
    if(mode==='native')assert.deepEqual(actual.serviceRouting.embeddings,{backend:'eliza-local-inference',transport:'direct'});
    if(mode==='cloud')assert.equal(actual.serviceRouting.embeddings.backend,'elizacloud');
    // Missing local inputs never authorize Cloud: the native route is kept and reported unavailable.
    if(mode==='disabled')assert.deepEqual(actual.serviceRouting.embeddings,{backend:'eliza-local-inference',transport:'direct'});
    assert.equal(requests,0);
   } finally {fs.rmSync(root,{recursive:true,force:true});}
  `;
  const bun = process.versions.bun ? process.execPath : process.env.BUN_BIN || 'bun';
  const result = spawnSync(bun, ['--conditions=eliza-source','-e',code], {
   cwd:path.dirname(moduleFile),encoding:'utf8',timeout:30000,
  });
  assert.ifError(result.error);
  assert.equal(result.status,0,result.stderr || result.stdout);
 });
}
