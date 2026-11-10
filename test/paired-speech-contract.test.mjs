import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {jsonJar as jar,jvmSkip,javaBinary} from './fixtures/jvm-tools.mjs';
test('native paired speech accepts the pinned host contract and rejects stale providers, wrong identities and invalid text',{skip:jvmSkip('json')},()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-paired-speech-'));
 try{
 execFileSync(javaBinary('javac'),['--release','11','-cp',jar,'-d',out,'android/app/src/main/java/ai/elizaresearch/alphaphone/PairedSpeechContract.java','test/fixtures/PairedSpeechContractTest.java']);
 assert.match(execFileSync(javaBinary('java'),['-cp',out+':'+jar,'ai.elizaresearch.alphaphone.PairedSpeechContractTest'],{encoding:'utf8'}),/PASS paired speech exact contract/);
 }finally{fs.rmSync(out,{recursive:true,force:true});}
});
