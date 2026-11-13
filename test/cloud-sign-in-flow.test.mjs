import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {preparePatchedNative} from '../scripts/prepare-patched-native.ts';
import {javaBinary} from './fixtures/jvm-tools.mjs';

// Alpha's registration of the shared native Eliza Cloud sign-in client (elizaOS/eliza
// packages/auth/android; its policy, plugin methods and contract vectors are tested there). These
// checks cover Alpha's identity, installed names, App Link, callback contract and renderer wiring.
// This builds no APK, runs nothing on Android, verifies no App Link, and contacts neither Eliza Cloud
// nor Google.
const root=resolve(import.meta.dirname,'..');
const read=file=>readFileSync(join(root,file),'utf8');
const patched=preparePatchedNative({root});
const shared=patched.root.slice(root.length+1)+'/packages/auth/android/src/main/java/ai/eliza/auth/cloud/';

// Alpha's callback contract (the registration its App Link and Cloud allowlist use) through the
// shared parser, with the shared contract runner.
test('Alpha callback contract vectors through the shared native parser',()=>{
 const contract=JSON.parse(read('test/fixtures/alphaphone-auth-callback-contract.json'));
 assert.equal(contract.contract,'alphaphone-auth-callback');assert.equal(contract.version,1);
 assert.equal(contract.package,'ai.alphacompute.alphaphone');assert.equal(contract.callbackPath,'/alphaphone/auth/callback');
 assert.deepEqual(contract.hosts,{production:'eliza.app',staging:'staging.eliza.app'});
 for(const kind of ['success','error','return','reject'])assert.ok(contract.cases.some(row=>row.expect===kind),`vectors cover ${kind}`);
 for(const row of contract.fallbackHandoffs){
  assert.ok(!row.intentUrl.split('#Intent')[0].includes('?')&&!/code=|state=/.test(row.intentUrl),row.name);
  assert.equal(`https://${row.intentUrl.slice('intent://'.length).split('#Intent')[0]}`,row.deliveredUrl,row.name);
 }
 const lines=[...contract.cases.map(row=>[row.environment,row.expect,row.url,row.code??'',row.state??'',row.error??'']),
  ...contract.fallbackHandoffs.map(row=>[row.environment,row.expect,row.deliveredUrl,'','',''])];
 const temporary=mkdtempSync(join(tmpdir(),'cloud-sign-in-contract-'));
 try{
  writeFileSync(join(temporary,'vectors.tsv'),lines.map(line=>line.join('\t')).join('\n')+'\n');
  const sources=['CloudSignInConfig.java','CloudSignInEnvironment.java','CloudSignInFlow.java'].map(file=>join(root,shared,file)).concat(join(root,'vendor/eliza/packages/auth/android/test/ai/eliza/auth/cloud/CloudSignInContractTest.java'));
  execFileSync(javaBinary('javac'),['--release','11','-d',temporary,...sources],{timeout:60000});
  assert.match(execFileSync(javaBinary('java'),['-cp',temporary,'ai.eliza.auth.cloud.CloudSignInContractTest',join(temporary,'vectors.tsv'),contract.callbackPath,contract.hosts.production,contract.hosts.staging],{encoding:'utf8',timeout:60000}),new RegExp(`^PASS callback contract \\(${lines.length} vectors\\)`));
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
