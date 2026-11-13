import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {javaBinary} from './fixtures/jvm-tools.mjs';
const root=resolve(import.meta.dirname,'..');
test('native scoped deletion identity cannot widen an occurrence or legacy event into a series',()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-calendar-delete-id-'));
 try{
  const file=join(dir,'IdentityTest.java');writeFileSync(file,`package ai.alphacompute.alphaphone;
public final class IdentityTest {
 static void check(boolean value){if(!value)throw new AssertionError();}
 static void refuses(Runnable action){try{action.run();throw new AssertionError("Expected refusal");}catch(IllegalArgumentException expected){}}
 public static void main(String[] args){
  CalendarDeletionIdentity legacy=CalendarDeletionIdentity.parse("42");legacy.requireProviderShape(false);refuses(()->legacy.requireProviderShape(true));check(legacy.legacy);
  for(String id:new String[]{"delete2:42:event","delete2:42:series","delete2:42:occurrence:0","delete2:42:occurrence:1791766800000"}){
   CalendarDeletionIdentity parsed=CalendarDeletionIdentity.parse(id);check(id.equals(parsed.encoded()));check(parsed.eventId==42&&!parsed.legacy);
   parsed.requireProviderShape(parsed.scope!=CalendarDeletionIdentity.Scope.EVENT);refuses(()->parsed.requireProviderShape(parsed.scope==CalendarDeletionIdentity.Scope.EVENT));
  }
  CalendarDeletionIdentity first=CalendarDeletionIdentity.parse("delete2:42:occurrence:1791766800000"),next=CalendarDeletionIdentity.parse("delete2:42:occurrence:1791853200000");check(!first.encoded().equals(next.encoded()));check(first.scope!=CalendarDeletionIdentity.parse("delete2:42:series").scope);
  for(String malformed:new String[]{"", "0", "042", "-1", "+1", "42 ", "delete2:42", "delete2:42:event:0", "delete2:42:series:0", "delete2:42:occurrence", "delete2:42:occurrence:-1", "delete2:42:occurrence:01", "delete2:42:occurrence:9223372036854775808", "delete2:9223372036854775808:event", "delete2:42:occurrence:1:series", "delete3:42:event", "DELETE2:42:event", "delete2:42:all", "delete2:42:occurrence:NaN"})refuses(()->CalendarDeletionIdentity.parse(malformed));
  System.out.println("PASS exact scoped Calendar deletion identities");
 }
}`);
  execFileSync(javaBinary('javac'),['--release','11','-d',dir,join(root,'android/app/src/main/java/ai/alphacompute/alphaphone/CalendarDeletionIdentity.java'),file],{timeout:scaledTimeout(60000)});
  assert.match(execFileSync(javaBinary('java'),['-cp',dir,'ai.alphacompute.alphaphone.IdentityTest'],{encoding:'utf8',timeout:scaledTimeout(10000)}),/PASS exact scoped/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
