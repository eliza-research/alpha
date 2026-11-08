import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {runJvm,sharedSpeechSource} from './fixtures/jvm-tools.mjs';
const source=fs.readFileSync(process.env.ALPHA_SPEECH_HANDOFF_SOURCE||sharedSpeechSource('SpeechStreamBridgePlugin.java'),'utf8');
function method(needle){const begin=source.indexOf(needle);assert.ok(begin>=0,needle);let at=source.indexOf('{',begin),end=at+1,depth=1;for(;depth;end++){if(source[end]==='{')depth++;else if(source[end]==='}')depth--;}return source.slice(begin,end);}
// Execute the real start path through session publication and deadline scheduling. The network
// submission after that boundary is excluded; this fixture never requests consent, audio or a provider.
const start=method('private void start('),submission=start.indexOf('  submit(control,');assert.ok(submission>0);
const startPrefix=start.slice(0,submission)+' }';
const destroy=method('protected void handleOnDestroy('),cleanup=destroy.indexOf('if(own!=null)');assert.ok(cleanup>0);
const destroyPrefix=destroy.slice(0,cleanup)+' }';
test('permission startup and Stop atomically transfer pending ownership across authority lookup',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-permission-handoff-'));
 try{
 const file=path.join(dir,'PermissionHandoff.java');
 fs.writeFileSync(file,`import java.util.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;
 public class PermissionHandoff {
  static class PluginCall{final String id;volatile int rejects,resolves;PluginCall(String id){this.id=id;}String getString(String key){return key.equals("sessionId")?id:key.equals("environment")?"production":"credential";}void reject(String...message){rejects++;}void resolve(){resolves++;}}
  enum PermissionState{GRANTED,DENIED}
  static class Handler{final Queue<Runnable> queue=new ConcurrentLinkedQueue<>();void post(Runnable r){queue.add(r);}void run(){for(Runnable r;(r=queue.poll())!=null;)r.run();}}
  final Handler main=new Handler();volatile PluginCall permissionCall;volatile Session session;volatile boolean destroyed,foreground=true;PermissionState permission=PermissionState.DENIED;
  final CountDownLatch authorityEntered=new CountDownLatch(1),authorityRelease=new CountDownLatch(1);volatile int published;volatile boolean authorityUnderMonitor,failAuthority;
  long authorityEpoch(){authorityUnderMonitor=Thread.holdsLock(this);authorityEntered.countDown();try{if(!authorityRelease.await(2,TimeUnit.SECONDS))throw new AssertionError("authority barrier timed out");}catch(InterruptedException e){throw new AssertionError(e);}if(failAuthority)throw new SecurityException("authority unavailable");return 1;}
  PermissionState getPermissionState(String s){return permission;}boolean launch(PluginCall c,Runnable r){r.run();return true;}void requestPermissionForAlias(String a,PluginCall c,String callback){}
  final class Session{final String id;Session(String i,String e,String c,long n,PluginCall call){id=i;}void scheduleStartupDeadline(){published++;}}
  void mark(Session s,String stage){}void detach(Session s){synchronized(this){if(session==s)session=null;}}void queueCleanup(Session s,Runnable done){done.run();}
  ${method('public void startCloudSpeech(')} ${method('private void microphoneReady(')} ${startPrefix} ${method('public void stopCloudSpeech(')} ${method('private Session owned(')} ${destroyPrefix}
  static void check(boolean x,String s){if(!x)throw new AssertionError(s);}
  static final String FIRST="11111111-1111-4111-8111-111111111111",NEXT="22222222-2222-4222-8222-222222222222";
  public static void main(String[]args)throws Exception{
   for(String action:new String[]{"stop","unrelated-stop","replacement","destroy","background","authority-failure"}){
    PermissionHandoff f=new PermissionHandoff();PluginCall start=new PluginCall(FIRST);f.startCloudSpeech(start);check(f.permissionCall==start,"missing pending owner");f.permission=PermissionState.GRANTED;f.microphoneReady(start);
    AtomicReference<Throwable> error=new AtomicReference<>();Thread ui=new Thread(()->{try{f.main.run();}catch(Throwable t){error.set(t);}},"AndroidMain");ui.start();check(f.authorityEntered.await(1,TimeUnit.SECONDS),"authority was not entered");
    PluginCall stop=new PluginCall(action.equals("unrelated-stop")?NEXT:FIRST),replacement=new PluginCall(NEXT);
    Thread plugin=new Thread(()->{
     if(action.equals("stop")||action.equals("replacement")||action.equals("unrelated-stop"))f.stopCloudSpeech(stop);
     if(action.equals("replacement")){f.permission=PermissionState.DENIED;f.startCloudSpeech(replacement);}
     if(action.equals("destroy"))f.handleOnDestroy();if(action.equals("background"))f.foreground=false;if(action.equals("authority-failure"))f.failAuthority=true;
    },"CapacitorPlugins");plugin.start();plugin.join(1000);check(!plugin.isAlive(),"Stop blocked behind authority: "+action);
    if(action.contains("stop")||action.equals("replacement"))check(stop.resolves==1,"Stop did not resolve");
    f.authorityRelease.countDown();ui.join(1000);check(!ui.isAlive(),"main did not finish");if(error.get()!=null)throw new AssertionError(error.get());check(!f.authorityUnderMonitor,"this monitor held across authority");
    if(action.equals("unrelated-stop")){check(f.session!=null&&f.published==1&&start.rejects==0,"unrelated Stop stole owner");}
    else{check(f.session==null&&f.published==0,"start published after "+action);check(start.rejects==1,"cancelled start not rejected once: "+action);}
    if(action.equals("replacement")){check(f.permissionCall==replacement&&replacement.rejects==0,"old start retired replacement");f.permission=PermissionState.GRANTED;f.microphoneReady(replacement);f.main.run();check(f.session!=null&&f.session.id.equals(NEXT)&&f.published==1,"replacement cannot start");}
   }
   PermissionHandoff direct=new PermissionHandoff();direct.permission=PermissionState.GRANTED;direct.authorityRelease.countDown();direct.startCloudSpeech(new PluginCall(FIRST));check(direct.session!=null&&direct.published==1,"granted direct start regressed");
   System.out.println("PASS atomic permission handoff: Stop, unrelated Stop, replacement, Destroy, foreground, authority failure and granted start");
  }
 }`);
 assert.match(runJvm([file],'PermissionHandoff'),/^PASS atomic permission handoff/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
