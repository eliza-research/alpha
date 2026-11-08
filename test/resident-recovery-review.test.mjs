import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const directory=join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone');
test('native recovery confirmation is single-use and bound to the original owner scope',()=>{
 const temp=mkdtempSync(join(tmpdir(),'alpha-recovery-review-'));
 try{
  writeFileSync(join(temp,'RecoveryReviewTest.java'),`package ai.elizaresearch.alphaphone;
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
  const java=process.env.JAVA_HOME;assert.ok(java,'Use the canonical JDK environment');
  execFileSync(join(java,'bin/javac'),['-d',temp,join(directory,'ResidentRecoveryReview.java'),join(temp,'RecoveryReviewTest.java')]);
  assert.match(execFileSync(join(java,'bin/java'),['-cp',temp,'ai.elizaresearch.alphaphone.RecoveryReviewTest'],{encoding:'utf8'}),/PASS original scope/);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
test('plugin binds actual native review within its authority and consumes scope before archive',()=>{
 const source=readFileSync(join(directory,'AlphaLocalAgentPlugin.java'),'utf8');
 const start=source.indexOf('ElizaAgentService.RecoveryAuthority authority=');
 const authority=source.slice(start,source.indexOf('JSONObject result=archive?ElizaAgentService.',start));
 assert.ok(authority.indexOf('recoveryReview.consume(token,lifecycleEpoch,credentialIntents.current())')<authority.indexOf('JSONObject result=operation.run()'));
 assert.match(authority,/if\(!archive&&"reviewable"\.equals\(result\.optString\("status"\)\)\)recoveryReview\.bind\(result\.getString\("reviewToken"\),lifecycleEpoch,credentialIntents\.current\(\)\)/);
 assert.match(source,/private void invalidateOwnCalls\(\)\{\s*recoveryReview\.clear\(\)/);
 assert.match(source,/if\(!archive\)recoveryReview\.clear\(\)/);
});
