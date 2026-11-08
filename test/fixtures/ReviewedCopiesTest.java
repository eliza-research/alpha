package ai.elizaresearch.alphaphone;

import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;

/** Host-JVM check of the attachment copy scoping. Not Android, FileProvider or Capacitor evidence. */
public final class ReviewedCopiesTest {
 private static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 private static File copy(File folder,String name)throws Exception{File file=new File(folder,name);Files.write(file.toPath(),new byte[]{1});return file;}
 private static void waitFor(CountDownLatch latch){
  try{check(latch.await(5,TimeUnit.SECONDS),"schedule gate timed out");}
  catch(InterruptedException interrupted){Thread.currentThread().interrupt();throw new AssertionError(interrupted);}
 }
 private static File firstLoadAndPeerWrite(File folder,ReviewedCopies main,ReviewedCopies assistant,long now)throws Exception{
  CountDownLatch listing=new CountDownLatch(1),release=new CountDownLatch(1),peerEntered=new CountDownLatch(1);
  File held=new File(folder.getPath()){
   @Override public File[] listFiles(){listing.countDown();waitFor(release);return super.listFiles();}
  };
  FutureTask<Void> first=new FutureTask<>(()->{main.sweep(held,now);return null;});
  FutureTask<File> second=new FutureTask<>(()->{peerEntered.countDown();assistant.sweep(folder,now);return assistant.write(folder,"assistant.txt",new byte[]{2});});
  Thread sweep=new Thread(first,"reviewed-first-sweep"),peer=new Thread(second,"reviewed-peer-load");
  sweep.setDaemon(true);peer.setDaemon(true);sweep.start();
  try{
   waitFor(listing);peer.start();waitFor(peerEntered);
   long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
   while(peer.getState()!=Thread.State.BLOCKED&&!second.isDone()&&System.nanoTime()<deadline)Thread.yield();
   check(peer.getState()==Thread.State.BLOCKED,"peer load must wait for the first listing to finish");
  }finally{release.countDown();}
  first.get(5,TimeUnit.SECONDS);
  return second.get(5,TimeUnit.SECONDS);
 }
 public static void main(String[] args)throws Exception {
  File folder=Files.createTempDirectory("mail-attachments").toFile();
  try{
   long now=System.currentTimeMillis();
   File leftover=copy(folder,"leftover");
   List<File> mainRevoked=new ArrayList<>(),assistantRevoked=new ArrayList<>();
   ReviewedCopies main=new ReviewedCopies(file->{mainRevoked.add(file);file.delete();});
   ReviewedCopies assistant=new ReviewedCopies(file->{assistantRevoked.add(file);file.delete();});
   for(String name:List.of("", "nested/name.txt", "nested\\name.txt", "bad\0name.txt")){
    try{main.write(folder,name,new byte[]{1});throw new AssertionError("unsafe handoff name accepted");}
    catch(IllegalArgumentException expected){/* reject before touching the cache */}
   }
   check(folder.listFiles().length==1,"name rejection leaves the cache untouched");
   main.sweep(new File(folder,"unavailable"),now);
   File assistantCopy=firstLoadAndPeerWrite(folder,main,assistant,now);
   check(!leftover.exists(),"the first successful load removes an earlier process's copy");
   File mainCopy=main.write(folder,"main.txt",new byte[]{3});
   File anotherMainCopy=main.write(folder,"second.txt",new byte[]{4});
   check(Arrays.equals(Files.readAllBytes(assistantCopy.toPath()),new byte[]{2}),"a subsequent write preserves the peer copy's exact bytes");
   check(mainCopy.isFile()&&anotherMainCopy.isFile(),"multiple files from the same bridge coexist");
   assistant.sweep(folder,now);
   check(mainCopy.exists(),"a later load leaves another instance's recent copy");
   main.revoke(assistantCopy);
   check(assistantCopy.isFile(),"an old callback from a different owner cannot revoke the peer file");
   assistant.clear();
   check(!assistantCopy.exists(),"teardown removes the instance's own copy");
   check(mainCopy.exists(),"teardown of one instance leaves another instance's copy");
   assistant.revoke(assistantCopy);
   check(assistantRevoked.equals(List.of(assistantCopy)),"the delayed expiry of a cleared copy does not revoke again");
   File stale=copy(folder,"stale"),recent=copy(folder,"recent");
   check(stale.setLastModified(now-ReviewedCopies.GRANT_MILLIS),"stale time set");
   check(recent.setLastModified(now-ReviewedCopies.GRANT_MILLIS+1),"recent time set");
   check(mainCopy.setLastModified(now-ReviewedCopies.GRANT_MILLIS),"peer expiry set");
   main.sweep(folder,now);
   check(!stale.exists()&&recent.exists(),"later load removes abandoned files at the expiry boundary only");
   check(mainCopy.exists(),"own delayed expiry still owns the copy");
   assistant.sweep(folder,now);
   check(!mainCopy.exists()&&anotherMainCopy.exists(),"a peer load can expire an older completed copy");
   main.revoke(mainCopy);main.clear();
   check(mainRevoked.equals(List.of(leftover,stale,mainCopy,anotherMainCopy)),"owned and abandoned copies each revoke once");
   System.out.println("PASS reviewed copies");
  }finally{for(File file:folder.listFiles())file.delete();folder.delete();}
 }
}
