import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {CloudSignInError, signInFailureMessage} from '../apps/app/src/runtime/cloud-sign-in.ts';

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
 assert.match(messages[0],/another network/);
 assert.match(messages[2],/too long/);
 assert.match(messages[3],/date and time/);
});
