package ai.elizaresearch.alphaphone;
import java.io.File;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
/** The temporary viewer copies one AlphaMailAttachments instance wrote. Each bridge (main surface,
 * assistant) has its own instance over the one shared cache folder, so Cancel and teardown remove
 * only this instance's copies. Leftovers of an earlier process go at the first load in a process;
 * any copy older than the viewer's grant window goes at every load. */
final class ReviewedCopies {
 static final long GRANT_MILLIS=15*60*1000;
 private static final AtomicBoolean swept=new AtomicBoolean();
 private final Set<File> owned=ConcurrentHashMap.newKeySet();
 private final Consumer<File> revoke;
 ReviewedCopies(Consumer<File> revoke){this.revoke=revoke;}
 File add(File file){owned.add(file);return file;}
 void revoke(File file){owned.remove(file);revoke.accept(file);}
 void clear(){for(File file:owned)revoke(file);}
 void sweep(File folder,long now){
  boolean all=swept.compareAndSet(false,true);File[] files=folder.listFiles();if(files==null)return;
  for(File file:files)if(!owned.contains(file)&&(all||now-file.lastModified()>=GRANT_MILLIS))revoke.accept(file);
 }
}
