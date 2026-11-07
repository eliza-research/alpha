import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {CloudSignInError, SIGN_IN_RESEND_FAILED, SIGN_IN_WAITING, signInFailureMessage} from '../apps/app/src/runtime/cloud-sign-in.ts';

test('native sign-in distinguishes DNS, connection, timeout and TLS without exposing exception text', () => {
 const dir=mkdtempSync(join(tmpdir(),'alpha-signin-network-'));
 const source=resolve('android/app/src/main/java/ai/elizaresearch/alphaphone');
 const binary=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;
 try {
  writeFileSync(join(dir,'NetworkTest.java'),`package ai.elizaresearch.alphaphone;
public class NetworkTest {
 static void check(java.io.IOException error, String expected) {
  if (!expected.equals(CloudSignInFlow.failureForTransport(error, false))) throw new AssertionError(expected);
  if (!"cancelled".equals(CloudSignInFlow.failureForTransport(error, true))) throw new AssertionError("cancelled");
 }
 public static void main(String[] args) {
  check(new java.net.UnknownHostException("private details"), "dns");
  check(new java.net.ConnectException("private details"), "offline");
  check(new java.net.NoRouteToHostException("private details"), "offline");
  check(new java.net.SocketTimeoutException("private details"), "timeout");
  check(new javax.net.ssl.SSLHandshakeException("private details"), "secure-connection");
  check(new java.io.IOException("private details"), "unavailable");
  System.out.println("PASS");
 }
}`);
  execFileSync(binary('javac'),['--release','11','-d',dir,join(source,'CloudDeployment.java'),join(source,'CloudSignInFlow.java'),join(dir,'NetworkTest.java')],{timeout:60000});
  assert.equal(execFileSync(binary('java'),['-cp',dir,'ai.elizaresearch.alphaphone.NetworkTest'],{encoding:'utf8',timeout:60000}).trim(),'PASS');
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('transport failures survive the native bridge and have distinct recovery instructions', () => {
 const messages=[];
 for(const code of ['dns','offline','timeout','secure-connection']) {
  const error=CloudSignInError.from({code,message:'private details'});
  assert.equal(error.code,code);
  const message=signInFailureMessage(error.code,'Eliza Cloud');
  assert.ok(message.includes('Eliza Cloud'));
  assert.ok(!message.includes('private details'));
  messages.push(message);
 }
 assert.equal(new Set(messages).size,4);
 assert.match(messages[0],/Could not find/);
 assert.match(messages[1],/could not reach/);
 assert.match(messages[2],/too long/);
 // No retry is scheduled for a secure-connection failure, so the copy promises none.
 assert.match(messages[3],/date and time, then try again\.$/);assert.doesNotMatch(messages[3],/will try again/);
 // Verify keeps the code step on a transport failure, so the owner re-enters the code there.
 for(const message of messages.slice(0,3))assert.match(message,/enter the code again\.$/i);
 // The method choice shows a wait instead, and a Resend that never reached Cloud says no code went out.
 assert.equal(SIGN_IN_WAITING,'Waiting for connection');
 assert.equal(SIGN_IN_RESEND_FAILED,'Couldn’t send a new code. Check your connection.');
 for(const message of messages)assert.notEqual(message,SIGN_IN_RESEND_FAILED);
});

test('sign-in copy is short and never narrates what the owner just did', () => {
 for(const code of ['cancelled','browser-closed'])assert.equal(signInFailureMessage(code,'Eliza Cloud'),'');
 assert.equal(signInFailureMessage('invalid-code','Eliza Cloud'),'That code didn’t work. Check it, or resend.');
 for(const code of ['account-check','state-mismatch','rejected','invalid-request','storage','browser-unavailable','provider-refused','mfa-browser','mfa-unsupported'])
  assert.doesNotMatch(signInFailureMessage(code,'Eliza Cloud'),/Eliza Cloud|Cloud support|in Alpha/,code);
});
