import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
test('local speech model ownership cancels without blocking, reopens safely and validates complete PCM',()=>{
 const out=mkdtempSync(join(tmpdir(),'alpha-paradee-lifecycle-'));
 const home=process.env.JAVA_HOME||(process.platform==='darwin'?'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home':'');const binary=name=>home?join(home,'bin',name):name;
 try{execFileSync(binary('javac'),['--release','11','-d',out,resolve('vendor/eliza/plugins/plugin-local-inference/native/android/src/main/java/ai/eliza/voice/LocalSpeechEngine.java'),resolve('vendor/eliza/packages/app/scripts/paradee-voice/speech-pipeline/LocalSpeechEngineTest.java')],{timeout:20000});assert.match(execFileSync(binary('java'),['-cp',out,'ai.eliza.voice.LocalSpeechEngineTest'],{encoding:'utf8',timeout:10000}),/^PASS local speech lifecycle and PCM/);}finally{rmSync(out,{recursive:true,force:true});}
});
