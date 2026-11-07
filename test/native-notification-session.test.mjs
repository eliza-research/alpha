import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {prepareNativeFixture,noticeSources} from './fixtures/native-source.mjs';
import {jsonJar,javaBinary} from './fixtures/jvm-tools.mjs';
test('native notifications restore only an existing verified machine owner',()=>{
 assert.ok(jsonJar,'Pinned JVM JSON dependency required; no skipped authority proof');
 const root=resolve(import.meta.dirname,'..'),temporary=mkdtempSync(join(tmpdir(),'native-notification-session-'));
 const base=join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone');
 try{
  execFileSync(javaBinary('javac'),['--release','11','-cp',jsonJar,'-d',temporary,join(root,'vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/connection/SecureSlotPolicy.java'),...['CloudDeployment','RendererCredentialSlots','ResidentResultTransport','ResidentResultSession','HostedInbox','HostedResultNotices','HostedStorageFault','NativeNotificationSession'].map(name=>join(base,name+'.java')),...noticeSources(prepareNativeFixture(root,temporary).root,'NoticeOwner'),join(root,'test/fixtures/NativeNotificationSessionTest.java')],{timeout:30000,stdio:'pipe'});
  assert.match(execFileSync(javaBinary('java'),['-cp',temporary+':'+jsonJar,'ai.elizaresearch.alphaphone.NativeNotificationSessionTest'],{encoding:'utf8',timeout:30000,stdio:'pipe'}),/^PASS NativeNotificationSession:/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
