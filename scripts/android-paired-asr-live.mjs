/** Actual isolated Eliza47846 -> Notes Listen -> native decoding. Synthetic recording ingress only. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {androidEnv} from './toolchain.mjs';
const serial=process.env.ANDROID_SERIAL,archive=process.env.ALPHA_BUILD_ARCHIVE,profile=process.env.ALPHA_ASR_PROFILE;
if(!/^emulator-\d+$/.test(serial||'')||!archive)throw Error('Explicit disposable ANDROID_SERIAL and ALPHA_BUILD_ARCHIVE required');
// The host runs with ELIZA_REQUIRE_LOCAL_AUTH=1, so the pairing code needs its owner token (the --profile given to start-local-voice-agent).
if(!profile||!path.isAbsolute(profile))throw Error('Explicit absolute ALPHA_ASR_PROFILE (the 47846 host profile) required');
const env=androidEnv(),adb=path.join(env.ANDROID_HOME,'platform-tools/adb'),appId=JSON.parse(fs.readFileSync('app.config.json')).appId;
const manifest=JSON.parse(fs.readFileSync(path.join(archive,'apk-manifest.json'))),out=process.env.ALPHA_ASR_RESULTS||path.join(archive,'paired-asr-live');fs.mkdirSync(out,{recursive:true});
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const run=(args,input)=>execFileSync(adb,['-s',serial,...args],{env,input,encoding:'utf8',timeout:args.includes('instrument')?360000:120000});
const results=[];
for(const variant of ['standalone','launcher']){
 const apk=path.join(archive,`${variant}-debug.apk`),testApk=path.join(archive,`${variant}-androidTest.apk`),sha256=hash(apk),testSha256=hash(testApk);
 assert.equal(manifest[`${variant}-debug.apk`],sha256);assert.equal(manifest[`${variant}-androidTest.apk`],testSha256);
 const record={variant,sha256,testSha256,passed:false};let stage='install';
 try{
  run(['install','--no-incremental','-r',apk]);run(['install','--no-incremental','-r',testApk]);run(['shell','am','force-stop',appId]);
  stage='private pairing fixture';
  const response=await fetch('http://127.0.0.1:47846/api/auth/pair-code',{headers:{Authorization:'Bearer '+fs.readFileSync(path.join(profile,'owner-token'),'utf8').trim()},redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Pairing unavailable');const data=await response.json();if(typeof data.code!=='string'||!data.code)throw Error('Invalid pairing fixture');
  run(['shell',`run-as ${appId} sh -c 'umask 077; mkdir -p files; cat > files/paired-asr-live.json'`],JSON.stringify({origin:'http://10.0.2.2:47846',code:data.code}));
  stage='native Notes flow';
  const log=run(['shell','am','instrument','-w','-e','pairedAsrLive','1','-e','class',`${appId}.PairedAsrLiveInstrumentedTest`,`${appId}.test/androidx.test.runner.AndroidJUnitRunner`]);
  fs.writeFileSync(path.join(out,`${variant}.txt`),log);record.passed=/OK \(1 test\)/.test(log)&&!/FAILURES|INSTRUMENTATION_FAILED|Process crashed/.test(log);record.stage=stage;
 }catch{record.stage=stage; /* Exception arguments may contain private pairing input. Never dump them. */}
 finally{try{run(['shell',`run-as ${appId} rm -f files/paired-asr-live.json`]);}catch{record.fixtureCleanupFailed=true;record.passed=false;}}
 results.push(record);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({testedAt:new Date().toISOString(),serial,archive,scope:'Actual paired agent ASR (/api/asr/libelizainference, libelizainference provider) + Notes explicit synthetic AAC upload, native PCM conversion, real transcript review/edit + TTS Listen decoded completion/cancel. Recording ingress is instrumented synthetic AAC; no microphone, Cloud, or enclave acceptance. Original selection and encrypted credential restored by test finally.',results},null,2));console.log(`${variant}: ${record.passed?'passed':'failed'} (${record.stage})`);
}
if(results.some(r=>!r.passed))process.exitCode=1;
