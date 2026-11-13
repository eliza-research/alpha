// P-14 background Gmail check: behaviour is the shared plugin-native-notifications MailBackgroundDelivery
// (JVM-tested upstream) and @elizaos/plugin-inbox/mailbox createMailBackground. Alpha keeps only its
// installed identifiers. These are migration-sensitive: installed phones hold the encrypted slot, posted
// notices carry the tag/route prefixes, and the channel holds the owner's Android notification choices.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {mkdtempSync,rmSync} from 'node:fs';
import {jsonJar,javaBinary} from './fixtures/jvm-tools.mjs';

const root=resolve(import.meta.dirname,'..');

// The shared engine and delivery are exercised at the pin, against the real projected sources.
test('the pinned shared reconciliation and delivery pass their JVM checks',()=>{
 assert.ok(jsonJar,'Pinned JVM JSON dependency required');
 const plugin=join(root,'vendor/eliza/plugins/plugin-native-notifications'),sources=join(plugin,'android/src/main/java/ai/eliza/plugins/notifications'),tests=join(plugin,'test/native-host');
 const temporary=mkdtempSync(join(tmpdir(),'gmail-background-'));
 try{
  execFileSync(javaBinary('javac'),['--release','17','-cp',jsonJar,'-d',temporary,join(sources,'MailHistoryReconciliation.java'),join(sources,'MailBackgroundDelivery.java'),join(tests,'MailHistoryReconciliationTest.java'),join(tests,'MailBackgroundDeliveryTest.java')],{timeout:60000});
  const run=main=>execFileSync(javaBinary('java'),['-cp',temporary+':'+jsonJar,main],{encoding:'utf8',timeout:60000});
  assert.match(run('MailHistoryReconciliationTest'),/^PASS mail durable/);
  assert.match(run('MailBackgroundDeliveryTest'),/^\d+ assertions passed/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
