import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {javaBinary} from './fixtures/jvm-tools.mjs';
test('local speech model ownership cancels without blocking, reopens safely and validates complete PCM',()=>{
 const out=mkdtempSync(join(tmpdir(),'alpha-paradee-lifecycle-'));
 try{execFileSync(javaBinary('javac'),['--release','11','-d',out,resolve('vendor/eliza/plugins/plugin-local-inference/native/android/src/main/java/ai/eliza/voice/LocalSpeechEngine.java'),resolve('vendor/eliza/packages/app/scripts/paradee-voice/speech-pipeline/LocalSpeechEngineTest.java')],{timeout:scaledTimeout(20000)});assert.match(execFileSync(javaBinary('java'),['-cp',out,'ai.eliza.voice.LocalSpeechEngineTest'],{encoding:'utf8',timeout:scaledTimeout(10000)}),/^PASS local speech lifecycle and PCM/);}finally{rmSync(out,{recursive:true,force:true});}
});
