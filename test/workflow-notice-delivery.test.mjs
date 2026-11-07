import {prepareNativeFixture,noticeSources} from './fixtures/native-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const cache=join(homedir(),'.gradle/caches/modules-2/files-2.1/org.json/json/20250517');
const cached=existsSync(cache)?readdirSync(cache).flatMap(hash=>readdirSync(join(cache,hash)).filter(name=>name==='json-20250517.jar').map(name=>join(cache,hash,name)))[0]:undefined;
const jsonJar=process.env.ALPHA_JSON_JAR||cached;
test('native workflow notices preserve at-most-once delivery across crashes and replay',{skip:!jsonJar?'Set ALPHA_JSON_JAR or install the pinned Gradle JSON test dependency':false},()=>{
 const root=resolve(import.meta.dirname,'..'),temporary=mkdtempSync(join(tmpdir(),'workflow-notice-'));
 const java=process.env.JAVA_HOME||(process.platform==='darwin'?'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home':'');const binary=name=>java?join(java,'bin',name):name;
 try{
  execFileSync(binary('javac'),['--release','11','-cp',jsonJar,'-d',temporary,...noticeSources(prepareNativeFixture(root,temporary).root,'NoticeDelivery','NoticeOwner','NoticeRoutes','NoticeCoordinator','NoticeRecovery'),join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/WorkflowNoticeDelivery.java'),join(root,'test/fixtures/WorkflowNoticeDeliveryTest.java'),join(root,'test/fixtures/WorkflowNoticeRecoveryTest.java'),join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/WorkflowNoticeTaps.java'),join(root,'test/fixtures/WorkflowNoticeTapsTest.java')],{timeout:20000});
  assert.match(execFileSync(binary('java'),['-cp',temporary+':'+jsonJar,'ai.elizaresearch.alphaphone.WorkflowNoticeDeliveryTest'],{encoding:'utf8',timeout:20000}),/^PASS workflow notices/);
  assert.match(execFileSync(binary('java'),['-cp',temporary+':'+jsonJar,'ai.elizaresearch.alphaphone.WorkflowNoticeRecoveryTest'],{encoding:'utf8',timeout:20000}),/^PASS workflow recovery/);
  assert.match(execFileSync(binary('java'),['-cp',temporary+':'+jsonJar,'ai.elizaresearch.alphaphone.WorkflowNoticeTapsTest'],{encoding:'utf8',timeout:20000}),/^PASS workflow tap/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
