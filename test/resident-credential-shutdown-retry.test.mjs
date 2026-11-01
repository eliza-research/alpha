import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const directory=join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone');
const source=readFileSync(join(directory,'AlphaLocalAgentPlugin.java'),'utf8');
import {javaBinary,upstreamAgentRuntime} from './fixtures/jvm-tools.mjs';
// The agent-runtime intent fence delegates to the shared secure-store fence since elizaOS/eliza#38281.
const intentFence=[upstreamAgentRuntime('CredentialIntentFence.java'),join(root,'vendor/eliza/plugins/plugin-native-secure-store/android/src/main/java/ai/eliza/plugins/securestore/nativeonly/CredentialIntentFence.java')];
test('strict shutdown retry requires exact current acknowledgment plus absence and current owner',()=>{
 const temporary=mkdtempSync(join(tmpdir(),'credential-shutdown-retry-'));
 try{
  const start=source.indexOf(' private void requireShutdownRetry('),end=source.indexOf('\n @PluginMethod public void start(',start);
  assert.ok(start>=0&&end>start);
  const actualGuard=source.slice(start,end);
  const retryStart=source.indexOf('private boolean retryCredentialShutdown(');
  const admissionStart=source.indexOf('synchronized(lifecycleLock){',retryStart)+'synchronized(lifecycleLock){'.length;
  const admissionEnd=source.indexOf('if(disposed||getActivity()',admissionStart);
  const actualAdmission=source.slice(admissionStart,admissionEnd);
  writeFileSync(join(temporary,'RetryGuardHarness.java'),`package ai.elizaresearch.alphaphone;
import java.util.*;
import ai.eliza.plugins.agent.runtime.CredentialIntentFence;
public class RetryGuardHarness {
 static CredentialIntentFence fenceAt(long intent){CredentialIntentFence fence=new CredentialIntentFence();while(fence.current()<intent)fence.reserve();return fence;}
 static class Superseded extends Exception {}
 static class PluginCall {int rejected;void reject(String message){rejected++;}}
 static class ElizaAgentService {static boolean confirmed;static boolean isCredentialShutdownConfirmed(long request){return confirmed;}}
 long credentialShutdownRequest=10;
 static class Activity {boolean focus=true;boolean hasWindowFocus(){return focus;}}
 boolean disposed,stopping;CredentialIntentFence credentialIntents=fenceAt(4);long lifecycleEpoch=8,credentialShutdownRetryEpoch=8,credentialMutationEpoch=-1;
 final Set<PluginCall> pending=new HashSet<>(); final Activity activity=new Activity(); Activity getActivity(){return activity;}
 boolean admission(PluginCall call){${actualAdmission}return false;}
 ${actualGuard}
 static void checkAdmission(boolean ok,String why){if(!ok)throw new AssertionError(why);}
 void mustReject(PluginCall call)throws Exception {try{requireShutdownRetry(call,8,4);throw new AssertionError("stale retry accepted");}catch(Superseded expected){}}
 public static void main(String[] args)throws Exception {
 RetryGuardHarness h=new RetryGuardHarness();PluginCall call=new PluginCall();h.pending.add(call);h.requireShutdownRetry(call,8,4);
 h.credentialIntents.reserve();h.mustReject(call);h.credentialIntents=fenceAt(4);
 h.lifecycleEpoch++;h.mustReject(call);h.lifecycleEpoch--;
 h.credentialShutdownRetryEpoch++;h.mustReject(call);h.credentialShutdownRetryEpoch--;
 h.credentialMutationEpoch=8;h.mustReject(call);h.credentialMutationEpoch=-1;
 h.pending.clear();h.mustReject(call);h.pending.add(call);
 h.activity.focus=false;h.mustReject(call);h.activity.focus=true;
 h.disposed=true;h.mustReject(call);
 RetryGuardHarness race=new RetryGuardHarness();PluginCall second=new PluginCall();ElizaAgentService.confirmed=true;
 checkAdmission(race.admission(second)&&second.rejected==1,"inflight retry cannot bypass on early service acknowledgment");
 race.credentialShutdownRetryEpoch=-1;checkAdmission(!race.admission(new PluginCall()),"finished confirmed request may continue");
 race.credentialShutdownRequest=-1;race.credentialShutdownRetryEpoch=8;checkAdmission(race.admission(new PluginCall()),"inflight retry wins even after request fence publication");
 System.out.println("PASS actual plugin retry owner guard: account intent, lifecycle cancel, request owner, mutation, pending call, foreground, disposal");
 }
}`);
  execFileSync(javaBinary('javac'),['-d',temporary,...intentFence,join(directory,'ResidentCredentialShutdownRetry.java'),join(root,'test/fixtures/ResidentCredentialShutdownRetryTest.java'),join(temporary,'RetryGuardHarness.java')]);
  assert.match(execFileSync(javaBinary('java'),['-cp',temporary,'ai.elizaresearch.alphaphone.ResidentCredentialShutdownRetryTest'],{encoding:'utf8'}),/PASS strict retry/);
  assert.match(execFileSync(javaBinary('java'),['-cp',temporary,'ai.elizaresearch.alphaphone.RetryGuardHarness'],{encoding:'utf8'}),/PASS actual plugin retry owner guard/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
test('actual asynchronous retry transition dispatches only after strict proof and current continuation',()=>{
 const temporary=mkdtempSync(join(tmpdir(),'credential-retry-transition-'));
 try{
  const methodStart=source.indexOf(' private boolean retryCredentialShutdown('),methodEnd=source.indexOf('\n @PluginMethod public void start(',methodStart);
  const methods=source.slice(methodStart,methodEnd);
  const guardStart=source.indexOf('     if(continuationEpoch>=0&&(continuationEpoch!=lifecycleEpoch');
  const guardEnd=source.indexOf('     if(requestId!=null&&cancelledStarts.remove',guardStart);
  const continuationGuards=source.slice(guardStart,guardEnd);
  writeFileSync(join(temporary,'SystemClock.java'),`package android.os;public class SystemClock {static long time;public static long elapsedRealtime(){return time+=2000;}}`);
  writeFileSync(join(temporary,'RetryTransitionHarness.java'),`package ai.elizaresearch.alphaphone;
import java.util.*;
import ai.eliza.plugins.agent.runtime.CredentialIntentFence;
public class RetryTransitionHarness {
 static class Superseded extends Exception {}
 static class PluginCall {int rejected;void reject(String message){rejected++;}}
 static class Activity {boolean focus=true;boolean hasWindowFocus(){return focus;}}
 static class Context {}
 static final Object lifecycleLock=new Object(),workers=new Object();
 static long credentialShutdownRequest=1,credentialShutdownRetryEpoch=-1,lifecycleEpoch=0,credentialMutationEpoch=-1;static CredentialIntentFence credentialIntents=new CredentialIntentFence(lifecycleLock);
 static boolean accepting=false,stopping=true;static String startRequestId;static long startRequestEpoch;static boolean startOwnsLaunch;
 boolean disposed;int dispatched;Activity activity=new Activity();final Set<PluginCall> pending=new HashSet<>();final Set<String> cancelledStarts=new HashSet<>();
 Activity getActivity(){return activity;}Context getContext(){return new Context();}void invalidateCalls(){for(PluginCall c:pending)c.reject("superseded");pending.clear();}void clearEnrollment(){}
 boolean shutdownConfirmed(boolean value){return value;}
 static class PluginWorkers {static ArrayDeque<Runnable> queue=new ArrayDeque<>();static void submit(Object worker,Runnable action,Runnable rejected){queue.add(action);}}
 static class ElizaAgentService {
 static int stops,probes,confirmChecks;static long epoch=1;static boolean confirmed,absent=true,failDispatch;static Runnable onProbe=()->{},onFourthConfirmation=()->{};
 static long abandoned=-1;
 static long reserveCredentialShutdown(){return ++epoch;}
 static long retryCredentialShutdown(Context context,long request){check(request==epoch,"only current request dispatches");stops++;if(failDispatch)throw new IllegalStateException();return request;}
 static boolean abandonCredentialShutdown(long request){abandoned=request;return request==epoch;}
 static boolean isCredentialShutdownConfirmed(long epoch){confirmChecks++;if(confirmChecks==4)onFourthConfirmation.run();return epoch==ElizaAgentService.epoch&&confirmed;}
 static boolean getLocalAgentBootState(Context context){probes++;onProbe.run();return absent;}
 }
 ${methods}
 private void startAfterShutdown(PluginCall call,long continuationEpoch,long continuationIntent){
 synchronized(lifecycleLock){${continuationGuards}dispatched++;}
 }
 static void check(boolean value,String why){if(!value)throw new AssertionError(why);}
 static RetryTransitionHarness fresh(){credentialShutdownRequest=1;credentialShutdownRetryEpoch=-1;lifecycleEpoch=0;credentialIntents=new CredentialIntentFence(lifecycleLock);credentialMutationEpoch=-1;PluginWorkers.queue.clear();ElizaAgentService.epoch=1;ElizaAgentService.abandoned=-1;ElizaAgentService.stops=0;ElizaAgentService.probes=0;ElizaAgentService.confirmChecks=0;ElizaAgentService.confirmed=false;ElizaAgentService.absent=true;ElizaAgentService.failDispatch=false;ElizaAgentService.onProbe=()->{};ElizaAgentService.onFourthConfirmation=()->{};return new RetryTransitionHarness();}
 static void run(){PluginWorkers.queue.remove().run();}
 public static void main(String[] args){
 RetryTransitionHarness h=fresh();credentialShutdownRequest=-1;stopping=true;PluginCall ordinary=new PluginCall();check(h.retryCredentialShutdown(ordinary,"ordinary-stop"),"ordinary STOPPING must admit one explicit strict stop recheck");check(PluginWorkers.queue.size()==1&&h.dispatched==0,"ordinary retry queues no start before proof");ElizaAgentService.onProbe=()->ElizaAgentService.confirmed=true;run();check(h.dispatched==1&&ElizaAgentService.stops==1&&!stopping&&credentialShutdownRequest==-1,"fresh exact acknowledgment and absence settle ordinary stop before requested continuation");
 h=fresh();credentialShutdownRequest=-1;stopping=true;ordinary=new PluginCall();check(h.retryCredentialShutdown(ordinary,"ordinary-unknown"),"unknown ordinary stop remains retryable");run();check(h.dispatched==0&&ordinary.rejected==1&&stopping&&credentialShutdownRequest!=-1,"closed socket without exact inventory acknowledgment cannot settle ordinary stop");
 PluginCall recovered=new PluginCall();check(h.retryCredentialShutdown(recovered,"ordinary-explicit-retry"),"a later explicit request may recheck the retained stop");ElizaAgentService.onProbe=()->ElizaAgentService.confirmed=true;run();check(h.dispatched==1&&ElizaAgentService.stops==2&&!stopping,"fresh proof on the next explicit request recovers the ordinary stop without replay");
 h=fresh();credentialShutdownRequest=-1;stopping=true;ElizaAgentService.absent=false;ElizaAgentService.confirmed=true;ordinary=new PluginCall();check(h.retryCredentialShutdown(ordinary,"ordinary-live"),"live ordinary stop reserves check only");run();check(h.dispatched==0&&ordinary.rejected==1&&stopping,"live service or socket remains refused despite an acknowledgment");
 h=fresh();credentialShutdownRequest=-1;stopping=false;ordinary=new PluginCall();check(!h.retryCredentialShutdown(ordinary,"normal-start")&&PluginWorkers.queue.isEmpty(),"ordinary nonstopping start adds no teardown");
 h=fresh();credentialShutdownRequest=-1;stopping=true;h.activity.focus=false;ordinary=new PluginCall();check(h.retryCredentialShutdown(ordinary,"background")&&ordinary.rejected==1&&PluginWorkers.queue.isEmpty(),"background retry cannot dispatch a stop or start");
 h=fresh();PluginCall first=new PluginCall(),second=new PluginCall();check(h.retryCredentialShutdown(first,"first"),"fenced start reserves retry");ElizaAgentService.confirmed=true;check(h.retryCredentialShutdown(second,"second")&&second.rejected==1,"second start blocked while first inflight");run();check(h.dispatched==1&&ElizaAgentService.stops==1&&credentialShutdownRequest==-1,"one confirmed stop permits one start");check(ElizaAgentService.abandoned==ElizaAgentService.epoch,"a retry commits nothing: it abandons exactly its own service lease");
 h=fresh();first=new PluginCall();h.retryCredentialShutdown(first,"unknown");run();check(h.dispatched==0&&first.rejected==1&&credentialShutdownRequest!=-1,"unknown owner preserves fence");
 first=new PluginCall();h.retryCredentialShutdown(first,"retry-again");ElizaAgentService.onProbe=()->ElizaAgentService.confirmed=true;run();check(h.dispatched==1&&ElizaAgentService.stops==2&&ElizaAgentService.epoch==3,"a later explicit Retry obtains a fresh strict stop epoch");
 h=fresh();first=new PluginCall();h.retryCredentialShutdown(first,"transient");ElizaAgentService.onProbe=()->{if(ElizaAgentService.probes==2)ElizaAgentService.confirmed=true;};run();check(h.dispatched==1&&ElizaAgentService.probes>=2,"later strict proof recovers transient failure");
 h=fresh();first=new PluginCall();h.retryCredentialShutdown(first,"cancel");ElizaAgentService.confirmed=true;ElizaAgentService.onProbe=()->lifecycleEpoch++;run();check(h.dispatched==0&&credentialShutdownRequest!=-1,"canceled observation cannot start");
 h=fresh();first=new PluginCall();h.retryCredentialShutdown(first,"account");ElizaAgentService.confirmed=true;ElizaAgentService.onFourthConfirmation=()->credentialIntents.reserve();run();check(h.dispatched==0,"account intent after proof is fenced by actual continuation guard");
 h=fresh();first=new PluginCall();h.retryCredentialShutdown(first,"focus");ElizaAgentService.confirmed=true;final RetryTransitionHarness focused=h;ElizaAgentService.onFourthConfirmation=()->focused.activity.focus=false;run();check(h.dispatched==0,"lost focus after proof cannot start");
 h=fresh();first=new PluginCall();h.retryCredentialShutdown(first,"dispatch");ElizaAgentService.failDispatch=true;run();check(h.dispatched==0&&first.rejected==1&&credentialShutdownRequest==ElizaAgentService.epoch&&ElizaAgentService.abandoned==ElizaAgentService.epoch,"dispatch failure abandons exactly its reserved no-commit request without starting");
 System.out.println("PASS actual retry transition: serial admission, strict stop count, unknown owner, transient recovery, cancel, post-proof account/focus, uncertain dispatch");
 }
}`);
  execFileSync(javaBinary('javac'),['-d',temporary,...intentFence,join(directory,'ResidentCredentialShutdownRetry.java'),join(temporary,'SystemClock.java'),join(temporary,'RetryTransitionHarness.java')]);
  assert.match(execFileSync(javaBinary('java'),['-cp',temporary,'ai.elizaresearch.alphaphone.RetryTransitionHarness'],{encoding:'utf8',timeout:30000}),/PASS actual retry transition/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
