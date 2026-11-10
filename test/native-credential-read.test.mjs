import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {root,nativeSource,runJvm} from './fixtures/jvm-tools.mjs';

// Host JVM: the ACTUAL Alpha read-hook bodies against the shared client's exact abstract signature
// at the pin. Android, credential storage and network are outside this fixture.
const shared=readFileSync(join(root,'vendor/eliza/packages/auth/android/src/main/java/ai/eliza/auth/cloud/CloudSignInPlugin.java'),'utf8');
const signature=shared.match(/protected abstract <T> T withCredentialRead\(java\.util\.concurrent\.Callable<T> read\) throws Exception;/)?.[0];
function method(text,start){
 const begin=text.indexOf(start);assert.ok(begin>=0,start);
 for(let i=text.indexOf('{',begin),depth=0;i<text.length;i++){
  if(text[i]==='{')depth++;
  if(text[i]==='}'&&--depth===0)return text.slice(begin,i+1);
 }
 throw Error('Unclosed method');
}
test('the shared sign-in read hook runs under lifecycle then vault locks and never inside a credential mutation',()=>{
 assert.ok(signature,'canonical shared read hook signature');
 const bridge=method(readFileSync(nativeSource('AlphaCloudSignInPlugin.java'),'utf8'),'@Override protected <T> T withCredentialRead(');
 const readHook=method(readFileSync(nativeSource('AlphaLocalAgentPlugin.java'),'utf8'),'static <T> T withCredentialRead(');
 const directory=mkdtempSync(join(tmpdir(),'alpha-read-hook-'));
 const file=(name,text)=>{const path=join(directory,name);writeFileSync(path,text);return path;};
 try{
  const sources=[
   file('JsonCredentialSlots.java',`package ai.eliza.plugins.securestore.nativeonly;public final class JsonCredentialSlots{public static final Object LOCK=new Object();}`),
   file('ReadHookHarness.java',`package ai.elizaresearch.alphaphone;
import java.util.concurrent.atomic.*;
import ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots;
abstract class SharedContract { ${signature} }
final class Bridge extends SharedContract { ${bridge} }
final class AlphaLocalAgentPlugin {
 static final Object lifecycleLock=new Object();
 static volatile long credentialMutationEpoch=-1;
 ${readHook}
}
public final class ReadHookHarness {
 static void check(boolean value,String why){if(!value)throw new AssertionError(why);}
 public static void main(String[] args)throws Exception{
  Bridge bridge=new Bridge();AtomicInteger calls=new AtomicInteger();Object value=new Object();
  Object result=bridge.withCredentialRead(()->{
   check(Thread.holdsLock(AlphaLocalAgentPlugin.lifecycleLock)&&Thread.holdsLock(JsonCredentialSlots.LOCK),"both credential locks held");
   calls.incrementAndGet();return value;
  });
  check(result==value&&calls.get()==1,"exact result once");
  AlphaLocalAgentPlugin.credentialMutationEpoch=7;
  try{bridge.withCredentialRead(()->{calls.incrementAndGet();return null;});throw new AssertionError("read admitted during a mutation");}
  catch(IllegalStateException expected){}
  check(calls.get()==1,"no callable during a mutation");
  AlphaLocalAgentPlugin.credentialMutationEpoch=-1;
  Exception cause=new Exception("fixture read failure");
  try{bridge.withCredentialRead(()->{throw cause;});throw new AssertionError("failure lost");}
  catch(Exception actual){check(actual==cause,"same exception propagates");}
  // Writers take lifecycle then vault: a reader waiting on the lifecycle lock must not hold the vault,
  // and a mutation that begins under that lock (as mutateCredentials does) refuses it once it enters.
  AtomicReference<Throwable> failure=new AtomicReference<>();
  Thread reader=new Thread(()->{try{bridge.withCredentialRead(()->{calls.incrementAndGet();return null;});}catch(Throwable e){failure.set(e);}});
  synchronized(AlphaLocalAgentPlugin.lifecycleLock){
   reader.start();
   for(long end=System.nanoTime()+2_000_000_000L;reader.getState()!=Thread.State.BLOCKED;Thread.sleep(1))
    check(reader.isAlive()&&System.nanoTime()<end,"a read waits for the lifecycle lock");
   Thread probe=new Thread(()->{synchronized(JsonCredentialSlots.LOCK){}});probe.start();probe.join(2000);
   check(!probe.isAlive(),"vault lock free while a read waits for the lifecycle lock");
   AlphaLocalAgentPlugin.credentialMutationEpoch=8;
  }
  reader.join(2000);
  check(!reader.isAlive()&&failure.get() instanceof IllegalStateException&&calls.get()==1,"a waiting read is refused by a mutation that began under the lifecycle lock");
  AlphaLocalAgentPlugin.credentialMutationEpoch=-1;
  System.out.println("PASS actual credential read hook: shared signature, exact result, locks and order, mutation refusal under the locks, exception");
 }
}`),
  ];
  assert.match(runJvm(sources,'ai.elizaresearch.alphaphone.ReadHookHarness'),/^PASS actual credential read hook/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
