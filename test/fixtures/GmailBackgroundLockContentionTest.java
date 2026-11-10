package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.notifications.MailBackgroundDelivery;
import ai.eliza.plugins.notifications.MailNoticePoster;
import ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots;
import android.content.Context;
import java.io.File;
import java.lang.management.ManagementFactory;
import java.lang.management.ThreadInfo;
import java.lang.management.ThreadMXBean;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.locks.LockSupport;

public final class GmailBackgroundLockContentionTest {
 private static final ThreadMXBean THREADS=ManagementFactory.getThreadMXBean();
 private static final long TIMEOUT=TimeUnit.SECONDS.toNanos(5);

 private interface CheckedWork {void run()throws Exception;}
 private static void check(boolean result,String reason){if(!result)throw new AssertionError(reason);}
 private static Thread worker(String name,CheckedWork work,AtomicReference<Throwable> failure){
  Thread thread=new Thread(()->{try{work.run();}catch(Throwable error){failure.compareAndSet(null,error);}},name);
  thread.setDaemon(true);
  return thread;
 }
 private static boolean waitsFor(Thread waiter,Thread owner,Object monitor){
  ThreadInfo info=THREADS.getThreadInfo(waiter.getId());
  return info!=null&&info.getThreadState()==Thread.State.BLOCKED&&info.getLockOwnerId()==owner.getId()&&
   info.getLockInfo()!=null&&info.getLockInfo().getIdentityHashCode()==System.identityHashCode(monitor);
 }

 public static void main(String[] args)throws Exception{
  Context context=new Context(new File(args[0]));
  AlphaCredentialStore store=new AlphaCredentialStore(context);
  MailBackgroundDelivery delivery=GmailBackground.get(context);
  Object lifecycle=AlphaLocalAgentPlugin.lifecycleLock,vault=JsonCredentialSlots.LOCK;
  String gmail=CloudDeployment.storageSlot(GmailBackground.SLOT),unrelated="notes-draft:v1:device";
  store.slots.write(gmail,"{\"version\":1}");
  CountDownLatch lifecycleHeld=new CountDownLatch(1),enterVault=new CountDownLatch(1);
  AtomicReference<Throwable> failure=new AtomicReference<>();
  Thread owner=worker("lifecycle-vault-writer",()->{
   synchronized(lifecycle){
    lifecycleHeld.countDown();
    check(enterVault.await(5,TimeUnit.SECONDS),"fixture did not admit the lifecycle owner");
    AlphaLocalAgentPlugin.withCredentialSlotMutation(()->{
     check(Thread.holdsLock(lifecycle)&&Thread.holdsLock(vault),"writer guard needs both monitors");
    },()->{store.slots.write(unrelated,"{\"retained\":true}");return null;});
   }
  },failure);
  Thread mail=worker("gmail-vault-withdrawal",()->delivery.withdraw(null),failure);
  owner.start();
  check(lifecycleHeld.await(5,TimeUnit.SECONDS),"lifecycle writer did not start");
  mail.start();

  // Wait for the exact owner and monitor before letting the writer try the vault.
  // The old delivery has already taken the vault at this point.
  for(long end=System.nanoTime()+TIMEOUT;!waitsFor(mail,owner,lifecycle);){
   check(failure.get()==null&&mail.isAlive()&&System.nanoTime()<end,"Gmail did not wait for the owned lifecycle monitor");
   LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(1));
  }
  enterVault.countDown();
  for(long end=System.nanoTime()+TIMEOUT;owner.isAlive()||mail.isAlive();){
   if(waitsFor(owner,mail,vault)&&waitsFor(mail,owner,lifecycle)){
    long[] deadlocked=THREADS.findMonitorDeadlockedThreads();
    if(deadlocked!=null&&Arrays.stream(deadlocked).anyMatch(id->id==owner.getId())&&
       Arrays.stream(deadlocked).anyMatch(id->id==mail.getId()))
     throw new AssertionError("Gmail holds vault waiting for lifecycle; lifecycle writer holds lifecycle waiting for vault");
   }
   check(System.nanoTime()<end,"contending writes did not finish");
   LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(1));
  }
  if(failure.get()!=null)throw new AssertionError("production operation failed",failure.get());
  check(store.readCredentialSlot(GmailBackground.SLOT)==null,"actual Gmail slot was not removed");
  check("{\"retained\":true}".equals(store.slots.read(unrelated)),"unrelated slot write was lost");
  check(MailNoticePoster.cancellations==1&&GmailDeliveryWorker.cancellations==1,"withdrawal must cancel notices and schedule once");
  System.out.println("PASS actual Gmail withdrawal and lifecycle-first vault write");
 }
}
