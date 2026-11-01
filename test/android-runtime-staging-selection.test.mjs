import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {runtimeStagingSelection} from '../scripts/stage-local-agent-runtime.mjs';
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'android-stage-selection-'));
 const source=path.join(root,'source'),archive=path.join(root,'reviewed.zip');
 const bytes=Buffer.from('synthetic archive selection fixture; not a Bun executable');
 fs.writeFileSync(archive,bytes);
 const lock=path.join(source,'packages/app/scripts/lib/android-bun-artifacts.lock.json');fs.mkdirSync(path.dirname(lock),{recursive:true});
 fs.writeFileSync(lock,JSON.stringify({targets:{android:{stable:{artifacts:{aarch64:{archiveSha256:createHash('sha256').update(bytes).digest('hex')}}}}}}));
 return {root,source,archive,env:{ELIZA_ANDROID_BUN_TARGET:'android',ELIZA_ANDROID_TARGET_ABIS:'arm64-v8a',ELIZA_BUN_AARCH64_FILE:archive}};
}
test('normal producer selection retains explicit native target, ARM64 and SDK-verified local archive',()=>{
 const f=fixture();try{
  const input={...f.env,ALPHA_BUN:'/existing/host/bun',SYNTHETIC_PARENT_VALUE:'preserved'};const original={...input};
  const selected=runtimeStagingSelection(f.source,input);
  assert.equal(selected.bunTarget,'android');assert.equal(selected.targetAbis,'arm64-v8a');
  assert.equal(selected.env.ELIZA_ANDROID_BUN_TARGET,'android');assert.equal(selected.env.ELIZA_ANDROID_TARGET_ABIS,'arm64-v8a');
  assert.equal(selected.env.ELIZA_BUN_AARCH64_FILE,f.archive);assert.equal(selected.env.ELIZA_BUN_CHANNEL,'stable');
  assert.equal(selected.env.ALPHA_BUN,input.ALPHA_BUN);assert.equal(selected.env.SYNTHETIC_PARENT_VALUE,'preserved');assert.deepEqual(input,original);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('normal native producer refuses fallback ABIs, unreviewed channels and missing or changed archives',()=>{
 const f=fixture();try{
  for(const delta of [
   {ELIZA_ANDROID_BUN_TARGET:'unknown'}, {ELIZA_ANDROID_TARGET_ABIS:'x86_64'},
   {ELIZA_ANDROID_TARGET_ABIS:'arm64-v8a,x86_64'}, {ELIZA_ANDROID_TARGET_ABIS:undefined},
   {ELIZA_ANDROID_TARGET_ABIS:'arm64-v8a,arm64-v8a'}, {ELIZA_ANDROID_TARGET_ABIS:''},
   {ELIZA_BUN_CHANNEL:'canary'}, {ELIZA_BUN_AARCH64_FILE:undefined}, {ELIZA_BUN_AARCH64_FILE:'relative.zip'},
  ])assert.throws(()=>runtimeStagingSelection(f.source,{...f.env,...delta}));
  fs.writeFileSync(f.archive,'modified archive');assert.throws(()=>runtimeStagingSelection(f.source,f.env),/differs from the pinned SDK artifact/);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('legacy producer defaults remain explicit musl with both ABIs and respect a reviewed ARM64-only selection',()=>{
 const selected=runtimeStagingSelection('/not-used-for-legacy',{});
 assert.equal(selected.bunTarget,'linux-musl');assert.equal(selected.targetAbis,'arm64-v8a,x86_64');
 assert.equal(runtimeStagingSelection('/not-used-for-legacy',{ELIZA_ANDROID_TARGET_ABIS:'arm64-v8a'}).targetAbis,'arm64-v8a');
});
test('the actual agent:stage-android entry uses selected environment and explicit SDK target before building',()=>{
 const script=fs.readFileSync(new URL('../scripts/stage-local-agent-runtime.mjs',import.meta.url),'utf8');
 const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(pkg.scripts['agent:stage-android'],'node scripts/stage-local-agent-runtime.mjs');
 assert.ok(pkg.scripts['android:build:local'].includes('npm run agent:stage-android'));
 assert.ok(script.includes('const env=selection.env;'));
 assert.ok(script.includes('bunTarget:${JSON.stringify(selection.bunTarget)}'));
 assert.ok(script.indexOf('const selection=runtimeStagingSelection(source,process.env);')<script.indexOf("'scripts/build-mobile-agent.mjs'"));
 assert.ok(script.includes('verifyMobileBuildReceipt(root,source)'));
 assert.ok(!script.includes("preparedSourceEnv(process.env,{ELIZA_ANDROID_TARGET_ABIS:'arm64-v8a,x86_64'})"));
});
