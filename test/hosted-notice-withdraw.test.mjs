import {prepareNativeFixture,noticeSources} from './fixtures/native-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {jsonJar,jvmSkip,javaBinary} from './fixtures/jvm-tools.mjs';
test('a result shown in the app withdraws its notice and a result for an open panel posts silently',{skip:jvmSkip('json')},()=>{
 const root=resolve(import.meta.dirname,'..'),temporary=mkdtempSync(join(tmpdir(),'hosted-withdraw-'));
 try{
  execFileSync(javaBinary('javac'),['--release','11','-cp',jsonJar,'-d',temporary,...noticeSources(prepareNativeFixture(root,temporary).root,'NoticeOwner'),join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/HostedResultNotices.java'),join(root,'test/fixtures/HostedNoticeWithdrawTest.java')],{timeout:20000});
  assert.match(execFileSync(javaBinary('java'),['-cp',temporary+':'+jsonJar,'ai.elizaresearch.alphaphone.HostedNoticeWithdrawTest'],{encoding:'utf8',timeout:20000}),/^PASS hosted notice withdraw/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
