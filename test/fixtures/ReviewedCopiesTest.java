package ai.elizaresearch.alphaphone;

import java.io.File;
import java.nio.file.Files;

/** Host-JVM check of the attachment copy scoping. Not Android, FileProvider or Capacitor evidence. */
public final class ReviewedCopiesTest {
 private static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 private static File copy(File folder,String name)throws Exception{File file=new File(folder,name);Files.write(file.toPath(),new byte[]{1});return file;}
 public static void main(String[] args)throws Exception {
  File folder=Files.createTempDirectory("mail-attachments").toFile();
  try{
   long now=System.currentTimeMillis();
   File leftover=copy(folder,"leftover");
   ReviewedCopies main=new ReviewedCopies(File::delete),assistant=new ReviewedCopies(File::delete);
   main.sweep(folder,now);
   check(!leftover.exists(),"the first load in a process removes an earlier process's copies");
   File mainCopy=main.add(copy(folder,"main")),assistantCopy=assistant.add(copy(folder,"assistant"));
   assistant.sweep(folder,now);
   check(mainCopy.exists(),"a later load leaves another instance's recent copy");
   assistant.clear();
   check(!assistantCopy.exists(),"teardown removes the instance's own copy");
   check(mainCopy.exists(),"teardown of one instance leaves another instance's copy");
   File stale=copy(folder,"stale");check(stale.setLastModified(now-ReviewedCopies.GRANT_MILLIS-1000),"stale time set");
   new ReviewedCopies(File::delete).sweep(folder,now);
   check(!stale.exists(),"a later load removes a copy older than the grant window");
   check(mainCopy.exists(),"and keeps a recent one");
   main.revoke(mainCopy);main.clear();
   check(!mainCopy.exists(),"a revoked copy is removed once");
   System.out.println("PASS reviewed copies");
  }finally{for(File file:folder.listFiles())file.delete();folder.delete();}
 }
}
