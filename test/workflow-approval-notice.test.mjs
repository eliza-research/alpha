import {prepareNativeFixture,noticeSources} from './fixtures/native-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const cache=join(homedir(),'.gradle/caches/modules-2/files-2.1/org.json/json/20250517');
const cached=existsSync(cache)?readdirSync(cache).flatMap(hash=>readdirSync(join(cache,hash)).filter(name=>name==='json-20250517.jar').map(name=>join(cache,hash,name)))[0]:undefined;
const jsonJar=process.env.ALPHA_JSON_JAR||cached;
test('phone-step approval notices post once per approval, expire, open after restart and withdraw on decision',{skip:!jsonJar?'Set ALPHA_JSON_JAR or install the pinned Gradle JSON test dependency':false},()=>{
 const root=resolve(import.meta.dirname,'..'),temporary=mkdtempSync(join(tmpdir(),'workflow-approval-notice-'));
 const java=process.env.JAVA_HOME||(process.platform==='darwin'?'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home':'');const binary=name=>java?join(java,'bin',name):name;
 const shared=noticeSources(prepareNativeFixture(root,temporary).root,'NoticeDelivery','NoticeOwner','NoticeRoutes','NoticeCoordinator');
 const source=name=>join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone',name);
 try{
  execFileSync(binary('javac'),['--release','11','-cp',jsonJar,'-d',temporary,...shared,source('WorkflowNoticeDelivery.java'),source('WorkflowNoticeTaps.java'),join(root,'test/fixtures/WorkflowApprovalNoticeTest.java')],{timeout:120000});
  assert.match(execFileSync(binary('java'),['-cp',temporary+':'+jsonJar,'ai.elizaresearch.alphaphone.WorkflowApprovalNoticeTest'],{encoding:'utf8',timeout:120000}),/^PASS workflow approval notices/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
