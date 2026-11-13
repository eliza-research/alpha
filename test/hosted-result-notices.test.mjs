import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import {prepareNativeFixture,noticeSources} from './fixtures/native-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {jsonJar,jvmSkip,javaBinary} from './fixtures/jvm-tools.mjs';
test('hosted result notices supersede per loop, cancel on acknowledgement and bound renewal timing',{skip:jvmSkip('json')},()=>{
 const root=resolve(import.meta.dirname,'..'),temporary=mkdtempSync(join(tmpdir(),'hosted-notices-'));
 try{
  execFileSync(javaBinary('javac'),['--release','11','-cp',jsonJar,'-d',temporary,...noticeSources(prepareNativeFixture(root,temporary).root,'NoticeOwner'),join(root,'android/app/src/main/java/ai/alphacompute/alphaphone/HostedResultNotices.java'),join(root,'test/fixtures/HostedResultNoticesTest.java')],{timeout:scaledTimeout(20000)});
  assert.match(execFileSync(javaBinary('java'),['-cp',temporary+':'+jsonJar,'ai.alphacompute.alphaphone.HostedResultNoticesTest'],{encoding:'utf8',timeout:scaledTimeout(20000)}),/^PASS hosted result notices/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
