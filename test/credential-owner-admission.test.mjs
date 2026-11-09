import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeSource, root, runJvm, upstreamAgentRuntime, upstreamConnection} from './fixtures/jvm-tools.mjs';

function method(source, signature) {
 const start=source.indexOf(signature);
 assert.ok(start>=0, signature);
 let depth=0;
 for(let index=source.indexOf('{',start);index<source.length;index++){
  if(source[index]==='{')depth++;
  if(source[index]==='}'&&--depth===0)return source.slice(start,index+1);
 }
 throw new Error('Unclosed Java method');
}

test('closed and concurrently retired connection owners cannot supersede credential intent',()=>{
 const local=readFileSync(nativeSource('AlphaLocalAgentPlugin.java'),'utf8');
 const connection=readFileSync(nativeSource('AlphaConnectionPlugin.java'),'utf8');
 const reserve=method(local,'static long reserveCredentialIntent(Object ownerLock,Runnable assertOwner)');
 const admission=method(connection,'private long credentialIntent(String name)');
 const destroy=method(connection,'@Override protected void handleOnDestroy()');
 const directory=mkdtempSync(join(tmpdir(),'alpha-credential-owner-'));
 const file=(name,source)=>{const path=join(directory,name);writeFileSync(path,source);return path;};
 try{
  const sources=[
   upstreamAgentRuntime('CredentialIntentFence.java'),
   join(root,'vendor/eliza/plugins/plugin-native-secure-store/android-nativeonly/src/main/java/ai/eliza/plugins/securestore/nativeonly/CredentialIntentFence.java'),
   upstreamConnection('SecureSlotPolicy.java'),nativeSource('RendererCredentialSlots.java'),
   file('OwnerAdmissionTest.java',`package ai.alphacompute.alphaphone;
import java.util.concurrent.atomic.AtomicReference;
import ai.eliza.plugins.agent.runtime.CredentialIntentFence;
final class AlphaLocalAgentPlugin {
 static final Object lifecycleLock=new Object();
 static final CredentialIntentFence credentialIntents=new CredentialIntentFence(lifecycleLock);
 ${reserve}
}
class Parent {protected void handleOnDestroy(){}}
final class QuietPort {void cancelAll(){}void close(){}void shutdownNow(){}}
final class Connection extends Parent {
 final Object foregroundLock=new Object();volatile boolean destroyed;
 final QuietPort requests=new QuietPort(),storageTasks=new QuietPort(),workers=new QuietPort();
 ${admission}
 ${destroy}
 long reserve(String slot){return credentialIntent(slot);}
}
public final class OwnerAdmissionTest {
 static void check(boolean condition,String reason){if(!condition)throw new AssertionError(reason);}
 static long current(){return AlphaLocalAgentPlugin.credentialIntents.current();}
 static void rejected(Connection owner,String slot){
  long before=current();
  try{owner.reserve(slot);throw new AssertionError("Retired owner admitted");}catch(IllegalStateException expected){}
  check(current()==before,"Retired owner superseded an unrelated intent");
 }
 public static void main(String[] args)throws Exception{
  Connection open=new Connection();long before=current();
  check(open.reserve("notes-draft:v1:device")==0&&current()==before,"Ordinary slot changed intent");
  check(open.reserve("cloud:production")==before+1,"Cloud slot did not reserve");
  open.handleOnDestroy();rejected(open,"cloud:production");rejected(open,"notes-draft:v1:device");
  Connection racing=new Connection();AtomicReference<Throwable> result=new AtomicReference<>();
  Thread reservation=new Thread(()->{try{racing.reserve("cloud:staging");}catch(Throwable error){result.set(error);}});
  long accepted=current();
  synchronized(AlphaLocalAgentPlugin.lifecycleLock){
   reservation.start();
   long deadline=System.nanoTime()+2_000_000_000L;
   while(reservation.getState()!=Thread.State.BLOCKED){check(System.nanoTime()<deadline,"Reservation did not wait for lifecycle");Thread.sleep(1);}
   // Teardown must complete while reservation waits for lifecycle, without owner/lifecycle inversion.
   Thread teardown=new Thread(racing::handleOnDestroy);teardown.start();teardown.join(2000);
   check(!teardown.isAlive(),"Teardown deadlocked with lifecycle reservation");
  }
  reservation.join(2000);
  check(!reservation.isAlive()&&result.get() instanceof IllegalStateException,"Late reservation did not reject");
  check(current()==accepted,"Late reservation changed credential intent");
  System.out.println("PASS actual connection reservation and teardown owner fences");
 }
}`),
  ];
  assert.match(runJvm(sources,'ai.alphacompute.alphaphone.OwnerAdmissionTest'),/^PASS actual connection reservation/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
