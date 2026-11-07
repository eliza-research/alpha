import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {nativeSource,upstreamAgentRuntime,runJvm} from './fixtures/jvm-tools.mjs';

function method(text,start){
 const begin=text.indexOf(start);assert.ok(begin>=0,start);let depth=0;
 for(let i=text.indexOf('{',begin);i<text.length;i++){
  if(text[i]==='{')depth++;
  if(text[i]==='}'&&--depth===0)return text.slice(begin,i+1);
 }
 throw Error('Unclosed method');
}
test('actual credential mutation retains a reserved stop across dispatch failure and never releases an uncertain commit',()=>{
 const source=readFileSync(nativeSource('AlphaLocalAgentPlugin.java'),'utf8');
 const mutate=method(source,'static <T> T mutateCredentials(');
 const commit=method(source,'private static <T> T commitCredentials(');
 const directory=mkdtempSync(join(tmpdir(),'credential-dispatch-'));
 const file=(name,text)=>{const path=join(directory,name);writeFileSync(path,text);return path;};
 try{
  const sources=[upstreamAgentRuntime('CredentialShutdownLease.java'),
   file('JsonCredentialSlots.java','package ai.eliza.plugins.securestore.nativeonly;public class JsonCredentialSlots{public static final Object LOCK=new Object();}'),
   file('SystemClock.java','package android.os;public class SystemClock{public static long elapsedRealtime(){return 0;}}'),
   file('MutationHarness.java',`package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.agent.runtime.CredentialShutdownLease;
public class MutationHarness {
 static class Context{} static class JSONObject{}
 static class Superseded extends Exception{}
 static final Object lifecycleLock=new Object();
 static long lifecycleEpoch,credentialMutationEpoch=-1,credentialShutdownRequest=-1;
 static String startRequestId;static boolean startOwnsLaunch,accepting=true,stopping;
 static class AlphaCanonicalNotifications{static void forget(Context c){}}
 static class Owner{void invalidate(){}} static Owner INVOCATION_OWNER=new Owner();
 static void invalidateCalls(){} static void clearEnrollment(){}
 static boolean shutdownConfirmed(JSONObject value){return true;}
 interface CredentialMutation<T>{boolean requiresShutdown()throws Exception;T commit()throws Exception;}
 static class ElizaAgentService{
  static CredentialShutdownLease lease;static long reserved;static boolean failDispatch;static int commits;
  static long reserveCredentialShutdown(){return reserved=lease.acquire();}
  static long retryCredentialShutdown(Context c,long id){lease.retry(id);if(failDispatch)throw new IllegalStateException("dispatch");lease.acknowledge(id,true);return id;}
  static long stopForCredentialChange(Context c){long id=reserveCredentialShutdown();retryCredentialShutdown(c,id);return id;}
  static boolean isCredentialShutdownConfirmed(long id){return lease.isConfirmed(id);}
  static boolean abandonCredentialShutdown(long id){return lease.abandon(id);}
  static boolean releaseCredentialShutdown(long id){return lease.release(id);}
  static JSONObject getLocalAgentBootState(Context c){return new JSONObject();}
 }
 ${mutate}
 ${commit}
 static void check(boolean b,String why){if(!b)throw new AssertionError(why);}
 static void reset(){lifecycleEpoch=0;credentialMutationEpoch=-1;credentialShutdownRequest=-1;ElizaAgentService.lease=new CredentialShutdownLease();ElizaAgentService.reserved=-1;ElizaAgentService.failDispatch=false;ElizaAgentService.commits=0;}
 static CredentialMutation<String> mutation(boolean fail){return new CredentialMutation<String>(){
  public boolean requiresShutdown(){return true;}
  public String commit(){ElizaAgentService.commits++;if(fail)throw new IllegalStateException("uncertain write");return "saved";}
 };}
 static void pending(){try{ElizaAgentService.lease.beforeStart();throw new AssertionError("start admitted before proof");}catch(CredentialShutdownLease.Pending expected){}}
 public static void main(String[] args)throws Exception{
  reset();check("saved".equals(mutateCredentials(new Context(),()->{},mutation(false))),"result preserved");
  check(ElizaAgentService.commits==1&&ElizaAgentService.lease.isReleased(ElizaAgentService.reserved),"completed commit releases exact request");
  reset();ElizaAgentService.failDispatch=true;
  try{mutateCredentials(new Context(),()->{},mutation(false));throw new AssertionError("dispatch failure lost");}catch(IllegalStateException expected){}
  check(ElizaAgentService.commits==0,"dispatch failure never commits");
  check(credentialShutdownRequest==ElizaAgentService.reserved,"reserved id retained across dispatch throw");pending();
  ElizaAgentService.lease.acknowledge(ElizaAgentService.reserved,true);
  check(ElizaAgentService.lease.isReleased(ElizaAgentService.reserved),"abandonment releases only after exact late ACK");
  reset();try{mutateCredentials(new Context(),()->{if(ElizaAgentService.reserved>=0)throw new IllegalStateException("cancelled owner");},mutation(false));throw new AssertionError("cancel ignored");}catch(IllegalStateException expected){}
  check(ElizaAgentService.commits==0&&ElizaAgentService.lease.isReleased(ElizaAgentService.reserved),"precommit cancellation abandons known acknowledged request");
  reset();try{mutateCredentials(new Context(),()->{},mutation(true));throw new AssertionError("uncertain failure lost");}catch(IllegalStateException expected){}
  check(ElizaAgentService.commits==1&&!ElizaAgentService.lease.isReleased(ElizaAgentService.reserved),"uncertain commit keeps fence");pending();
  reset();long old=ElizaAgentService.lease.acquire(),newer=ElizaAgentService.lease.acquire();
  check(!ElizaAgentService.lease.abandon(old)&&!ElizaAgentService.lease.release(old),"old owner cannot release successor");
  check(ElizaAgentService.lease.isCurrent(newer),"new request remains current");
  System.out.println("PASS exact mutation dispatch ownership: success, throw-after-reserve, late ACK, cancellation, uncertain commit, successor");
 }
}`)];
  assert.match(runJvm(sources,'ai.elizaresearch.alphaphone.MutationHarness'),/^PASS exact mutation dispatch ownership/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
