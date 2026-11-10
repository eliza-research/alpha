import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeSource,upstreamAgentRuntime,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';

// Plain-JVM run of the rule prepareGoogleWorkspaceReturn applies when its optional identity read fails.
// It does not build an APK, run on Android, or contact Eliza Cloud.
test('a transient identity failure falls back to the manual return; a refusal or a mismatch stops Connect Google',{skip:jsonJarSkip},()=>{
 const root=mkdtempSync(join(tmpdir(),'alpha-workspace-fallback-'));
 try{
  const file=join(root,'WorkspaceFallbackTest.java');
  writeFileSync(file,`package ai.alphacompute.alphaphone;
import ai.eliza.plugins.agent.runtime.NativeProviderAdmission.CloudReadFailure;
public class WorkspaceFallbackTest {
 static int checks;
 static void check(boolean ok,String name){if(!ok)throw new AssertionError(name);checks++;}
 public static void main(String[] args){
  for(int status:new int[]{408,429,500,502,503,504,404})check(GoogleWorkspaceReturnFlow.manualReturn(new CloudReadFailure(status)),"HTTP "+status+" falls back");
  check(GoogleWorkspaceReturnFlow.manualReturn(new java.net.SocketTimeoutException()),"timeout falls back");
  check(GoogleWorkspaceReturnFlow.manualReturn(new java.net.UnknownHostException()),"DNS failure falls back");
  check(GoogleWorkspaceReturnFlow.manualReturn(new org.json.JSONException("bad body")),"unreadable body falls back");
  for(int status:new int[]{401,403})check(!GoogleWorkspaceReturnFlow.manualReturn(new CloudReadFailure(status)),"HTTP "+status+" stops");
  // A 200 that is not a success, an identity mismatch and an expired or invalid key are answers about the account.
  check(!GoogleWorkspaceReturnFlow.manualReturn(new SecurityException("Cloud identity unavailable")),"unsuccessful identity stops");
  check(!GoogleWorkspaceReturnFlow.manualReturn(new SecurityException()),"mismatch stops");
  check(!GoogleWorkspaceReturnFlow.manualReturn(new IllegalArgumentException()),"expired key stops");
  System.out.println("PASS Workspace fallback "+checks);
 }
}`);
  const out=runJvm([nativeSource('GoogleWorkspaceReturn.java'),nativeSource('GoogleWorkspaceReturnFlow.java'),upstreamAgentRuntime('NativeProviderAdmission.java'),file],'ai.alphacompute.alphaphone.WorkspaceFallbackTest',{json:true});
  assert.match(out,/^PASS Workspace fallback 15/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
