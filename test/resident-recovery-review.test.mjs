import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {javaBinary} from './fixtures/jvm-tools.mjs';
const root=resolve(import.meta.dirname,'..');
const directory=join(root,'android/app/src/main/java/ai/alphacompute/alphaphone');
test('native recovery confirmation is single-use and bound to the original owner scope',()=>{
 const temp=mkdtempSync(join(tmpdir(),'alpha-recovery-review-'));
 try{
  writeFileSync(join(temp,'RecoveryReviewTest.java'),`package ai.alphacompute.alphaphone;
public class RecoveryReviewTest {
 static void check(boolean value){if(!value)throw new AssertionError();}
 public static void main(String[] args){
  ResidentRecoveryReview review=new ResidentRecoveryReview();
  check(!review.consume("issued",4,7));
  review.bind("issued",4,7);check(review.consume("issued",4,7));check(!review.consume("issued",4,7));
  review.bind("issued",4,7);check(!review.consume("issued",5,7));check(!review.consume("issued",4,7));
  review.bind("issued",4,7);check(!review.consume("issued",4,8));check(!review.consume("issued",4,7));
  review.bind("issued",4,7);check(!review.consume("other",4,7));check(!review.consume("issued",4,7));
  review.bind("issued",4,7);review.clear();check(!review.consume("issued",4,7));
  review.bind("old",4,7);review.bind("new",4,7);check(!review.consume("old",4,7));
  review.bind("new",4,7);check(review.consume("new",4,7));
  System.out.println("PASS original scope, single use, stale epoch, credential intent, token, invalidation and replacement");
 }
}`);
  // JAVA_HOME when set, otherwise the JDK on PATH (test/fixtures/jvm-tools.mjs).
  execFileSync(javaBinary('javac'),['-d',temp,join(directory,'ResidentRecoveryReview.java'),join(temp,'RecoveryReviewTest.java')],{timeout:120000});
  assert.match(execFileSync(javaBinary('java'),['-cp',temp,'ai.alphacompute.alphaphone.RecoveryReviewTest'],{encoding:'utf8',timeout:120000}),/PASS original scope/);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
