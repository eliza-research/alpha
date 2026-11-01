import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {nativeSource,runJvm} from './fixtures/jvm-tools.mjs';

function method(text,start){
 const begin=text.indexOf(start);assert.ok(begin>=0,start);let depth=0;
 for(let i=text.indexOf('{',begin);i<text.length;i++){
  if(text[i]==='{')depth++;
  if(text[i]==='}'&&--depth===0)return text.slice(begin,i+1);
 }
 throw Error('Unclosed actual method');
}
test('noncritical slot commits keep lifecycle before vault, exact owner/CAS, and unrelated invocation authority',()=>{
 const store=readFileSync(nativeSource('AlphaCredentialStore.java'),'utf8');
 const host=readFileSync(nativeSource('AlphaLocalAgentPlugin.java'),'utf8');
 const access=method(host,'static <T> T withCredentialSlotMutation(');
 const start=store.indexOf('  if(!"cloud:production".equals(name)'),end=store.indexOf('  return AlphaLocalAgentPlugin.mutateCredentials(',start);
 assert.ok(start>=0&&end>start,'actual noncritical branch located');
 const branch=store.slice(start,end);
 const directory=mkdtempSync(join(tmpdir(),'credential-slot-lock-'));
 const file=(name,text)=>{const path=join(directory,name);writeFileSync(path,text);return path;};
 try{
  const sources=[file('JsonCredentialSlots.java',`package ai.eliza.plugins.securestore.nativeonly;
public class JsonCredentialSlots{public static final Object LOCK=new Object();public final java.util.Map<String,String> data=new java.util.HashMap<>();public String read(String n){return data.get(n);}public void write(String n,String v){data.put(n,v);}public void remove(String n){data.remove(n);}}`),
   file('SlotLockHarness.java',`package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots;
import java.util.concurrent.atomic.*;
final class AlphaLocalAgentPlugin{
 static final Object lifecycleLock=new Object();
 static int invocationInvalidations,credentialIntents,processStops;
 ${access}
}
final class LocalAgentProviderAdmission{static final String PROVIDER_SLOT="local-agent-provider:v1";}
final class CloudDeployment{static String storageSlot(String n){return "deployment:"+n;}}
final class Store{
 final JsonCredentialSlots slots=new JsonCredentialSlots();final Runnable assertOwner;
 Store(Runnable guard){assertOwner=guard;}
 boolean mutate(String name,String expected,String value,boolean compare)throws Exception{
 ${branch}
 throw new AssertionError("critical slot must retain its separate shutdown path");
 }
}
public class SlotLockHarness{
 static void check(boolean b,String why){if(!b)throw new AssertionError(why);}
 public static void main(String[] args)throws Exception{
  AtomicInteger guardCalls=new AtomicInteger();AtomicBoolean owner=new AtomicBoolean(true);
  Store store=new Store(()->{check(Thread.holdsLock(AlphaLocalAgentPlugin.lifecycleLock),"owner checked under lifecycle");check(Thread.holdsLock(JsonCredentialSlots.LOCK),"owner checked under vault");guardCalls.incrementAndGet();if(!owner.get())throw new SecurityException("owner changed");});
  for(String slot:new String[]{"cloud-signin:v1:ack:production","cloud-signin:v1:pending","notes-draft:v1:device","connected-read-cache:v1:test"}){
   check(store.mutate(slot,null,"one",false),"write result");
   check("one".equals(store.slots.read(CloudDeployment.storageSlot(slot))),"namespace retained");
   check(!store.mutate(slot,"other","two",true),"CAS mismatch refused");
   check("one".equals(store.slots.read(CloudDeployment.storageSlot(slot))),"CAS refusal unchanged");
   check(store.mutate(slot,"one","two",true),"matching CAS");
   check(store.mutate(slot,null,null,false)&&store.slots.read(CloudDeployment.storageSlot(slot))==null,"remove result");
  }
  check(guardCalls.get()==16,"guard once per noncritical operation");
  AtomicReference<Throwable> error=new AtomicReference<>();
  Thread writer=new Thread(()->{try{store.mutate("cloud-signin:v1:ack:production",null,"late",false);}catch(Throwable e){error.set(e);}});
  boolean vaultAvailable;
  synchronized(AlphaLocalAgentPlugin.lifecycleLock){
   writer.start();
   for(long end=System.nanoTime()+2_000_000_000L;writer.getState()!=Thread.State.BLOCKED;Thread.sleep(1))check(writer.isAlive()&&System.nanoTime()<end,"writer waits for lifecycle");
   Thread attachment=new Thread(()->{synchronized(JsonCredentialSlots.LOCK){}});attachment.setDaemon(true);attachment.start();attachment.join(1000);vaultAvailable=!attachment.isAlive();
   owner.set(false);
  }
  writer.join(2000);check(!writer.isAlive(),"writer terminated");
  check(vaultAvailable,"waiting guarded slot writer never holds vault before lifecycle");
  check(error.get() instanceof SecurityException,"stale owner rejected inside protected commit");
  check(store.slots.read(CloudDeployment.storageSlot("cloud-signin:v1:ack:production"))==null,"late stale write absent");
  check(AlphaLocalAgentPlugin.invocationInvalidations==0&&AlphaLocalAgentPlugin.credentialIntents==0&&AlphaLocalAgentPlugin.processStops==0,"draft/cache and request authority unchanged");
  System.out.println("PASS actual noncritical slot branch: L-before-vault, ack/pending/draft/cache, owner/CAS/namespace, no authority invalidation");
 }
}`)];
  assert.match(runJvm(sources,'ai.elizaresearch.alphaphone.SlotLockHarness'),/^PASS actual noncritical slot branch/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
