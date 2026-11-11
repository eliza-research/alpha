import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {CloudSignInError, signInFailureMessage} from '../apps/app/src/runtime/cloud-sign-in.ts';

test('shared native sign-in classifies transport failures and cancellation without exception text', () => {
 const dir=mkdtempSync(join(tmpdir(),'alpha-signin-network-'));
 const source=readFileSync('vendor/eliza/packages/auth/android/src/main/java/ai/eliza/auth/cloud/CloudSignInPlugin.java','utf8');
 const start=source.indexOf('  } catch (java.net.UnknownHostException');
 const end=source.indexOf('  } finally {',start);
 assert.ok(start>=0&&end>start,'actual shared transport failure handlers are present');
 const handlers=source.slice(start,end);
 const binary=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;
 try {
  writeFileSync(join(dir,'NetworkTest.java'),`public class NetworkTest {
 static class Attempt { boolean cancelled; }
 static class SignInFailure extends Exception { SignInFailure(String code) { super(code); } }
 static void classify(java.io.IOException error, Attempt current) throws SignInFailure {
  try { throw error;
${handlers}
  }
 }
 static void check(java.io.IOException error, String expected) throws Exception {
  for (boolean cancelled : new boolean[]{false,true}) {
   Attempt current = new Attempt(); current.cancelled = cancelled;
   try { classify(error,current); throw new AssertionError("failure expected"); }
   catch (SignInFailure failure) {
    if (!(cancelled ? "cancelled" : expected).equals(failure.getMessage())) throw new AssertionError(failure.getMessage());
   }
  }
 }
 public static void main(String[] args) throws Exception {
  check(new java.net.UnknownHostException("private details"), "offline");
  check(new java.net.ConnectException("private details"), "offline");
  check(new java.net.NoRouteToHostException("private details"), "offline");
  check(new java.net.SocketTimeoutException("private details"), "unavailable");
  check(new javax.net.ssl.SSLHandshakeException("private details"), "unavailable");
  check(new java.io.IOException("private details"), "unavailable");
  System.out.println("PASS");
 }
}`);
  execFileSync(binary('javac'),['--release','11','-d',dir,join(dir,'NetworkTest.java')],{timeout:60000});
  assert.equal(execFileSync(binary('java'),['-cp',dir,'NetworkTest'],{encoding:'utf8',timeout:60000}).trim(),'PASS');
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('the renderer accepts shared transport codes and refuses unknown codes without displaying server text', () => {
 const messages=[];
 for(const code of ['offline','unavailable']) {
  const error=CloudSignInError.from({code,message:'private details'});
  assert.equal(error.code,code);
  const message=signInFailureMessage(error.code,'Eliza Cloud');
  assert.ok(code==='unavailable'?message==='Unavailable':message.includes('Eliza Cloud'));
  assert.ok(!message.includes('private details'));
  messages.push(message);
 }
 assert.equal(new Set(messages).size,2);
 for(const code of ['dns','timeout','secure-connection','private details']) {
  const error=CloudSignInError.from({code,message:'private details'});
  assert.equal(error.code,'unavailable');
  assert.equal(signInFailureMessage(error.code,'Eliza Cloud'),messages[1]);
 }
});
