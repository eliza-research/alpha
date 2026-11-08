import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {prepareNativeFixture,noticeSources} from './fixtures/native-source.mjs';
const cache=join(homedir(),'.gradle/caches/modules-2/files-2.1/org.json/json/20250517');
const cached=existsSync(cache)?readdirSync(cache).flatMap(hash=>readdirSync(join(cache,hash)).filter(name=>name==='json-20250517.jar').map(name=>join(cache,hash,name)))[0]:undefined;
const jsonJar=process.env.ALPHA_JSON_JAR||cached;
test('native notifications restore only an existing verified machine owner',()=>{
 assert.ok(jsonJar,'Pinned JVM JSON dependency required; no skipped authority proof');
 const root=resolve(import.meta.dirname,'..'),temporary=mkdtempSync(join(tmpdir(),'native-notification-session-'));
 const java=process.env.JAVA_HOME||(process.platform==='darwin'?'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home':'');const binary=name=>java?join(java,'bin',name):name;
 const base=join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone');
 try{
  execFileSync(binary('javac'),['--release','11','-cp',jsonJar,'-d',temporary,join(root,'vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/connection/SecureSlotPolicy.java'),...['CloudDeployment','RendererCredentialSlots','ResidentResultTransport','ResidentResultSession','HostedInbox','HostedResultNotices','HostedStorageFault','NativeNotificationSession'].map(name=>join(base,name+'.java')),...noticeSources(prepareNativeFixture(root,temporary).root,'NoticeOwner'),join(root,'test/fixtures/NativeNotificationSessionTest.java')],{timeout:30000,stdio:'pipe'});
  assert.match(execFileSync(binary('java'),['-cp',temporary+':'+jsonJar,'ai.elizaresearch.alphaphone.NativeNotificationSessionTest'],{encoding:'utf8',timeout:30000,stdio:'pipe'}),/^PASS NativeNotificationSession:/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
