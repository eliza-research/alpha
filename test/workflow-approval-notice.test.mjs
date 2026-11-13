import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import {prepareNativeFixture,noticeSources} from './fixtures/native-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {jsonJar,jvmSkip,javaBinary} from './fixtures/jvm-tools.mjs';
test('phone-step approval notices post once per approval, expire, open after restart and withdraw on decision',{skip:jvmSkip('json')},()=>{
 const root=resolve(import.meta.dirname,'..'),temporary=mkdtempSync(join(tmpdir(),'workflow-approval-notice-'));
 const shared=noticeSources(prepareNativeFixture(root,temporary).root,'NoticeDelivery','NoticeOwner','NoticeRoutes','NoticeCoordinator');
 const source=name=>join(root,'android/app/src/main/java/ai/alphacompute/alphaphone',name);
 try{
  execFileSync(javaBinary('javac'),['--release','11','-cp',jsonJar,'-d',temporary,...shared,source('WorkflowNoticeDelivery.java'),source('WorkflowNoticeTaps.java'),join(root,'test/fixtures/WorkflowApprovalNoticeTest.java')],{timeout:scaledTimeout(120000)});
  assert.match(execFileSync(javaBinary('java'),['-cp',temporary+':'+jsonJar,'ai.alphacompute.alphaphone.WorkflowApprovalNoticeTest'],{encoding:'utf8',timeout:scaledTimeout(120000)}),/^PASS workflow approval notices/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
