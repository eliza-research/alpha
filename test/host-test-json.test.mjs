import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const script=path.resolve(import.meta.dirname,'../scripts/ci/prepare-host-test-json.sh');
const digest='3ea61b2a06e31edf1c91134fe9106b0ebb16628be169f3db75bc7a2b06b45796';
const urls=['https://repo.maven.apache.org/maven2','https://repo1.maven.org/maven2']
 .map(root=>root+'/org/json/json/20250517/json-20250517.jar');
// Controlled transport/checksum process ports. The real Maven bytes and digest
// are checked separately; these cases exercise fallback and publication ordering.
function fixture(t, modes){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-host-json-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const bin=path.join(root,'bin'),runner=path.join(root,'runner temp');fs.mkdirSync(bin);fs.mkdirSync(runner);
 const jar=path.join(runner,'json-20250517.jar'),environment=path.join(root,'environment');
 fs.writeFileSync(jar,'prior jar');fs.writeFileSync(environment,'');
 const program=(name,source)=>{const file=path.join(bin,name);fs.writeFileSync(file,'#!/usr/bin/env node\n'+source);fs.chmodSync(file,0o700);};
 program('curl',`const fs=require('node:fs'); const args=process.argv.slice(2),url=args.find(x=>x.startsWith('https://')),output=args[args.indexOf('--output')+1];
 const index=url.includes('repo1.maven.org')?1:0,modes=JSON.parse(process.env.TEST_MODES);
 fs.appendFileSync(process.env.TEST_CALLS,JSON.stringify({url,prior:fs.readFileSync(process.env.TEST_JAR,'utf8')})+'\\n');
 if(modes[index]==='unavailable')process.exit(22);
 fs.writeFileSync(output,modes[index]==='valid'?'verified jar fixture':'wrong bytes');`);
 program('sha256sum',`const fs=require('node:fs'),input=fs.readFileSync(0,'utf8'),match=/^([a-f0-9]{64})  (.*)\\n$/.exec(input);
 if(!match||match[1]!==${JSON.stringify(digest)}||(!process.argv.includes('-c')||!process.argv.includes('-')))process.exit(3);
 fs.appendFileSync(process.env.TEST_CHECKS,JSON.stringify({file:match[2],prior:fs.readFileSync(process.env.TEST_JAR,'utf8')})+'\\n');
 process.exit(fs.readFileSync(match[2],'utf8')==='verified jar fixture'?0:1);`);
 const calls=path.join(root,'calls'),checks=path.join(root,'checks');
 const result=spawnSync('bash',[script],{encoding:'utf8',env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,
  RUNNER_TEMP:runner,GITHUB_ENV:environment,TEST_JAR:jar,TEST_CALLS:calls,TEST_CHECKS:checks,TEST_MODES:JSON.stringify(modes)}});
 const rows=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];
 return {result,jar,environment,runner,calls:rows(calls),checks:rows(checks)};
}
for(const primary of ['unavailable','invalid'])test(`host JSON ${primary} primary uses the same pinned mirror before publication`,t=>{
 const f=fixture(t,[primary,'valid']);assert.equal(f.result.status,0,f.result.stderr);
 assert.deepEqual(f.calls.map(row=>row.url),urls);
 assert.ok(f.calls.every(row=>row.prior==='prior jar'));
 assert.ok(f.checks.every(row=>row.prior==='prior jar'&&row.file!==f.jar));
 assert.equal(fs.readFileSync(f.jar,'utf8'),'verified jar fixture');
 assert.equal(fs.readFileSync(f.environment,'utf8'),`ALPHA_JSON_JAR=${f.jar}\nELIZA_ORG_JSON_JAR=${f.jar}\n`);
 assert.deepEqual(fs.readdirSync(f.runner),['json-20250517.jar']);
});
test('host JSON publishes the first valid endpoint without downloading the mirror',t=>{
 const f=fixture(t,['valid','invalid']);assert.equal(f.result.status,0,f.result.stderr);
 assert.deepEqual(f.calls.map(row=>row.url),[urls[0]]);assert.equal(f.checks.length,1);
});
for(const modes of [['unavailable','unavailable'],['invalid','invalid']])test(`host JSON failure preserves prior bytes and publishes no environment (${modes[0]})`,t=>{
 const f=fixture(t,modes);assert.equal(f.result.status,1);
 assert.equal(fs.readFileSync(f.jar,'utf8'),'prior jar');assert.equal(fs.readFileSync(f.environment,'utf8'),'');
 assert.deepEqual(fs.readdirSync(f.runner),['json-20250517.jar']);
});
