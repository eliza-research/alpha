import {prepareNativeFixture,noticeSources} from './fixtures/native-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {jsonJar,jvmSkip,javaBinary} from './fixtures/jvm-tools.mjs';
test('native workflow notices preserve at-most-once delivery across crashes and replay',{skip:jvmSkip('json')},()=>{
 const root=resolve(import.meta.dirname,'..'),temporary=mkdtempSync(join(tmpdir(),'workflow-notice-'));
 try{
  execFileSync(javaBinary('javac'),['--release','11','-cp',jsonJar,'-d',temporary,...noticeSources(prepareNativeFixture(root,temporary).root,'NoticeDelivery','NoticeOwner','NoticeRoutes','NoticeCoordinator','NoticeRecovery'),join(root,'android/app/src/main/java/ai/alphacompute/alphaphone/WorkflowNoticeDelivery.java'),join(root,'test/fixtures/WorkflowNoticeDeliveryTest.java'),join(root,'test/fixtures/WorkflowNoticeRecoveryTest.java'),join(root,'android/app/src/main/java/ai/alphacompute/alphaphone/WorkflowNoticeTaps.java'),join(root,'test/fixtures/WorkflowNoticeTapsTest.java')],{timeout:20000});
  assert.match(execFileSync(javaBinary('java'),['-cp',temporary+':'+jsonJar,'ai.alphacompute.alphaphone.WorkflowNoticeDeliveryTest'],{encoding:'utf8',timeout:20000}),/^PASS workflow notices/);
  assert.match(execFileSync(javaBinary('java'),['-cp',temporary+':'+jsonJar,'ai.alphacompute.alphaphone.WorkflowNoticeRecoveryTest'],{encoding:'utf8',timeout:20000}),/^PASS workflow recovery/);
  assert.match(execFileSync(javaBinary('java'),['-cp',temporary+':'+jsonJar,'ai.alphacompute.alphaphone.WorkflowNoticeTapsTest'],{encoding:'utf8',timeout:20000}),/^PASS workflow tap/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
