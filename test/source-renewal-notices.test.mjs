import {prepareNativeFixture,noticeSources} from './fixtures/native-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {jsonJar,jvmSkip,javaBinary} from './fixtures/jvm-tools.mjs';
test('source renewal notices bind owner and revision, survive restart and preserve cancellation',{skip:jvmSkip('json')},()=>{
 const root=resolve(import.meta.dirname,'..'),temporary=mkdtempSync(join(tmpdir(),'hosted-notices-'));
 try{
  execFileSync(javaBinary('javac'),['--release','11','-cp',jsonJar,'-d',temporary,...noticeSources(prepareNativeFixture(root,temporary).root,'NoticeOwner'),join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/HostedResultNotices.java'),join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/SourceRenewalNotices.java'),join(root,'test/fixtures/SourceRenewalNoticesTest.java')],{timeout:20000});
  assert.match(execFileSync(javaBinary('java'),['-cp',temporary+':'+jsonJar,'ai.elizaresearch.alphaphone.SourceRenewalNoticesTest'],{encoding:'utf8',timeout:20000}),/^PASS source renewal notices/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
