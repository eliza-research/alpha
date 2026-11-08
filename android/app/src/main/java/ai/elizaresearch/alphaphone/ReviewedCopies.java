package ai.elizaresearch.alphaphone;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;

/** Two bridges share Alpha's attachment cache. Each can cancel its own copies. The process-wide
 * registry lets startup cleanup distinguish live copies from files left by an earlier process. */
final class ReviewedCopies {
 static final long GRANT_MILLIS=15*60*1000;
 private static final Object LOCK=new Object();
 private static final Map<File,Copy> live=new HashMap<>();
 private static boolean swept;
 private static final class Copy {
  final ReviewedCopies owner;
  boolean writing=true;
  Copy(ReviewedCopies owner){this.owner=owner;}
 }
 private final Consumer<File> revoke;
 ReviewedCopies(Consumer<File> revoke){this.revoke=revoke;}

 /** The caller has validated the name and exact bytes. Create and register under the same lock as
  * sweep, then write off-lock so a cancel can unlink an in-progress copy without waiting for sync. */
 File write(File folder,String name,byte[] data)throws IOException{
  File file=new File(folder,UUID.randomUUID()+"-"+name);
  Copy copy=new Copy(this);
  FileOutputStream opened;
  synchronized(LOCK){
   if(!folder.isDirectory()&&!folder.mkdirs()&&!folder.isDirectory())throw new IOException("Attachment cache unavailable");
   if(!file.createNewFile())throw new IOException("Attachment copy already exists");
   try{opened=new FileOutputStream(file);}catch(IOException|RuntimeException failure){file.delete();throw failure;}
   live.put(file,copy);
  }
  try(FileOutputStream out=opened){out.write(data);out.getFD().sync();}
  catch(IOException|RuntimeException failure){revoke(file);throw failure;}
  synchronized(LOCK){
   if(live.get(file)!=copy)throw new IOException("Attachment copy was revoked");
   copy.writing=false;
   return file;
  }
 }

 void revoke(File file){
  synchronized(LOCK){
   Copy copy=live.get(file);
   if(copy==null||copy.owner!=this)return;
   live.remove(file);
   revoke.accept(file);
  }
 }

 void clear(){
  synchronized(LOCK){for(File file:new ArrayList<>(live.keySet()))revoke(file);}
 }

 void sweep(File folder,long now){
  synchronized(LOCK){
   File[] files=folder.listFiles();
   if(files==null)return;
   boolean first=!swept;
   for(File file:files){
    Copy copy=live.get(file);
    boolean expired=now-file.lastModified()>=GRANT_MILLIS;
    if(copy==null){if(first||expired)revoke.accept(file);}
    else if(!first&&copy.owner!=this&&!copy.writing&&expired)copy.owner.revoke(file);
   }
   swept=true;
  }
 }
}
